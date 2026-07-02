import { Effect } from "effect";
import { delayEffect } from "../../core/async";
import {
  realProcessRunner,
  resolveBinary,
  runCommand,
  runCommandEffect,
  type ProcessRunner,
} from "../../core/command";
import type { Recipe } from "../models/types";
import { buildEnvironmentContainerCommand, environmentContainerName } from "./container-command";
import { resolveImageForEnvironment } from "./image-registry";
import type { Environment } from "./types";

export interface EnvironmentStartResult {
  started: boolean;
  message: string;
}

/** How long to wait after spawning before checking whether `docker run`
 * already died (bad image ref, missing GPU driver, etc.) — mirrors
 * `process-manager.ts`'s launch-then-verify pattern for native processes. */
const START_CHECK_DELAY_MS = 3_000;
const STOP_POLL_INTERVAL_MS = 250;
const STOP_TIMEOUT_MS = 10_000;

export const isEnvironmentRunning = (environmentId: string): boolean => {
  const docker = resolveBinary("docker");
  if (!docker) return false;
  const name = environmentContainerName(environmentId);
  const result = runCommand(docker, ["ps", "--filter", `name=^${name}$`, "--format", "{{.Names}}"]);
  return result.status === 0 && result.stdout.trim() === name;
};

export const listPulledImages = (): Set<string> => {
  const docker = resolveBinary("docker");
  if (!docker) return new Set();
  const result = runCommand(docker, ["images", "--format", "{{.Repository}}:{{.Tag}}"]);
  if (result.status !== 0) return new Set();
  return new Set(
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
};

const startEnvironmentEffect = (
  environment: Environment,
  recipe: Recipe,
  runner: ProcessRunner,
): Effect.Effect<EnvironmentStartResult> =>
  Effect.gen(function* () {
    const image = resolveImageForEnvironment(environment);
    const command = buildEnvironmentContainerCommand(
      environment.engineId,
      recipe,
      image,
      environment.id,
    );
    const entry = command[0];
    if (!entry) return { started: false, message: "Invalid container command" };

    let spawnError: string | null = null;
    const child = runner.spawnDetached(entry, command.slice(1), { stdio: "ignore" });
    child.on("error", (error) => {
      spawnError = String(error);
    });
    child.unref();

    yield* delayEffect(START_CHECK_DELAY_MS);
    if (spawnError) return { started: false, message: spawnError };
    if (child.exitCode !== null) {
      return { started: false, message: `Container exited early (code ${child.exitCode})` };
    }
    return { started: true, message: "Container starting" };
  });

export const startEnvironment = (
  environment: Environment,
  recipe: Recipe,
  runner: ProcessRunner = realProcessRunner,
): Promise<EnvironmentStartResult> =>
  Effect.runPromise(startEnvironmentEffect(environment, recipe, runner));

const stopEnvironmentEffect = (environmentId: string, force: boolean): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const docker = resolveBinary("docker");
    if (!docker) return !isEnvironmentRunning(environmentId);
    const name = environmentContainerName(environmentId);
    if (!isEnvironmentRunning(environmentId)) return true;

    yield* runCommandEffect(docker, [force ? "kill" : "stop", name], STOP_TIMEOUT_MS);

    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (Date.now() < deadline && isEnvironmentRunning(environmentId)) {
      yield* delayEffect(STOP_POLL_INTERVAL_MS);
    }
    if (!isEnvironmentRunning(environmentId)) return true;

    yield* runCommandEffect(docker, ["kill", name], STOP_TIMEOUT_MS);
    yield* delayEffect(STOP_POLL_INTERVAL_MS);
    return !isEnvironmentRunning(environmentId);
  });

export const stopEnvironment = (environmentId: string, force = false): Promise<boolean> =>
  Effect.runPromise(stopEnvironmentEffect(environmentId, force));
