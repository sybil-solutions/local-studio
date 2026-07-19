import { constants, existsSync, statfsSync } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Effect, Fiber, Schema, Semaphore } from "effect";
import {
  CHATTERBOX_BACKEND,
  CHATTERBOX_MODEL_REVISION,
  CHATTERBOX_PACKAGE_VERSION,
  type SpeechGpuTarget,
  type SpeechStatus,
  type SpeechVoiceProfile,
} from "@local-studio/contracts/speech";
import type { ProcessInfo, Recipe, GpuInfo } from "../models/types";
import {
  GpuLeaseConflict,
  type GpuLeaseRegistry,
  resolveRecipeGpuUuids,
} from "../system/gpu-leases";
import { resolveBinary } from "../../core/command";
import {
  ChatterboxRuntime,
  chatterboxRuntimePaths,
  type ChatterboxInstallOptions,
  type ChatterboxRuntimeState,
} from "./runtime";
import {
  ChatterboxWorkerClient,
  type ChatterboxSynthesisInput,
  type ChatterboxSynthesisResult,
} from "./worker-client";
import {
  normalizeVoiceReference,
  VoiceReferenceError,
  type NormalizedVoiceReference,
} from "./reference-audio";
import { VoiceStore, type VoiceProfile } from "./voice-store";
import { secureSpeechDirectory } from "./storage";
import { queryNvidiaComputeGpuUuids } from "../system/platform/nvidia-compute-processes";

const FULL_NVIDIA_UUID =
  /^GPU-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const RTX_3090_NAME = /\bRTX\s+3090\b/i;
const MANAGED_INSTALL_BYTES = 32 * 1024 ** 3;
const MINIMUM_FREE_RESERVE_BYTES = 8 * 1024 ** 3;
const REQUIRED_INSTALL_BYTES = MANAGED_INSTALL_BYTES + MINIMUM_FREE_RESERVE_BYTES;
const MAXIMUM_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAXIMUM_QUEUED_SYNTHESIS = 4;
const MAXIMUM_PENDING_NORMALIZATION = 2;
const MAXIMUM_TEXT_CHARACTERS = 4096;

export class SpeechServiceError extends Schema.TaggedErrorClass<SpeechServiceError>()(
  "SpeechServiceError",
  { status: Schema.Number, code: Schema.String, message: Schema.String },
) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}

export interface SpeechEngineState {
  getCurrentProcess(): Effect.Effect<ProcessInfo | null, unknown>;
  getCurrentRecipe(): Effect.Effect<Recipe | null, unknown>;
}

export interface SpeechRuntime {
  readonly paths: { readonly pythonPath: string };
  getState(): ChatterboxRuntimeState;
  startInstall(
    gpuUuid: string,
    options?: ChatterboxInstallOptions,
  ): Effect.Effect<ChatterboxRuntimeState, unknown>;
  waitForInstall(): Effect.Effect<ChatterboxRuntimeState, unknown>;
  cancelInstall(): Effect.Effect<void, unknown>;
}

export interface SpeechWorker {
  synthesize(input: ChatterboxSynthesisInput): Effect.Effect<ChatterboxSynthesisResult, unknown>;
  shutdown(): Effect.Effect<void, unknown>;
  settleTermination(): Effect.Effect<void, unknown>;
  terminate(): Effect.Effect<void, unknown>;
}

const speechGpuLeaseBrand: unique symbol = Symbol("SpeechGpuLeaseGuard");

export interface SpeechGpuLeaseGuard {
  readonly uuid: string;
  readonly generation: number;
  readonly [speechGpuLeaseBrand]: true;
}

