import { Effect } from "effect";
import { runCommandAsyncEffect, type AsyncCommandResult } from "../../../core/command";
import { resolveNvidiaSmiBinary } from "./smi-tools";

const FULL_NVIDIA_UUID =
  /^GPU-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const QUERY_ARGS = ["--query-compute-apps=gpu_uuid,pid", "--format=csv,noheader,nounits"] as const;

export interface NvidiaComputeProcessDependencies {
  readonly resolveBinary: () => string | null;
  readonly execute: (
    command: string,
    args: string[],
  ) => Effect.Effect<Pick<AsyncCommandResult, "exitConfirmed" | "status" | "stdout">>;
}

const dependencies: NvidiaComputeProcessDependencies = {
  resolveBinary: resolveNvidiaSmiBinary,
  execute: (command, args) =>
    runCommandAsyncEffect(command, args, { timeoutMs: 5_000, maxOutputBytes: 256 * 1024 }),
};

const canonicalUuid = (uuid: string): string => `GPU-${uuid.slice(4).toLowerCase()}`;

const computeGpuUuids = (stdout: string): readonly string[] => {
  const uuids = new Set<string>();
  for (const line of stdout
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const [uuid, pid, ...extra] = line.split(",").map((value) => value.trim());
    if (!uuid || !pid || extra.length > 0 || !FULL_NVIDIA_UUID.test(uuid) || !/^\d+$/.test(pid)) {
      throw new Error("NVIDIA compute process output is invalid");
    }
    uuids.add(canonicalUuid(uuid));
  }
  return [...uuids];
};

export const queryNvidiaComputeGpuUuids = (
  injected: NvidiaComputeProcessDependencies = dependencies,
): Effect.Effect<readonly string[], Error> => {
  const binary = injected.resolveBinary();
  if (!binary) return Effect.fail(new Error("NVIDIA compute process telemetry is unavailable"));
  return injected.execute(binary, [...QUERY_ARGS]).pipe(
    Effect.flatMap((result) =>
      result.status !== 0 || result.exitConfirmed === false
        ? Effect.fail(new Error("NVIDIA compute process telemetry failed"))
        : Effect.try({
            try: () => computeGpuUuids(result.stdout),
            catch: (error) => Error(String(error)),
          }),
    ),
  );
};
