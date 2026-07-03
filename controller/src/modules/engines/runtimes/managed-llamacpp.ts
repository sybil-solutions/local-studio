import { existsSync, mkdirSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import type { Config } from "../../../config/env";
import { resolveBinary, runCommandAsync } from "../../../core/command";
import type { RuntimeUpgradeResult } from "@local-studio/contracts/system";
import type { InstallOptions } from "../engine-spec";

const LLAMACPP_REPO = "https://github.com/ggml-org/llama.cpp";
// Source builds on modest hardware need far more than the generic 10-minute
// upgrade budget; a CUDA build on an ARM box runs 20-30 minutes cold.
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

/**
 * Default llama.cpp installer: shallow-clone upstream and build `llama-server`
 * into the controller-managed data dir. Used when no upgrade command is
 * configured, so first-run onboarding works without any manual setup.
 */
export const installManagedLlamacpp = async (
  options: InstallOptions,
): Promise<RuntimeUpgradeResult> => {
  for (const tool of ["git", "cmake"]) {
    if (!resolveBinary(tool)) return missingTool(tool);
  }

  const root = managedLlamacppRoot(options.config);
  const sourceDirectory = resolve(root, "src");
  mkdirSync(root, { recursive: true });

  const nvcc = findNvcc();
  // cmake resolves the CUDA compiler itself; a controller launched from a
  // service unit usually lacks /usr/local/cuda/bin on PATH, so point CUDACXX
  // at the nvcc we found instead of relying on the inherited environment.
  const buildEnvironment = nvcc ? { ...process.env, CUDACXX: nvcc } : undefined;

  const run = (
    command: string,
    args: string[],
    cwd?: string,
  ): ReturnType<typeof runCommandAsync> =>
    runCommandAsync(command, args, {
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
    const clone = await run("git", ["clone", "--depth", "1", LLAMACPP_REPO, sourceDirectory]);
    if (clone.status !== 0) return fail("git clone", clone);
  } else {
    // Refresh best-effort; an offline box can still rebuild what it has.
    await run("git", ["-C", sourceDirectory, "pull", "--ff-only"]);
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
  const configure = await run("cmake", cmakeFlags, sourceDirectory);
  if (configure.status !== 0) return fail("cmake configure", configure);

  const jobs = String(Math.max(1, cpus().length - 1));
  const build = await run(
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

  const version = await run(binary, ["--version"]);
  return {
    success: true,
    version: version.status === 0 ? (version.stdout || version.stderr).trim() || null : null,
    output: `Built llama-server at ${binary}`,
    error: null,
    used_command: "managed source build",
  };
};
