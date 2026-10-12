import { Effect } from "effect";
import type { Config } from "../../config/env";
import { runCommandAsyncEffect } from "../../core/command";
import type { Recipe } from "../models/types";
import type { EventManager } from "../system/event-manager";
import { createActiveModel, type ActiveModel } from "./active-model";
import type { DeviceId, HostProfile, EngineRuntimeKind } from "./contracts";
import { makeTelemetry, profileFrom, type Telemetry } from "./devices/snapshot";
import { makeInstanceStore, type InstanceStore } from "./instances/store";
import { makeDockerLauncher } from "./launchers/docker";
import type { Launcher } from "./launchers/launcher";
import { makeComputeService, type ComputeService } from "./lifecycle";

/**
 * Assembly point: telemetry + store + launchers wired into one ComputeService, plus
 * the one-active-model surface. This is the compute layer's entire footprint in
 * AppContext — there is no other state.
 */

export interface Compute {
  readonly service: ComputeService;
  readonly telemetry: Telemetry;
  readonly store: InstanceStore;
  readonly host: () => Effect.Effect<HostProfile>;
  readonly model: ActiveModel;
}

const DOCKER_PROBE_TIMEOUT_MS = 5_000;
/** Docker appearing or losing GPU passthrough mid-run is rare; refresh occasionally. */
const DOCKER_PROBE_TTL_MS = 60_000;

interface DockerStatus {
  readonly docker: boolean;
  readonly dockerGpu: boolean;
}

const probeDocker = (): Effect.Effect<DockerStatus> =>
  Effect.gen(function* () {
    const info = yield* runCommandAsyncEffect("docker", ["info", "--format", "{{.Runtimes}}"], {
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    });
    if (info.status !== 0) return { docker: false, dockerGpu: false };
    // The NVIDIA container runtime advertises itself in `docker info`; ROCm needs no
    // special runtime (plain device mounts), so any working docker on linux counts.
    const gpuRuntime = info.stdout.includes("nvidia");
    return { docker: true, dockerGpu: gpuRuntime || process.platform === "linux" };
  }).pipe(Effect.catchCause(() => Effect.succeed({ docker: false, dockerGpu: false })));

export const makeCompute = (
  config: Config,
  eventManager: EventManager,
  getRecipe: (recipeId: string) => Effect.Effect<Recipe | null, unknown>,
): Compute => {
  const telemetry = makeTelemetry({
    storagePaths: [config.data_dir, config.models_dir],
  });
  const store = makeInstanceStore(config.data_dir);

  let dockerCache: { readonly at: number; readonly value: DockerStatus } | null = null;
  const dockerStatus = (): Effect.Effect<DockerStatus> =>
    Effect.gen(function* () {
      if (dockerCache && Date.now() - dockerCache.at < DOCKER_PROBE_TTL_MS) {
        return dockerCache.value;
      }
      const value = yield* probeDocker();
      dockerCache = { at: Date.now(), value };
      return value;
    });

  let lastProfile: HostProfile | null = null;
  const host = (): Effect.Effect<HostProfile> =>
    Effect.gen(function* () {
      const snapshot = yield* telemetry.snapshot();
      const docker = yield* dockerStatus();
      const profile = profileFrom(snapshot, {
        nodeId: "self",
        docker: docker.docker,
        dockerGpu: docker.dockerGpu,
      });
      lastProfile = profile;
      return profile;
    });

  const launcherFor = (_runtime: EngineRuntimeKind): Launcher =>
    makeDockerLauncher(lastProfile?.accelerator ?? "cuda");

  const freeDevices = (): Effect.Effect<readonly DeviceId[]> =>
    telemetry
      .snapshot()
      .pipe(Effect.map((snapshot) => snapshot.accelerators.map((accelerator) => accelerator.id)));

  const service = makeComputeService({
    store,
    launcherFor,
    host,
    freeDevices,
    onEvent: (name, stage, message) =>
      eventManager.publishLaunchProgress(name, stage, message),
  });

  const model = createActiveModel({ config, compute: service, store, getRecipe });

  return { service, telemetry, store, host, model };
};
