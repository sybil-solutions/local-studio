import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import type { Config } from "../../../config/env";
import { resolveBinary, runCommandAsync } from "../../../core/command";
import type { RuntimeUpgradeResult } from "@local-studio/contracts/system";
import type { InstallOptions } from "../engine-spec";

const LLAMACPP_REPO = "https://github.com/ggml-org/llama.cpp";
const LLAMACPP_LATEST_RELEASE_API =
  "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest";
// Source builds on modest hardware need far more than the generic 10-minute
// upgrade budget; a CUDA build on an ARM box runs 20-30 minutes cold.
const MANAGED_BUILD_TIMEOUT_MS = 45 * 60_000;

export const managedLlamacppRoot = (config: Pick<Config, "data_dir">): string =>
  resolve(config.data_dir, "runtime", "llamacpp");

const managedPrebuiltRoot = (config: Pick<Config, "data_dir">): string =>
  resolve(managedLlamacppRoot(config), "prebuilt");

const findFileUnder = (root: string, fileName: string): string | null => {
  if (!existsSync(root)) return null;
  const entries = readdirSync(root, { recursive: true, encoding: "utf8" });
  const match = entries.find(
    (entry) => entry.split(/[\\/]/).at(-1)?.toLowerCase() === fileName,
  );
  return match ? resolve(root, match) : null;
};

export const managedLlamaServerPath = (config: Pick<Config, "data_dir">): string => {
  if (process.platform === "win32") {
    return (
      findFileUnder(managedPrebuiltRoot(config), "llama-server.exe") ??
      resolve(managedPrebuiltRoot(config), "llama-server.exe")
    );
  }
  return resolve(managedLlamacppRoot(config), "src", "build", "bin", "llama-server");
};

const missingTool = (tool: string): RuntimeUpgradeResult => ({
  success: false,
  version: null,
  output: null,
  error: `llama.cpp install needs "${tool}" on PATH. Install it (or set LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD / LOCAL_STUDIO_LLAMA_BIN) and retry.`,
  used_command: null,
});

const findNvcc = (): string | null => {
  const onPath = resolveBinary("nvcc");
  if (onPath) return onPath;
  return existsSync("/usr/local/cuda/bin/nvcc") ? "/usr/local/cuda/bin/nvcc" : null;
};

export type ReleaseAsset = { name: string; browser_download_url: string };

export const assetCudaVersion = (name: string): number => {
  const match = name.match(/cuda-(\d+)(?:\.(\d+))?/);
  if (!match) return 0;
  return Number(match[1]) + Number(match[2] ?? 0) / 100;
};

const detectDriverCudaVersion = async (): Promise<number | null> => {
  const result = await runCommandAsync("nvidia-smi", [], { timeoutMs: 10_000 });
  if (result.status !== 0) return null;
  const match = result.stdout.match(/CUDA Version:\s*([\d.]+)/);
  return match?.[1] ? Number.parseFloat(match[1]) : null;
};

export const pickCudaAsset = (
  assets: ReleaseAsset[],
  pattern: RegExp,
  maxCudaVersion: number | null,
): ReleaseAsset | null => {
  const candidates = assets
    .filter((asset) => pattern.test(asset.name))
    .sort((first, second) => assetCudaVersion(first.name) - assetCudaVersion(second.name));
  if (maxCudaVersion === null) return candidates[0] ?? null;
  const compatible = candidates.filter(
    (candidate) => assetCudaVersion(candidate.name) <= maxCudaVersion,
  );
  return compatible.at(-1) ?? candidates[0] ?? null;
};

const fetchLatestReleaseAssets = async (): Promise<ReleaseAsset[]> => {
  const response = await fetch(LLAMACPP_LATEST_RELEASE_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "local-studio" },
  });
  if (!response.ok) throw new Error(`GitHub release query failed: HTTP ${response.status}`);
  const release = (await response.json()) as { assets?: ReleaseAsset[] };
  return release.assets ?? [];
};

const downloadReleaseAsset = async (asset: ReleaseAsset, directory: string): Promise<string> => {
  const response = await fetch(asset.browser_download_url);
  if (!response.ok) throw new Error(`Download failed for ${asset.name}: HTTP ${response.status}`);
  const filePath = join(directory, asset.name);
  await Bun.write(filePath, response);
  return filePath;
};

const prebuiltFailure = (error: string, output?: string | null): RuntimeUpgradeResult => ({
  success: false,
  version: null,
  output: output ?? null,
  error,
  used_command: "windows prebuilt install",
});

const installPrebuiltWindowsLlamacpp = async (
  options: InstallOptions,
): Promise<RuntimeUpgradeResult> => {
  const tar = resolveBinary("tar");
  if (!tar) return missingTool("tar");

  const root = managedLlamacppRoot(options.config);
  const downloadDirectory = join(root, "downloads");
  const prebuiltDirectory = managedPrebuiltRoot(options.config);

  try {
    const assets = await fetchLatestReleaseAssets();
    const driverCuda = await detectDriverCudaVersion();
    const serverAsset = pickCudaAsset(assets, /^llama-.+-bin-win-cuda-.+-x64\.zip$/, driverCuda);
    if (!serverAsset) {
      return prebuiltFailure("No Windows CUDA build found in the latest llama.cpp release");
    }
    const serverCuda = assetCudaVersion(serverAsset.name);
    const cudartAsset =
      assets.find(
        (asset) =>
          /^cudart-.+-win-cuda-.+-x64\.zip$/.test(asset.name) &&
          assetCudaVersion(asset.name) === serverCuda,
      ) ?? null;
    if (!cudartAsset) {
      return prebuiltFailure(`No cudart runtime asset matches ${serverAsset.name}`);
    }

    mkdirSync(downloadDirectory, { recursive: true });
    const archives = [
      await downloadReleaseAsset(serverAsset, downloadDirectory),
      await downloadReleaseAsset(cudartAsset, downloadDirectory),
    ];

    rmSync(prebuiltDirectory, { recursive: true, force: true });
    mkdirSync(prebuiltDirectory, { recursive: true });
    for (const archive of archives) {
      const extract = await runCommandAsync(tar, ["-xf", archive, "-C", prebuiltDirectory], {
        timeoutMs: MANAGED_BUILD_TIMEOUT_MS,
        ...(options.onSpawn ? { onSpawn: options.onSpawn } : {}),
      });
      if (extract.status !== 0) {
        return prebuiltFailure(extract.stderr || `Extraction failed for ${archive}`);
      }
    }
    rmSync(downloadDirectory, { recursive: true, force: true });

    const binary = managedLlamaServerPath(options.config);
    if (!existsSync(binary)) {
      return prebuiltFailure(`Extraction finished but llama-server.exe was not found in ${prebuiltDirectory}`);
    }
    const version = await runCommandAsync(binary, ["--version"], { timeoutMs: 60_000 });
    return {
      success: true,
      version:
        version.status === 0 ? (version.stdout || version.stderr).trim() || null : null,
      output: `Installed ${serverAsset.name} at ${binary}`,
      error: null,
      used_command: "windows prebuilt install",
    };
  } catch (error) {
    return prebuiltFailure(String(error));
  }
};

export const installManagedLlamacpp = async (
  options: InstallOptions,
): Promise<RuntimeUpgradeResult> => {
  if (process.platform === "win32") return installPrebuiltWindowsLlamacpp(options);
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