export interface SpeechVoiceStore {
  list(): Effect.Effect<VoiceProfile[], unknown>;
  create(input: {
    name: string;
    durationMs: number;
    consent: string;
    audio: Uint8Array;
  }): Effect.Effect<VoiceProfile, unknown>;
  delete(id: string): Effect.Effect<boolean, unknown>;
  withPlaintext<A, E, R>(
    id: string,
    use: (path: string) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | unknown, R>;
  close(): Effect.Effect<void, unknown>;
}

export interface SpeechDiskAvailability {
  readonly totalBytes: number;
  readonly availableBytes: number;
}

export interface SpeechSynthesisInput {
  readonly text: string;
  readonly voiceId: string;
}

export interface SpeechSynthesisOutput {
  readonly audio: Uint8Array;
  readonly contentType: "audio/wav";
  readonly sampleRate: number;
}

export interface SpeechVoiceInput {
  readonly name: string;
  readonly consent: string;
  readonly audio: Uint8Array;
}

export interface SpeechInstallInput {
  readonly repair?: boolean | undefined;
}

export interface SpeechServiceOptions {
  readonly dataDirectory: string;
  readonly databasePath: string;
  readonly engine: SpeechEngineState;
  readonly gpuLeaseRegistry: GpuLeaseRegistry;
  readonly gpuInfo: () => Effect.Effect<GpuInfo[], unknown>;
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly runtime?: SpeechRuntime | undefined;
  readonly voiceStore?: SpeechVoiceStore | undefined;
  readonly workerFactory?: ((lease: SpeechGpuLeaseGuard) => SpeechWorker) | undefined;
  readonly normalizeReference?:
    | ((
        input: Uint8Array,
        dataDirectory: string,
      ) => Effect.Effect<NormalizedVoiceReference, VoiceReferenceError>)
    | undefined;
  readonly diskAvailability?: (() => SpeechDiskAvailability | null) | undefined;
  readonly resolveBinary?: ((name: string) => string | null) | undefined;
  readonly computeGpuUuids?: (() => Effect.Effect<readonly string[], unknown>) | undefined;
}

const canonicalUuid = (uuid: string): string => `GPU-${uuid.slice(4).toLowerCase()}`;

const serviceError = (error: unknown, status = 500, code = "speech_failed"): SpeechServiceError =>
  error instanceof SpeechServiceError
    ? error
    : new SpeechServiceError(status, code, error instanceof Error ? error.message : String(error));

const installationMessage = (state: ChatterboxRuntimeState): string => {
  if (state.status === "not_installed") return "Chatterbox Turbo is not installed";
  if (state.status === "installed") return "Chatterbox Turbo is ready";
  if (state.status === "error") return state.message;
  if (state.stage === "preparing") return "Preparing Chatterbox Turbo";
  if (state.stage === "creating_runtime") return "Creating the speech runtime";
  if (state.stage === "installing_package") return "Installing Chatterbox Turbo";
  return "Downloading the pinned Chatterbox Turbo model";
};

const installationStatus = (state: ChatterboxRuntimeState): SpeechStatus["install"] => {
  if (state.status === "not_installed") {
    return { phase: "missing", progress: 0, message: installationMessage(state), error: null };
  }
  if (state.status === "installed") {
    return { phase: "ready", progress: 1, message: installationMessage(state), error: null };
  }
  if (state.status === "error") {
    return { phase: "failed", progress: 0, message: state.message, error: state.message };
  }
  return {
    phase: "installing",
    progress: state.progress,
    message: installationMessage(state),
    error: null,
  };
};

const diskAvailability = (path: string): SpeechDiskAvailability | null => {
  try {
    const stats = statfsSync(path);
    return {
      totalBytes: stats.blocks * stats.bsize,
      availableBytes: stats.bavail * stats.bsize,
    };
  } catch {
    return null;
  }
};

const outputChildPath = (directory: string, path: string): string => {
  const root = resolve(directory);
  const candidate = resolve(path);
  const child = relative(root, candidate);
  if (!child || child.startsWith("..") || child.startsWith("/") || child.startsWith("\\")) {
    throw new SpeechServiceError(502, "speech_output_invalid", "Speech worker output is invalid");
  }
  return candidate;
};

const validatedWave = (audio: Uint8Array): Uint8Array => {
  const bytes = Buffer.from(audio);
  if (
    bytes.length < 44 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WAVE" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  ) {
    throw new SpeechServiceError(502, "speech_output_invalid", "Speech worker output is invalid");
  }
  return bytes;
};

const readBoundedWave = (path: string): Effect.Effect<Uint8Array, SpeechServiceError> =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => open(path, constants.O_RDONLY | constants.O_NOFOLLOW),
      catch: (error) => serviceError(error, 502, "speech_output_invalid"),
    }),
    (handle) =>
      Effect.gen(function* () {
        const stats = yield* Effect.tryPromise({
          try: () => handle.stat(),
          catch: (error) => serviceError(error, 502, "speech_output_invalid"),
        });
        if (!stats.isFile() || stats.size > MAXIMUM_OUTPUT_BYTES) {
          throw new SpeechServiceError(
            502,
            "speech_output_invalid",
            "Speech worker output is invalid",
          );
        }
        const bytes = Buffer.alloc(Math.min(MAXIMUM_OUTPUT_BYTES + 1, stats.size + 1));
        let offset = 0;
        while (offset < bytes.length) {
          const result = yield* Effect.tryPromise({
            try: () => handle.read(bytes, offset, bytes.length - offset, offset),
            catch: (error) => serviceError(error, 502, "speech_output_invalid"),
          });
          if (result.bytesRead === 0) break;
          offset += result.bytesRead;
        }
        if (offset > MAXIMUM_OUTPUT_BYTES) {
          throw new SpeechServiceError(
            502,
            "speech_output_invalid",
            "Speech worker output is invalid",
          );
        }
        const completed = yield* Effect.tryPromise({
          try: () => handle.stat(),
          catch: (error) => serviceError(error, 502, "speech_output_invalid"),
        });
        if (completed.size !== offset) {
          throw new SpeechServiceError(
            502,
            "speech_output_invalid",
            "Speech worker output is invalid",
          );
        }
        return yield* Effect.try({
          try: () => validatedWave(Buffer.from(bytes.subarray(0, offset))),
          catch: (error) => serviceError(error, 502, "speech_output_invalid"),
        });
      }),
    (handle) =>
      Effect.tryPromise({ try: () => handle.close(), catch: () => undefined }).pipe(Effect.ignore),
  );

