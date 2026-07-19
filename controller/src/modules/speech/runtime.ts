import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Effect, Fiber, Schema, Semaphore } from "effect";
import {
  CHATTERBOX_MODEL_REVISION,
  CHATTERBOX_PACKAGE_VERSION,
} from "@local-studio/contracts/speech";
import { CommandTerminationError, resolveBinary, runCommandAsyncEffect } from "../../core/command";
import { prepareChatterboxStorage, secureSpeechDirectory } from "./storage";

export const CHATTERBOX_PACKAGE_SPEC = `chatterbox-tts==${CHATTERBOX_PACKAGE_VERSION}`;

const INSTALL_TIMEOUT_MS = 30 * 60_000;
const PREFETCH_TIMEOUT_MS = 60 * 60_000;

const InstallRecordSchema = Schema.Struct({
  packageVersion: Schema.Literal(CHATTERBOX_PACKAGE_VERSION),
  modelRevision: Schema.Literal(CHATTERBOX_MODEL_REVISION),
  gpuUuid: Schema.String,
  installedAt: Schema.String,
});

export type ChatterboxInstallStage =
  | "preparing"
  | "creating_runtime"
  | "installing_package"
  | "prefetching_model";

export type ChatterboxRuntimeState =
  | { readonly status: "not_installed" }
  | {
      readonly status: "installing";
      readonly stage: ChatterboxInstallStage;
      readonly progress: number;
      readonly gpuUuid: string;
    }
  | {
      readonly status: "installed";
      readonly packageVersion: typeof CHATTERBOX_PACKAGE_VERSION;
      readonly modelRevision: typeof CHATTERBOX_MODEL_REVISION;
      readonly gpuUuid: string;
      readonly installedAt: string;
    }
  | { readonly status: "error"; readonly gpuUuid: string; readonly message: string };

export type ChatterboxRuntimePaths = {
  readonly runtimeDirectory: string;
  readonly pythonPath: string;
  readonly speechDirectory: string;
  readonly cacheDirectory: string;
  readonly voiceDirectory: string;
  readonly outputDirectory: string;
  readonly uploadDirectory: string;
  readonly installRecordPath: string;
  readonly workerPath: string;
};

export type SpeechRuntimeCommandResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly exitConfirmed?: boolean | undefined;
};

export type SpeechRuntimeCommandOptions = {
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs: number;
};

export type ChatterboxInstallOptions = {
  readonly repair?: boolean | undefined;
};

export type SpeechRuntimeCommand = (
  command: string,
  args: string[],
  options: SpeechRuntimeCommandOptions,
) => Effect.Effect<SpeechRuntimeCommandResult, Error>;

export type ChatterboxRuntimeOptions = {
  readonly dataDirectory: string;
  readonly workerPath?: string | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly resolveBinary?: ((name: string) => string | null) | undefined;
  readonly runCommand?: SpeechRuntimeCommand | undefined;
  readonly now?: (() => Date) | undefined;
  readonly installTimeoutMs?: number | undefined;
  readonly prefetchTimeoutMs?: number | undefined;
};

type RuntimeDependencies = {
  readonly resolveBinary: (name: string) => string | null;
  readonly runCommand: SpeechRuntimeCommand;
  readonly now: () => Date;
  readonly installTimeoutMs: number;
  readonly prefetchTimeoutMs: number;
  readonly environment: NodeJS.ProcessEnv;
};

const defaultWorkerPath = fileURLToPath(new URL("worker.py", import.meta.url));

export const chatterboxRuntimePaths = (
  dataDirectory: string,
  workerPath = defaultWorkerPath,
): ChatterboxRuntimePaths => {
  const runtimeDirectory = join(
    dataDirectory,
    "runtime",
    "venvs",
    `chatterbox-${CHATTERBOX_PACKAGE_VERSION}`,
  );
  const speechDirectory = join(dataDirectory, "runtime", "speech");
  return {
    runtimeDirectory,
    pythonPath: join(runtimeDirectory, "bin", "python"),
    speechDirectory,
    cacheDirectory: join(speechDirectory, "huggingface"),
    voiceDirectory: join(speechDirectory, "voices"),
    outputDirectory: join(speechDirectory, "outputs"),
    uploadDirectory: join(speechDirectory, "uploads"),
    installRecordPath: join(speechDirectory, `chatterbox-${CHATTERBOX_PACKAGE_VERSION}.json`),
    workerPath,
  };
};

