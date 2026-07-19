import { existsSync, mkdirSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { Effect } from "effect";
import type { Config } from "../../../config/env";
import { resolveBinary, runCommandAsyncEffect } from "../../../core/command";
import type { RuntimeUpgradeResult } from "@local-studio/contracts/system";
import type { InstallOptions } from "../engine-spec";

const LLAMACPP_REPO = "https://github.com/ggml-org/llama.cpp";
const MANAGED_BUILD_TIMEOUT_MS = 45 * 60_000;

export const managedLlamacppRoot = (config: Pick<Config, "data_dir">): string =>
  resolve(config.data_dir, "runtime", "llamacpp");

export const managedLlamaServerPath = (config: Pick<Config, "data_dir">): string =>
  resolve(managedLlamacppRoot(config), "src", "build", "bin", "llama-server");

const missingTool = (tool: string): RuntimeUpgradeResult => ({
  success: false,
  version: null,
  output: null,
  error: `llama.cpp source build needs "${tool}" on PATH. Install it (or set LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD / LOCAL_STUDIO_LLAMA_BIN) and retry.`,
  used_command: null,
});

const findNvcc = (): string | null => {
  const onPath = resolveBinary("nvcc");
  if (onPath) return onPath;
  return existsSync("/usr/local/cuda/bin/nvcc") ? "/usr/local/cuda/bin/nvcc" : null;
};

export const installManagedLlamacpp = (
  options: InstallOptions,
): Effect.Effect<RuntimeUpgradeResult> =>
  Effect.gen(function* () {
    for (const tool of ["git", "cmake"]) {
      if (!resolveBinary(tool)) return missingTool(tool);
    }

    const root = managedLlamacppRoot(options.config);
    const sourceDirectory = resolve(root, "src");
    mkdirSync(root, { recursive: true });

    const nvcc = findNvcc();
    const buildEnvironment = nvcc ? { ...process.env, CUDACXX: nvcc } : undefined;

    const run = (
      command: string,
      args: string[],
      cwd?: string,
    ): ReturnType<typeof runCommandAsyncEffect> =>
      runCommandAsyncEffect(command, args, {
        timeoutMs: MANAGED_BUILD_TIMEOUT_MS,
        ...(cwd ? { cwd } : {}),
        ...(buildEnvironment ? { env: buildEnvironment } : {}),
        ...(options.onSpawn ? { onSpawn: options.onSpawn } : {}),
      });

    const fail = (
      stage: string,
      result: { stdout: string; stderr: string; timedOut: boolean },
    ): RuntimeUpgradeResult => ({
      success: false,
      version: null,
      output: result.stdout || null,
      error: result.timedOut
        ? `${stage} timed out after ${Math.round(MANAGED_BUILD_TIMEOUT_MS / 60_000)} minutes`
        : result.stderr || `${stage} failed`,
      used_command: stage,
    });

    if (!existsSync(sourceDirectory)) {
      const clone = yield* run("git", ["clone", "--depth", "1", LLAMACPP_REPO, sourceDirectory]);
      if (clone.status !== 0) return fail("git clone", clone);
    } else {
      yield* run("git", ["-C", sourceDirectory, "pull", "--ff-only"]);
    }

    const cmakeFlags = [
      "-B",
      "build",
      "-DCMAKE_BUILD_TYPE=Release",
      "-DLLAMA_CURL=OFF",
      "-DLLAMA_BUILD_TESTS=OFF",
      "-DLLAMA_BUILD_EXAMPLES=OFF",
      ...(nvcc ? ["-DGGML_CUDA=ON"] : []),
    ];
    const configure = yield* run("cmake", cmakeFlags, sourceDirectory);
    if (configure.status !== 0) return fail("cmake configure", configure);

    const jobs = String(Math.max(1, cpus().length - 1));
    const build = yield* run(
      "cmake",
      ["--build", "build", "--target", "llama-server", "-j", jobs],
      sourceDirectory,
    );
    if (build.status !== 0) return fail("cmake build", build);

    const binary = managedLlamaServerPath(options.config);
    if (!existsSync(binary)) {
      return {
        success: false,
        version: null,
        output: build.stdout || null,
        error: `Build finished but ${binary} was not produced`,
        used_command: "cmake build",
      };
    }

    const version = yield* run(binary, ["--version"]);
    return {
      success: true,
      version: version.status === 0 ? (version.stdout || version.stderr).trim() || null : null,
      output: `Built llama-server at ${binary}`,
      error: null,
      used_command: "managed source build",
    };
  });
