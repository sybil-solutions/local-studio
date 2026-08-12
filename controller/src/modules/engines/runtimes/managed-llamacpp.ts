import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { arch, cpus } from "node:os";
import { posix, resolve, win32 } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { Config } from "../../../config/env";
import { resolveBinary, runCommandAsyncEffect } from "../../../core/command";
import type { RuntimeUpgradeResult } from "@local-studio/contracts/system";
import type { InstallOptions } from "../engine-spec";
import { resolveNvidiaSmiBinary } from "../../system/platform/smi-tools";

const LLAMACPP_REPO = "https://github.com/ggml-org/llama.cpp";
const MANAGED_BUILD_TIMEOUT_MS = 45 * 60_000;
const GITHUB_API = "https://api.github.com/repos/ggml-org/llama.cpp/releases";
const WINDOWS_CUDA_VERSION = "12.4";

type GithubAsset = { name: string; browser_download_url: string };
type GithubRelease = { tag_name: string; assets: GithubAsset[] };

export const managedLlamacppRoot = (config: Pick<Config, "data_dir">): string =>
  resolve(config.data_dir, "runtime", "llamacpp");

export const managedLlamaServerPathForPlatform = (
  config: Pick<Config, "data_dir">,
  targetPlatform: NodeJS.Platform,
): string =>
  targetPlatform === "win32"
    ? win32.resolve(config.data_dir, "runtime", "llamacpp", "bin", "llama-server.exe")
    : posix.resolve(config.data_dir, "runtime", "llamacpp", "src", "build", "bin", "llama-server");

export const managedLlamaServerPath = (config: Pick<Config, "data_dir">): string =>
  managedLlamaServerPathForPlatform(config, process.platform);

export const selectWindowsLlamacppAssets = (
  release: GithubRelease,
  cuda: boolean,
): GithubAsset[] | null => {
  const names = cuda
    ? [
        `llama-${release.tag_name}-bin-win-cuda-${WINDOWS_CUDA_VERSION}-x64.zip`,
        `cudart-llama-bin-win-cuda-${WINDOWS_CUDA_VERSION}-x64.zip`,
      ]
    : [`llama-${release.tag_name}-bin-win-cpu-x64.zip`];
  const selected = names.map((name) => release.assets.find((asset) => asset.name === name));
  return selected.every((asset): asset is GithubAsset => Boolean(asset)) ? selected : null;
};

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

const installManagedLlamacppWindows = (
  options: InstallOptions,
): Effect.Effect<RuntimeUpgradeResult> =>
  Effect.gen(function* () {
    if (arch() !== "x64") {
      return {
        success: false,
        version: null,
        output: null,
        error: "Managed llama.cpp Windows installation currently supports x64 only.",
        used_command: null,
      };
    }
    const curl = resolveBinary("curl.exe") ?? resolveBinary("curl");
    if (!curl) return missingTool("curl.exe");
    const tar = resolveBinary("tar.exe") ?? resolveBinary("tar");
    if (!tar) return missingTool("tar.exe");

    const requestedTag = options.version?.trim();
    if (requestedTag && !/^[A-Za-z0-9._-]+$/.test(requestedTag)) {
      return {
        success: false,
        version: null,
        output: null,
        error: "Invalid llama.cpp release tag.",
        used_command: null,
      };
    }
    const releaseUrl = requestedTag ? `${GITHUB_API}/tags/${requestedTag}` : `${GITHUB_API}/latest`;
    const release = yield* Effect.tryPromise(async () => {
      const response = await fetch(releaseUrl, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "Local-Studio" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status})`);
      const value = (await response.json()) as GithubRelease;
      if (!value.tag_name || !Array.isArray(value.assets))
        throw new Error("Invalid GitHub release");
      return value;
    });

    const cuda = Boolean(resolveNvidiaSmiBinary());
    const assets = selectWindowsLlamacppAssets(release, cuda);
    if (!assets) {
      return {
        success: false,
        version: null,
        output: null,
        error: `Release ${release.tag_name} does not provide the expected Windows ${cuda ? `CUDA ${WINDOWS_CUDA_VERSION}` : "CPU"} x64 artifacts.`,
        used_command: "GitHub release lookup",
      };
    }

    const root = managedLlamacppRoot(options.config);
    const staging = resolve(root, `.install-${randomUUID()}`);
    const target = resolve(root, "bin");
    const backup = resolve(root, `.previous-${randomUUID()}`);
    mkdirSync(staging, { recursive: true });
    options.onProgress?.({ progress: 0.1, message: `Downloading llama.cpp ${release.tag_name}` });

    const run = (command: string, args: string[]): ReturnType<typeof runCommandAsyncEffect> =>
      runCommandAsyncEffect(command, args, {
        timeoutMs: MANAGED_BUILD_TIMEOUT_MS,
        ...(options.onSpawn ? { onSpawn: options.onSpawn } : {}),
      });

    for (const [index, asset] of assets.entries()) {
      const archive = resolve(staging, asset.name);
      const download = yield* run(curl, [
        "-L",
        "--fail",
        "--retry",
        "3",
        "--output",
        archive,
        asset.browser_download_url,
      ]);
      if (download.status !== 0) {
        rmSync(staging, { recursive: true, force: true });
        return {
          success: false,
          version: null,
          output: download.stdout || null,
          error: download.stderr || `Failed to download ${asset.name}`,
          used_command: "curl",
        };
      }
      const extract = yield* run(tar, ["-xf", archive, "-C", staging]);
      rmSync(archive, { force: true });
      if (extract.status !== 0) {
        rmSync(staging, { recursive: true, force: true });
        return {
          success: false,
          version: null,
          output: extract.stdout || null,
          error: extract.stderr || `Failed to extract ${asset.name}`,
          used_command: "tar",
        };
      }
      options.onProgress?.({
        progress: 0.2 + ((index + 1) / assets.length) * 0.6,
        message: `Extracted ${asset.name}`,
      });
    }

    const binary = resolve(staging, "llama-server.exe");
    if (!existsSync(binary)) {
      rmSync(staging, { recursive: true, force: true });
      return {
        success: false,
        version: null,
        output: null,
        error: `Release ${release.tag_name} did not contain llama-server.exe`,
        used_command: "tar",
      };
    }
    const version = yield* run(binary, ["--version"]);
    if (version.status !== 0) {
      rmSync(staging, { recursive: true, force: true });
      return {
        success: false,
        version: null,
        output: version.stdout || null,
        error: version.stderr || "Downloaded llama-server.exe could not start",
        used_command: "llama-server.exe --version",
      };
    }

    if (existsSync(target)) renameSync(target, backup);
    try {
      renameSync(staging, target);
      rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      if (existsSync(backup) && !existsSync(target)) renameSync(backup, target);
      throw error;
    }
    options.onProgress?.({ progress: 1, message: `Installed llama.cpp ${release.tag_name}` });
    return {
      success: true,
      version: (version.stdout || version.stderr).trim() || release.tag_name,
      output: `Installed llama-server.exe at ${managedLlamaServerPath(options.config)}`,
      error: null,
      used_command: "official llama.cpp Windows release",
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed({
        success: false,
        version: null,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        used_command: "managed Windows install",
      }),
    ),
  );

const installManagedLlamacppPosix = (
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

export const installManagedLlamacpp = (
  options: InstallOptions,
): Effect.Effect<RuntimeUpgradeResult> =>
  process.platform === "win32"
    ? installManagedLlamacppWindows(options)
    : installManagedLlamacppPosix(options);