export const chatterboxWorkerEnvironment = (
  paths: ChatterboxRuntimePaths,
  gpuUuid: string,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  const inherited = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LD_LIBRARY_PATH",
    "DYLD_LIBRARY_PATH",
  ].flatMap((name) => {
    const value = environment[name];
    return value === undefined ? [] : [[name, value] as const];
  });
  return {
    ...Object.fromEntries(inherited),
    CUDA_DEVICE_ORDER: "PCI_BUS_ID",
    CUDA_VISIBLE_DEVICES: gpuUuid,
    HF_HOME: paths.cacheDirectory,
    HF_HUB_DISABLE_TELEMETRY: "1",
    PYTHONNOUSERSITE: "1",
    PYTHONUNBUFFERED: "1",
  };
};

const defaultRunCommand: SpeechRuntimeCommand = (command, args, options) =>
  runCommandAsyncEffect(command, args, {
    timeoutMs: options.timeoutMs,
    maxOutputBytes: 64 * 1024,
    ...(options.env ? { env: options.env } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const validGpuUuid = (gpuUuid: string): boolean =>
  /^GPU-[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/.test(gpuUuid);

const readInstalledState = (paths: ChatterboxRuntimePaths): ChatterboxRuntimeState => {
  if (!existsSync(paths.pythonPath) || !existsSync(paths.installRecordPath)) {
    return { status: "not_installed" };
  }
  try {
    const record = Schema.decodeUnknownSync(InstallRecordSchema)(
      JSON.parse(readFileSync(paths.installRecordPath, "utf8")),
    );
    return { status: "installed", ...record };
  } catch {
    return { status: "not_installed" };
  }
};

const failedCommandMessage = (label: string, result: SpeechRuntimeCommandResult): string => {
  if (result.timedOut) return `${label} timed out`;
  return result.stderr.trim() || result.stdout.trim() || `${label} failed`;
};

export class ChatterboxRuntime {
  readonly paths: ChatterboxRuntimePaths;
  private readonly dependencies: RuntimeDependencies;
  private readonly installSemaphore = Semaphore.makeUnsafe(1);
  private state: ChatterboxRuntimeState;
  private installFiber: Fiber.Fiber<ChatterboxRuntimeState, never> | null = null;
  private installGeneration = 0;
  private installAbort: AbortController | null = null;

  constructor(options: ChatterboxRuntimeOptions) {
    this.paths = chatterboxRuntimePaths(options.dataDirectory, options.workerPath);
    prepareChatterboxStorage(this.paths);
    this.dependencies = {
      resolveBinary: options.resolveBinary ?? resolveBinary,
      runCommand: options.runCommand ?? defaultRunCommand,
      now: options.now ?? ((): Date => new Date()),
      installTimeoutMs: options.installTimeoutMs ?? INSTALL_TIMEOUT_MS,
      prefetchTimeoutMs: options.prefetchTimeoutMs ?? PREFETCH_TIMEOUT_MS,
      environment: options.environment ?? process.env,
    };
    this.state = readInstalledState(this.paths);
  }

  getState(): ChatterboxRuntimeState {
    return this.state;
  }

  startInstall(
    gpuUuid: string,
    options: ChatterboxInstallOptions = {},
  ): Effect.Effect<ChatterboxRuntimeState, Error> {
    const runtime = this;
    return Effect.gen(function* () {
      if (
        runtime.state.status === "installing" ||
        (runtime.state.status === "installed" && !options.repair)
      ) {
        return runtime.state;
      }
      if (!validGpuUuid(gpuUuid)) {
        runtime.state = {
          status: "error",
          gpuUuid,
          message: "A full NVIDIA GPU UUID is required",
        };
        return runtime.state;
      }
      if (options.repair) {
        yield* Effect.try({
          try: () => {
            rmSync(runtime.paths.installRecordPath, { force: true });
            rmSync(`${runtime.paths.installRecordPath}.tmp`, { force: true });
          },
          catch: (source) => (source instanceof Error ? source : new Error(String(source))),
        });
      }
      const abort = new AbortController();
      runtime.installAbort = abort;
      const installing: ChatterboxRuntimeState = {
        status: "installing",
        stage: "preparing",
        progress: 0.05,
        gpuUuid,
      };
      runtime.state = installing;
      const generation = ++runtime.installGeneration;
      const program = runtime.installSemaphore
        .withPermit(runtime.installEffect(gpuUuid, abort.signal))
        .pipe(
          Effect.match({
            onFailure: (error) => {
              runtime.state = {
                status: "error",
                gpuUuid,
                message: abort.signal.aborted
                  ? "Chatterbox install cancelled"
                  : errorMessage(error),
              };
              return runtime.state;
            },
            onSuccess: (installed) => {
              runtime.state = installed;
              return installed;
            },
          }),
          Effect.ensuring(
            Effect.sync(() => {
              if (runtime.installGeneration === generation) runtime.installAbort = null;
            }),
          ),
        );
      runtime.installFiber = yield* program.pipe(Effect.forkDetach({ startImmediately: true }));
      return installing;
    });
  }

  waitForInstall(): Effect.Effect<ChatterboxRuntimeState> {
    return this.installFiber
      ? Fiber.await(this.installFiber).pipe(Effect.andThen(Effect.sync(() => this.state)))
      : Effect.succeed(this.state);
  }

  install(
    gpuUuid: string,
    options: ChatterboxInstallOptions = {},
  ): Effect.Effect<ChatterboxRuntimeState, Error> {
    return this.startInstall(gpuUuid, options).pipe(
      Effect.andThen(Effect.suspend(() => this.waitForInstall())),
    );
  }

  cancelInstall(): Effect.Effect<void> {
    const abort = this.installAbort;
    const fiber = this.installFiber;
    if (!abort || !fiber) return Effect.void;
    abort.abort();
    return Fiber.interrupt(fiber).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.state = {
            status: "error",
            gpuUuid:
              this.state.status === "installing" || this.state.status === "error"
                ? this.state.gpuUuid
                : "",
            message: "Chatterbox install cancelled",
          };
        }),
      ),
      Effect.asVoid,
    );
  }

  private setInstalling(gpuUuid: string, stage: ChatterboxInstallStage, progress: number): void {
    this.state = { status: "installing", stage, progress, gpuUuid };
  }

  private commandEffect(
    label: string,
    command: string,
    args: string[],
    options: SpeechRuntimeCommandOptions,
  ): Effect.Effect<void, Error> {
    return this.dependencies
      .runCommand(command, args, options)
      .pipe(
        Effect.flatMap((result) =>
          result.exitConfirmed === false
            ? Effect.fail(new CommandTerminationError())
            : result.status === 0
              ? Effect.void
              : Effect.fail(new Error(failedCommandMessage(label, result))),
        ),
      );
  }

  private installEffect(
    gpuUuid: string,
    signal: AbortSignal,
  ): Effect.Effect<ChatterboxRuntimeState, Error> {
    const paths = this.paths;
    const dependencies = this.dependencies;
    const runtime = this;
    return Effect.gen(function* () {
      if (!existsSync(paths.workerPath)) {
        return yield* Effect.fail(new Error("Chatterbox worker resource is unavailable"));
      }
      yield* Effect.try({
        try: () => {
          mkdirSync(dirname(paths.runtimeDirectory), { recursive: true });
          prepareChatterboxStorage(paths);
        },
        catch: (error) => new Error(`Could not prepare Chatterbox storage: ${errorMessage(error)}`),
      });

      const uv = dependencies.resolveBinary("uv");
      const python = dependencies.resolveBinary("python3.11");
      const environment = chatterboxWorkerEnvironment(paths, gpuUuid, dependencies.environment);
      if (!uv && !python) {
        return yield* Effect.fail(new Error("Python 3.11 is required to install Chatterbox"));
      }

      if (!existsSync(paths.pythonPath)) {
        runtime.setInstalling(gpuUuid, "creating_runtime", 0.15);
        if (uv) {
          yield* runtime.commandEffect(
            "Creating the Chatterbox runtime",
            uv,
            ["venv", "--python", "3.11", paths.runtimeDirectory],
            { timeoutMs: dependencies.installTimeoutMs, env: environment, signal },
          );
        } else if (python) {
          yield* runtime.commandEffect(
            "Creating the Chatterbox runtime",
            python,
            ["-m", "venv", paths.runtimeDirectory],
            { timeoutMs: dependencies.installTimeoutMs, env: environment, signal },
          );
        }
      }
      secureSpeechDirectory(paths.runtimeDirectory);

      runtime.setInstalling(gpuUuid, "installing_package", 0.35);
      if (uv) {
        yield* runtime.commandEffect(
          "Installing Chatterbox",
          uv,
          [
            "pip",
            "install",
            "--python",
            paths.pythonPath,
            "--torch-backend=cu124",
            "--upgrade",
            CHATTERBOX_PACKAGE_SPEC,
          ],
          { timeoutMs: dependencies.installTimeoutMs, env: environment, signal },
        );
      } else {
        yield* runtime.commandEffect("Checking pip", paths.pythonPath, ["-m", "pip", "--version"], {
          timeoutMs: 10_000,
          env: environment,
          signal,
        });
        yield* runtime.commandEffect(
          "Installing the CUDA 12.4 PyTorch runtime",
          paths.pythonPath,
          [
            "-m",
            "pip",
            "install",
            "--upgrade",
            "torch==2.6.0+cu124",
            "torchaudio==2.6.0+cu124",
            "--index-url",
            "https://download.pytorch.org/whl/cu124",
          ],
          { timeoutMs: dependencies.installTimeoutMs, env: environment, signal },
        );
        yield* runtime.commandEffect(
          "Installing Chatterbox",
          paths.pythonPath,
          ["-m", "pip", "install", "--upgrade", CHATTERBOX_PACKAGE_SPEC],
          { timeoutMs: dependencies.installTimeoutMs, env: environment, signal },
        );
      }

      runtime.setInstalling(gpuUuid, "prefetching_model", 0.75);
      yield* runtime.commandEffect(
        "Prefetching the pinned Chatterbox Turbo model",
        paths.pythonPath,
        [paths.workerPath, "--prefetch"],
        {
          timeoutMs: dependencies.prefetchTimeoutMs,
          env: environment,
          signal,
        },
      );

      if (signal.aborted) return yield* Effect.fail(new Error("Chatterbox install cancelled"));

      const installedAt = dependencies.now().toISOString();
      const installed: ChatterboxRuntimeState = {
        status: "installed",
        packageVersion: CHATTERBOX_PACKAGE_VERSION,
        modelRevision: CHATTERBOX_MODEL_REVISION,
        gpuUuid,
        installedAt,
      };
      yield* Effect.try({
        try: () => {
          const temporaryPath = `${paths.installRecordPath}.tmp`;
          writeFileSync(
            temporaryPath,
            JSON.stringify({
              packageVersion: CHATTERBOX_PACKAGE_VERSION,
              modelRevision: CHATTERBOX_MODEL_REVISION,
              gpuUuid,
              installedAt,
            }),
            { mode: 0o600 },
          );
          renameSync(temporaryPath, paths.installRecordPath);
          chmodSync(paths.installRecordPath, 0o600);
        },
        catch: (error) =>
          new Error(`Could not record the Chatterbox install: ${errorMessage(error)}`),
      });
      return installed;
    });
  }
}