const validText = (text: string): string => {
  if (!text.trim())
    throw new SpeechServiceError(400, "speech_text_required", "Speech text is required");
  if (Array.from(text).length > MAXIMUM_TEXT_CHARACTERS) {
    throw new SpeechServiceError(
      400,
      "speech_text_too_long",
      `Speech text cannot exceed ${MAXIMUM_TEXT_CHARACTERS} characters`,
    );
  }
  return text;
};

const stoppingError = (): SpeechServiceError =>
  new SpeechServiceError(409, "speech_stopping", "Speech runtime is stopping");

export class SpeechService {
  private readonly dataDirectory: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly runtime: SpeechRuntime;
  private readonly voiceStore: SpeechVoiceStore;
  private readonly workerFactory: (lease: SpeechGpuLeaseGuard) => SpeechWorker;
  private readonly normalizeReference: (
    input: Uint8Array,
    dataDirectory: string,
  ) => Effect.Effect<NormalizedVoiceReference, VoiceReferenceError>;
  private readonly getDiskAvailability: () => SpeechDiskAvailability | null;
  private readonly findBinary: (name: string) => string | null;
  private readonly computeGpuUuids: () => Effect.Effect<readonly string[], unknown>;
  private readonly outputDirectory: string;
  private readonly activation = Semaphore.makeUnsafe(1);
  private readonly synthesis = Semaphore.makeUnsafe(1);
  private readonly voiceNormalization = Semaphore.makeUnsafe(1);
  private worker: SpeechWorker | null = null;
  private workerPhase: SpeechStatus["worker"]["phase"] = "stopped";
  private workerError: string | null = null;
  private leasedGpuUuid: string | null = null;
  private liveLease: SpeechGpuLeaseGuard | null = null;
  private leaseGeneration = 0;
  private quarantined = false;
  private pendingSynthesis = 0;
  private pendingNormalization = 0;
  private acceptingSynthesis = true;
  private synthesisEpoch = 0;
  private installFiber: Fiber.Fiber<void, never> | null = null;
  private installGeneration = 0;
  private cancellingInstall = false;
  private readonly stopping = Semaphore.makeUnsafe(1);
  private closed = false;

  constructor(private readonly options: SpeechServiceOptions) {
    this.environment = options.environment ?? process.env;
    this.dataDirectory = resolve(
      this.environment["LOCAL_STUDIO_SPEECH_DATA_DIR"] ?? options.dataDirectory,
    );
    const paths = chatterboxRuntimePaths(this.dataDirectory);
    this.outputDirectory = paths.outputDirectory;
    secureSpeechDirectory(paths.speechDirectory);
    this.runtime = options.runtime ?? new ChatterboxRuntime({ dataDirectory: this.dataDirectory });
    this.voiceStore =
      options.voiceStore ?? new VoiceStore(options.databasePath, this.dataDirectory);
    this.workerFactory =
      options.workerFactory ??
      ((lease): SpeechWorker =>
        new ChatterboxWorkerClient({
          dataDirectory: this.dataDirectory,
          gpuUuid: lease.uuid,
          voiceDirectory: join(this.dataDirectory, "runtime", "speech", "tmp"),
        }));
    this.normalizeReference = options.normalizeReference ?? normalizeVoiceReference;
    this.getDiskAvailability =
      options.diskAvailability ??
      ((): SpeechDiskAvailability | null => diskAvailability(this.dataDirectory));
    this.findBinary = options.resolveBinary ?? resolveBinary;
    this.computeGpuUuids =
      options.computeGpuUuids ??
      ((): Effect.Effect<readonly string[], unknown> => queryNvidiaComputeGpuUuids());
  }

