import { Effect } from "effect";
import type {
  EngineBackend,
  RuntimeBackendInfo,
  RuntimeTarget,
} from "@local-studio/contracts/system";
import { resolveBinary, runCommandEffect } from "../../../core/command";
import { ENGINE_IDS, type HostProfile } from "../../compute/contracts";
import { engineSpec } from "../../compute/engines/registry";

/**
 * Runtime targets, docker-only: one row per roster engine. "Installed" means
 * the engine's pinned image is pulled; "active" means a container is running
 * from it. There is nothing else to discover — no venvs, no system installs,
 * no bundled wheels — which is the whole point.
 */

const ENGINE_LABEL: Record<EngineBackend, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  exllamav3: "exllamav3 (TabbyAPI)",
};

const DOCKER_COMMAND_TIMEOUT_MS = 3_000;
const TARGET_CACHE_TTL_MS = 15_000;

interface DockerImageState {
  readonly available: boolean;
  readonly pulled: ReadonlySet<string>;
  readonly running: ReadonlySet<string>;
}

let cache: { expiresAt: number; value: RuntimeTarget[] } | null = null;

export const clearRuntimeTargetsCache = (): void => {
  cache = null;
};

const dockerImageState = (): Effect.Effect<DockerImageState> =>
  Effect.gen(function* () {
    const docker = resolveBinary("docker");
    if (!docker) return { available: false, pulled: new Set<string>(), running: new Set<string>() };
    const parse = (stdout: string): Set<string> =>
      new Set(
        stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      );
    const images = yield* runCommandEffect(
      docker,
      ["images", "--format", "{{.Repository}}:{{.Tag}}"],
      DOCKER_COMMAND_TIMEOUT_MS,
    );
    const processes = yield* runCommandEffect(
      docker,
      ["ps", "--format", "{{.Image}}"],
      DOCKER_COMMAND_TIMEOUT_MS,
    );
    return {
      available: images.status === 0,
      pulled: images.status === 0 ? parse(images.stdout) : new Set<string>(),
      running: processes.status === 0 ? parse(processes.stdout) : new Set<string>(),
    };
  }).pipe(
    Effect.catch(() =>
      Effect.succeed({
        available: false,
        pulled: new Set<string>(),
        running: new Set<string>(),
      } satisfies DockerImageState),
    ),
  );

const imageTag = (image: string): string | null => {
  const tag = image.split(":").at(-1);
  return tag && tag !== image ? tag : null;
};

export const pinnedImageFor = (backend: EngineBackend, host: HostProfile): string | null =>
  engineSpec(backend).image(host);

export const getRuntimeTargets = (host: HostProfile): Effect.Effect<RuntimeTarget[]> =>
  Effect.gen(function* () {
    const now = Date.now();
    if (cache && cache.expiresAt > now) return cache.value;
    const docker = yield* dockerImageState();
    const targets: RuntimeTarget[] = [];
    for (const backend of ENGINE_IDS) {
      const spec = engineSpec(backend);
      const support = spec.supports(host);
      const image = spec.image(host);
      const installed = image !== null && docker.pulled.has(image);
      const running = image !== null && docker.running.has(image);
      targets.push({
        id: `docker:${backend}`,
        backend,
        kind: "docker",
        label: `${ENGINE_LABEL[backend]} (Docker)`,
        installed,
        active: running,
        version: image ? imageTag(image) : null,
        dockerImage: image,
        source: running ? "running" : "discovered",
        capabilities: {
          canLaunch: support.ok && installed,
          canUpdate: support.ok && docker.available,
          canInspectOptions: false,
          supportsDocker: true,
        },
        health: support.ok
          ? { status: installed ? "ok" : "warning", ...(installed ? {} : { message: `Image not pulled: ${image ?? "unavailable"}` }) }
          : { status: "error", message: support.reason },
      });
    }
    cache = { expiresAt: now + TARGET_CACHE_TTL_MS, value: targets };
    return targets;
  });

export const getDefaultRuntimeTarget = (
  host: HostProfile,
  backend: EngineBackend,
): Effect.Effect<RuntimeTarget | null> =>
  getRuntimeTargets(host).pipe(
    Effect.map((targets) => targets.find((target) => target.backend === backend) ?? null),
  );

export const runtimeTargetToBackendInfo = (target: RuntimeTarget | null): RuntimeBackendInfo => ({
  installed: target?.installed ?? false,
  version: target?.version ?? null,
  python_path: null,
  binary_path: null,
  upgrade_command_available: target?.capabilities.canUpdate ?? false,
});