  getStatus(): Effect.Effect<SpeechStatus, unknown> {
    const storage = this.getDiskAvailability();
    return Effect.all([this.statusTarget(), this.voiceStore.list()]).pipe(
      Effect.map(([target, voices]) => ({
        backend: CHATTERBOX_BACKEND,
        package_version: CHATTERBOX_PACKAGE_VERSION,
        model_revision: CHATTERBOX_MODEL_REVISION,
        install: installationStatus(this.runtime.getState()),
        worker: {
          phase: this.workerPhase,
          queue_depth: Math.max(0, this.pendingSynthesis - 1),
          error: this.workerError,
        },
        gpu: target,
        prerequisites: {
          ffmpeg: Boolean(this.findBinary(this.environment["LOCAL_STUDIO_FFMPEG_CLI"] ?? "ffmpeg")),
          python_311: Boolean(
            existsSync(this.runtime.paths.pythonPath) ||
              this.findBinary("python3.11") ||
              this.findBinary("uv"),
          ),
          storage: {
            available_bytes: storage?.availableBytes ?? null,
            required_bytes: REQUIRED_INSTALL_BYTES,
            ready: Boolean(storage && storage.availableBytes >= REQUIRED_INSTALL_BYTES),
          },
        },
        voice_count: voices.length,
      })),
    );
  }

  install(input: SpeechInstallInput = {}): Effect.Effect<SpeechStatus, unknown> {
    if (this.closed) return Effect.fail(stoppingError());
    const service = this;
    return this.activation.withPermit(
      Effect.gen(function* () {
        const current = service.runtime.getState();
        if (current.status === "installing" || (current.status === "installed" && !input.repair)) {
          return yield* service.getStatus();
        }
        if (input.repair && service.worker) {
          yield* service.stopRuntime(false, true);
        }
        yield* Effect.try({
          try: () => service.assertInstallCapacity(),
          catch: (error) => serviceError(error),
        });
        const lease = yield* service.activateSpeech();
        yield* service.assertLiveLease(lease);
        const started = yield* service.startRuntimeInstall(lease, input).pipe(
          Effect.mapError((error) => serviceError(error, 500, "speech_install_failed")),
          Effect.tapError(() => (service.worker ? Effect.void : service.releaseSpeechLease())),
        );
        if (started.status !== "installing") {
          if (!service.worker) yield* service.releaseSpeechLease();
          if (started.status === "error") {
            return yield* Effect.fail(
              new SpeechServiceError(500, "speech_install_failed", started.message),
            );
          }
          return yield* service.getStatus();
        }
        yield* service.startInstallCompletion(lease);
        return yield* service.getStatus();
      }),
    );
  }

  listVoices(): Effect.Effect<SpeechVoiceProfile[], unknown> {
    return this.voiceStore.list();
  }

  createVoice(input: SpeechVoiceInput): Effect.Effect<SpeechVoiceProfile, unknown> {
    if (this.pendingNormalization >= MAXIMUM_PENDING_NORMALIZATION) {
      return Effect.fail(
        new VoiceReferenceError(429, "voice_queue_full", "Voice normalization queue is full"),
      );
    }
    this.pendingNormalization += 1;
    return this.voiceNormalization
      .withPermit(
        this.normalizeReference(input.audio, this.dataDirectory).pipe(
          Effect.flatMap((normalized) =>
            this.voiceStore.create({
              name: input.name,
              consent: input.consent,
              audio: normalized.audio,
              durationMs: normalized.durationMs,
            }),
          ),
        ),
      )
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.pendingNormalization -= 1;
          }),
        ),
      );
  }

  deleteVoice(id: string): Effect.Effect<boolean, unknown> {
    return this.voiceStore.delete(id);
  }

  synthesize(input: SpeechSynthesisInput): Effect.Effect<SpeechSynthesisOutput, unknown> {
    if (!this.acceptingSynthesis) {
      return Effect.fail(stoppingError());
    }
    if (this.pendingSynthesis >= MAXIMUM_QUEUED_SYNTHESIS + 1) {
      return Effect.fail(new SpeechServiceError(429, "speech_queue_full", "Speech queue is full"));
    }
    this.pendingSynthesis += 1;
    const epoch = this.synthesisEpoch;
    const operation = this.synthesis.withPermit(
      Effect.suspend(() =>
        epoch === this.synthesisEpoch
          ? this.synthesizeOne(input, epoch)
          : Effect.fail(stoppingError()),
      ),
    );
    return operation.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.pendingSynthesis -= 1;
        }),
      ),
    );
  }

  stop(): Effect.Effect<void, SpeechServiceError | unknown> {
    if (this.installFiber) {
      return Effect.fail(
        new SpeechServiceError(
          409,
          "speech_installing",
          "Wait for the Chatterbox install to finish before stopping speech",
        ),
      );
    }
    return this.stopRuntime(false, true);
  }

  cancelInstall(): Effect.Effect<void, unknown> {
    if (!this.installFiber) return Effect.void;
    return this.stopRuntime(true, true);
  }

  shutdown(): Effect.Effect<void, unknown> {
    if (this.closed) return Effect.void;
    this.closed = true;
    return this.stopRuntime(true, false).pipe(Effect.onExit(() => this.voiceStore.close()));
  }

  private statusTarget(): Effect.Effect<SpeechGpuTarget | null> {
    return this.options.gpuInfo().pipe(
      Effect.flatMap((gpus) =>
        Effect.try({ try: () => this.resolveTarget(gpus), catch: () => null }),
      ),
      Effect.catch(() => Effect.succeed(null)),
    );
  }

  private resolveTarget(gpus: readonly GpuInfo[]): SpeechGpuTarget {
    if (gpus.length === 0) {
      throw new SpeechServiceError(
        503,
        "speech_gpu_telemetry_missing",
        "GPU telemetry is unavailable",
      );
    }
    const configured = this.environment["LOCAL_STUDIO_SPEECH_GPU_UUID"]?.trim();
    if (configured) {
      if (!FULL_NVIDIA_UUID.test(configured)) {
        throw new SpeechServiceError(
          400,
          "speech_gpu_invalid",
          "LOCAL_STUDIO_SPEECH_GPU_UUID must be a full NVIDIA GPU UUID",
        );
      }
      const uuid = canonicalUuid(configured);
      const gpu = gpus.find((candidate) => candidate.uuid?.toLowerCase() === uuid.toLowerCase());
      if (!gpu) {
        throw new SpeechServiceError(
          503,
          "speech_gpu_missing",
          "The configured speech GPU is unavailable",
        );
      }
      return {
        uuid,
        name: gpu.name,
        ...(gpu.pci_bus_id ? { pci_bus_id: gpu.pci_bus_id } : {}),
      };
    }
    const matches = gpus.filter((gpu) => RTX_3090_NAME.test(gpu.name));
    if (matches.length !== 1) {
      throw new SpeechServiceError(
        503,
        "speech_gpu_ambiguous",
        "Configure one RTX 3090 for speech with LOCAL_STUDIO_SPEECH_GPU_UUID",
      );
    }
    const gpu = matches[0];
    if (!gpu?.uuid || !FULL_NVIDIA_UUID.test(gpu.uuid)) {
      throw new SpeechServiceError(
        503,
        "speech_gpu_telemetry_missing",
        "GPU UUID telemetry is unavailable",
      );
    }
    return {
      uuid: canonicalUuid(gpu.uuid),
      name: gpu.name,
      ...(gpu.pci_bus_id ? { pci_bus_id: gpu.pci_bus_id } : {}),
    };
  }

  private assertInstallCapacity(): void {
    const availability = this.getDiskAvailability();
    if (!availability) {
      throw new SpeechServiceError(
        503,
        "speech_storage_unavailable",
        "Speech storage capacity could not be verified",
      );
    }
    if (availability.availableBytes < REQUIRED_INSTALL_BYTES) {
      throw new SpeechServiceError(
        507,
        "speech_storage_low",
        `Chatterbox requires ${REQUIRED_INSTALL_BYTES / 1024 ** 3} GB of available speech storage`,
      );
    }
  }

  private activateSpeech(): Effect.Effect<SpeechGpuLeaseGuard, unknown> {
    const service = this;
    return Effect.gen(function* () {
      if (service.quarantined) {
        return yield* Effect.fail(
          new SpeechServiceError(
            503,
            "speech_worker_quarantined",
            "Speech GPU remains reserved until the previous worker exits",
          ),
        );
      }
      const gpus = yield* service.options
        .gpuInfo()
        .pipe(Effect.mapError((error) => serviceError(error, 503, "speech_gpu_telemetry_missing")));
      const target = yield* Effect.try({
        try: () => service.resolveTarget(gpus),
        catch: (error) => serviceError(error),
      });
      if (service.leasedGpuUuid && service.leasedGpuUuid !== target.uuid) {
        return yield* Effect.fail(
          new SpeechServiceError(
            409,
            "speech_gpu_changed",
            "Stop the speech runtime before changing its GPU",
          ),
        );
      }
      const existing = service.liveLease;
      if (service.installFiber && existing?.uuid === target.uuid) {
        yield* service.assertLiveLease(existing);
        return existing;
      }
      yield* service.assertComputeGpuIdle(target.uuid);
      yield* service.reconcileModelLeases(gpus);
      yield* service.options.gpuLeaseRegistry
        .claim("speech", [target.uuid])
        .pipe(
          Effect.mapError((error) =>
            error instanceof GpuLeaseConflict
              ? new SpeechServiceError(
                  409,
                  "speech_gpu_busy",
                  "The speech GPU is in use by a model",
                )
              : serviceError(error, 409, "speech_gpu_unavailable"),
          ),
        );
      service.leasedGpuUuid = target.uuid;
      const lease = {
        uuid: target.uuid,
        generation: ++service.leaseGeneration,
        [speechGpuLeaseBrand]: true,
      } satisfies SpeechGpuLeaseGuard;
      service.liveLease = lease;
      yield* service
        .assertComputeGpuIdle(target.uuid)
        .pipe(Effect.tapError(() => service.releaseSpeechLease()));
      return lease;
    });
  }

  private assertComputeGpuIdle(uuid: string): Effect.Effect<void, SpeechServiceError> {
    return this.computeGpuUuids().pipe(
      Effect.mapError(
        () =>
          new SpeechServiceError(
            503,
            "speech_gpu_compute_query_failed",
            "Could not verify speech GPU compute processes",
          ),
      ),
      Effect.flatMap((occupied) =>
        occupied.some((candidate) => candidate.toLowerCase() === uuid.toLowerCase())
          ? Effect.fail(
              new SpeechServiceError(
                409,
                "speech_gpu_compute_busy",
                "The speech GPU already has an unmanaged compute process",
              ),
            )
          : Effect.void,
      ),
    );
  }

  private assertLiveLease(lease: SpeechGpuLeaseGuard): Effect.Effect<void, SpeechServiceError> {
    return Effect.try({
      try: () => this.assertRetainedLease(lease),
      catch: (error) => serviceError(error, 409, "speech_lease_expired"),
    }).pipe(
      Effect.andThen(this.options.gpuLeaseRegistry.snapshot()),
      Effect.flatMap((leases) => {
        if (leases.some((current) => current.owner === "speech" && current.uuid === lease.uuid))
          return Effect.void;
        this.liveLease = null;
        this.leasedGpuUuid = null;
        return Effect.fail(
          new SpeechServiceError(409, "speech_lease_expired", "Speech GPU lease expired"),
        );
      }),
    );
  }

  private assertRetainedLease(lease: SpeechGpuLeaseGuard): void {
    if (this.liveLease !== lease || this.leasedGpuUuid !== lease.uuid) {
      throw new SpeechServiceError(409, "speech_lease_expired", "Speech GPU lease expired");
    }
  }

  private startRuntimeInstall(
    lease: SpeechGpuLeaseGuard,
    options: SpeechInstallInput,
  ): Effect.Effect<ChatterboxRuntimeState, unknown> {
    return Effect.try({
      try: () => this.assertRetainedLease(lease),
      catch: (error) => error,
    }).pipe(Effect.andThen(this.runtime.startInstall(lease.uuid, options)));
  }

  private reconcileModelLeases(gpus: readonly GpuInfo[]): Effect.Effect<void, unknown> {
    const service = this;
    return Effect.gen(function* () {
      const process = yield* service.options.engine.getCurrentProcess();
      if (!process) {
        const leases = yield* service.options.gpuLeaseRegistry.snapshot();
        if (leases.some((lease) => lease.owner === "llm")) {
          return yield* Effect.fail(
            new SpeechServiceError(
              409,
              "model_gpu_transition",
              "A model GPU transition is still in progress",
            ),
          );
        }
        return;
      }
      const recipe = yield* service.options.engine.getCurrentRecipe();
      const confirmed = yield* service.options.engine.getCurrentProcess();
      if (!confirmed || confirmed.pid !== process.pid) {
        return yield* Effect.fail(
          new SpeechServiceError(
            409,
            "model_process_changed",
            "The active model changed while speech was preparing",
          ),
        );
      }
      if (!recipe) {
        return yield* Effect.fail(
          new SpeechServiceError(
            409,
            "model_process_unknown",
            `Running model process ${process.pid} does not match a managed recipe`,
          ),
        );
      }
      const resolution = resolveRecipeGpuUuids(recipe, gpus);
      if (resolution.unresolvedTokens.length > 0) {
        return yield* Effect.fail(
          new SpeechServiceError(
            409,
            "model_gpu_unresolved",
            `Model GPU selectors could not be resolved: ${resolution.unresolvedTokens.join(", ")}`,
          ),
        );
      }
      if (resolution.uuids.length === 0) {
        return yield* Effect.fail(
          new SpeechServiceError(
            503,
            "model_gpu_telemetry_missing",
            "Model GPU isolation could not be verified",
          ),
        );
      }
      yield* service.options.gpuLeaseRegistry
        .replace("llm", resolution.uuids)
        .pipe(
          Effect.mapError((error) =>
            error instanceof GpuLeaseConflict
              ? new SpeechServiceError(
                  409,
                  "model_gpu_conflict",
                  "The active model overlaps the speech GPU",
                )
              : serviceError(error, 409, "model_gpu_unavailable"),
          ),
        );
    });
  }

  private ensureWorker(): Effect.Effect<SpeechWorker, unknown> {
    const service = this;
    return this.activation.withPermit(
      Effect.gen(function* () {
        const runtimeState = service.runtime.getState();
        if (runtimeState.status === "installing") {
          return yield* Effect.fail(
            new SpeechServiceError(
              409,
              "speech_installing",
              "Chatterbox Turbo is still installing",
            ),
          );
        }
        if (runtimeState.status !== "installed") {
          return yield* Effect.fail(
            new SpeechServiceError(
              409,
              "speech_not_installed",
              "Install Chatterbox Turbo before generating speech",
            ),
          );
        }
        if (service.worker) {
          if (service.quarantined) {
            return yield* Effect.fail(
              new SpeechServiceError(
                503,
                "speech_worker_quarantined",
                "Speech GPU remains reserved until the previous worker exits",
              ),
            );
          }
          const lease = service.liveLease;
          if (!lease)
            return yield* Effect.fail(
              new SpeechServiceError(409, "speech_lease_expired", "Speech GPU lease expired"),
            );
          yield* service.assertLiveLease(lease);
          return service.worker;
        }
        const lease = yield* service.activateSpeech();
        yield* service.assertLiveLease(lease);
        service.workerPhase = "starting";
        service.workerError = null;
        return yield* Effect.try({
          try: () => {
            service.assertRetainedLease(lease);
            service.worker = service.workerFactory(lease);
            return service.worker;
          },
          catch: (error) => serviceError(error),
        }).pipe(Effect.tapError(() => service.releaseSpeechLease()));
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            if (service.worker) return;
            service.workerPhase = "failed";
            service.workerError = serviceError(error).message;
          }),
        ),
      ),
    );
  }

  private synthesizeOne(
    input: SpeechSynthesisInput,
    epoch: number,
  ): Effect.Effect<SpeechSynthesisOutput, unknown> {
    const text = Effect.try({
      try: () => validText(input.text),
      catch: (error) => error,
    });
    return text.pipe(
      Effect.flatMap((validatedText) =>
        this.voiceStore.withPlaintext(input.voiceId, (voicePath) => {
          const service = this;
          let output: string | null = null;
          return Effect.gen(function* () {
            yield* Effect.try({
              try: () => service.assertSynthesisEpoch(epoch),
              catch: (error) => error,
            });
            const worker = yield* service.ensureWorker();
            yield* Effect.try({
              try: () => service.assertSynthesisEpoch(epoch),
              catch: (error) => error,
            });
            service.workerPhase = "busy";
            service.workerError = null;
            const result = yield* worker
              .synthesize({ text: validatedText, voicePath })
              .pipe(
                Effect.mapError((error) =>
                  epoch !== service.synthesisEpoch ? stoppingError() : error,
                ),
              );
            yield* Effect.try({
              try: () => service.assertSynthesisEpoch(epoch),
              catch: (error) => error,
            });
            output = yield* Effect.try({
              try: () => outputChildPath(service.outputDirectory, result.path),
              catch: (error) => error,
            });
            const audio = yield* readBoundedWave(output!);
            service.workerPhase = "ready";
            return { audio, contentType: "audio/wav" as const, sampleRate: result.sampleRate };
          }).pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                if (epoch !== service.synthesisEpoch) return;
                service.quarantineWorker(error);
              }),
            ),
            Effect.ensuring(
              Effect.suspend(() =>
                output
                  ? Effect.tryPromise({ try: () => unlink(output!), catch: () => undefined }).pipe(
                      Effect.ignore,
                    )
                  : Effect.void,
              ),
            ),
          );
        }),
      ),
    );
  }

  private quarantineWorker(error: unknown): void {
    this.quarantined = true;
    this.workerPhase = "failed";
    this.workerError = error instanceof Error ? error.message : String(error);
  }

  private assertSynthesisEpoch(epoch: number): void {
    if (!this.acceptingSynthesis || epoch !== this.synthesisEpoch) throw stoppingError();
  }

  private terminateWorker(worker: SpeechWorker): Effect.Effect<void, SpeechServiceError> {
    return worker.terminate().pipe(
      Effect.mapError((error) => {
        this.quarantineWorker(error);
        return new SpeechServiceError(
          503,
          "speech_worker_exit_unconfirmed",
          "Speech GPU remains reserved because the worker exit was not confirmed",
        );
      }),
    );
  }

  private stopWorker(): Effect.Effect<void, unknown> {
    const service = this;
    return Effect.gen(function* () {
      const activeWorker = service.worker;
      if (activeWorker) yield* service.terminateWorker(activeWorker);
      yield* service.synthesis.withPermit(Effect.void);
      const lateWorker = service.worker;
      if (lateWorker && lateWorker !== activeWorker) yield* service.terminateWorker(lateWorker);
      service.worker = null;
      service.quarantined = false;
      yield* service.releaseSpeechLease();
      service.workerPhase = "stopped";
      service.workerError = null;
    });
  }

  private stopRuntime(
    cancelInstall: boolean,
    restoreSynthesis: boolean,
  ): Effect.Effect<void, unknown> {
    const service = this;
    return this.stopping
      .withPermit(
        Effect.gen(function* () {
          service.acceptingSynthesis = false;
          service.synthesisEpoch += 1;
          if (cancelInstall) service.cancellingInstall = true;
          let cancelFailure: SpeechServiceError | null = null;
          if (cancelInstall) {
            cancelFailure = yield* service.runtime.cancelInstall().pipe(
              Effect.match({
                onFailure: (error) => serviceError(error, 503, "speech_shutdown_failed"),
                onSuccess: () => null,
              }),
            );
            const fiber = service.installFiber;
            if (fiber) yield* Fiber.join(fiber);
          }
          yield* service
            .stopWorker()
            .pipe(
              Effect.mapError((error) =>
                serviceError(
                  error,
                  503,
                  cancelInstall ? "speech_shutdown_failed" : "speech_stop_failed",
                ),
              ),
            );
          if (cancelFailure) yield* Effect.fail(cancelFailure);
        }),
      )
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (cancelInstall) service.cancellingInstall = false;
            if (restoreSynthesis && !service.closed) service.acceptingSynthesis = true;
          }),
        ),
      );
  }

  private releaseSpeechLease(): Effect.Effect<void, unknown> {
    const uuid = this.leasedGpuUuid;
    if (!uuid) return Effect.void;
    return this.options.gpuLeaseRegistry.release("speech", [uuid]).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.leasedGpuUuid = null;
          this.liveLease = null;
        }),
      ),
      Effect.asVoid,
    );
  }

  private startInstallCompletion(lease: SpeechGpuLeaseGuard): Effect.Effect<void> {
    const generation = ++this.installGeneration;
    const service = this;
    const completion = Effect.yieldNow.pipe(
      Effect.andThen(this.runtime.waitForInstall()),
      Effect.mapError((error) => serviceError(error, 500, "speech_install_failed")),
      Effect.flatMap((state) =>
        state.status === "installed" || state.status === "error"
          ? Effect.void
          : Effect.fail(
              new SpeechServiceError(
                500,
                "speech_install_failed",
                "Chatterbox install did not finish",
              ),
            ),
      ),
      Effect.ensuring(
        this.activation.withPermit(
          Effect.suspend(() =>
            this.liveLease === lease && !this.worker && !this.cancellingInstall
              ? this.releaseSpeechLease().pipe(
                  Effect.catch((error) =>
                    Effect.sync(() => {
                      this.workerError = serviceError(
                        error,
                        500,
                        "speech_lease_release_failed",
                      ).message;
                    }),
                  ),
                )
              : Effect.void,
          ),
        ),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          service.workerError = error instanceof Error ? error.message : String(error);
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (service.installGeneration === generation) service.installFiber = null;
        }),
      ),
    );
    return completion.pipe(
      Effect.forkDetach({ startImmediately: true }),
      Effect.tap((fiber) =>
        Effect.sync(() => {
          this.installFiber = fiber;
        }),
      ),
      Effect.asVoid,
    );
  }
}
