import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { Effect, Schema } from "effect";
import type { Config } from "../../config/env";
import type { AsyncCommandOptions, AsyncCommandResult } from "../../core/command";
import type { EngineBackend, RuntimeUpgradeResult } from "@local-studio/contracts/system";
import { runInWslWithOptions } from "../compute/wsl-platform";
import { ENGINE_INSTALL_TIMEOUT_MS } from "./configs";
import type { InstallProgressUpdate } from "./runtimes/managed-venv";

export type WslManagedBackend = Extract<EngineBackend, "vllm" | "sglang">;

const WslManagedRuntimeReceiptSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  backend: Schema.Literals(["vllm", "sglang"]),
  distribution: Schema.String,
  root: Schema.String,
  pythonPath: Schema.String,
  binaryPath: Schema.String,
  version: Schema.String,
  installedAt: Schema.String,
});

const RuntimeProbeSchema = Schema.Struct({
  version: Schema.String,
  cuda: Schema.Boolean,
  devices: Schema.Number,
});

const SglangTorchPackagesSchema = Schema.Struct({
  torch: Schema.String,
  torchvision: Schema.String,
  torchaudio: Schema.String,
});

const SglangKernelSchema = Schema.Struct({
  version: Schema.String,
  cuda: Schema.String,
  architecture: Schema.String,
});

export type WslManagedRuntimeReceipt = Schema.Schema.Type<typeof WslManagedRuntimeReceiptSchema>;

export interface WslManagedRuntimePaths {
  root: string;
  parent: string;
  pythonRoot: string;
  venvRoot: string;
  pythonPath: string;
  packageBinaryPath: string;
  binaryPath: string;
  staging: string;
  backup: string;
}

type WslCommandRunner = (
  distribution: string,
  args: readonly string[],
  options: AsyncCommandOptions,
) => Effect.Effect<AsyncCommandResult>;

interface WslManagedRuntimeOptions {
  config: Config;
  backend: WslManagedBackend;
  distribution: string;
  version?: string | undefined;
  onProgress?: ((update: InstallProgressUpdate) => void) | undefined;
  onSpawn?: ((child: ChildProcess) => void) | undefined;
  runner?: WslCommandRunner | undefined;
}

const PROBE_SCRIPT =
  'import importlib.metadata as m,json,sys,torch; print(json.dumps({"version":m.version(sys.argv[1]),"cuda":torch.cuda.is_available(),"devices":torch.cuda.device_count()}))';
const CUDA_VERSION_SCRIPT = "import torch; print(torch.version.cuda or '')";
const CUDA_ROOT_SCRIPT =
  "from pathlib import Path; import site; roots=[p for base in site.getsitepackages() for p in (Path(base)/'nvidia').glob('cu*') if (p/'bin'/'nvcc').is_file() and (p/'include'/'cuda.h').is_file()]; print(roots[0] if roots else '')";
const SGLANG_TORCH_PACKAGES_SCRIPT =
  "import importlib.metadata as m,json; print(json.dumps({p:m.version(p).split('+')[0] for p in ('torch','torchvision','torchaudio')}))";
const SGLANG_KERNEL_SCRIPT =
  "import importlib.metadata as m,json,platform,torch; print(json.dumps({'version':m.version('sgl-kernel').split('+')[0],'cuda':torch.version.cuda or '','architecture':platform.machine()}))";
const SGLANG_KERNEL_PROBE_SCRIPT = "import sgl_kernel";
const RELOCATE_SCRIPT = [
  "from pathlib import Path",
  "import os,sys",
  "old,new=sys.argv[1:3]",
  "venv=Path(new)/'venv'",
  "wrapper_dir=Path(new)/'bin'",
  "paths=[venv/'pyvenv.cfg',*(venv/'bin').iterdir(),*(wrapper_dir.iterdir() if wrapper_dir.is_dir() else [])]",
  "for path in paths:",
  " if path.is_symlink():",
  "  target=os.readlink(path)",
  "  if old in target:",
  "   path.unlink()",
  "   path.symlink_to(target.replace(old,new))",
  " elif path.is_file():",
  "  data=path.read_bytes()",
  "  replaced=data.replace(old.encode(),new.encode())",
  "  if replaced != data: path.write_bytes(replaced)",
].join("\n");
const WRAPPER_SCRIPT = [
  "from pathlib import Path",
  "import os,shlex,sys",
  "wrapper,target,cuda,backend=sys.argv[1:5]",
  "target_bin=str(Path(target).parent)",
  "lines=['#!/bin/sh']",
  "if cuda:",
  " lines.extend([f'CUDA_HOME={shlex.quote(cuda)}','export CUDA_HOME',f'PATH={shlex.quote(cuda + \"/bin\")}:{shlex.quote(target_bin)}:$PATH',f'CPATH={shlex.quote(cuda + \"/include\")}${{CPATH:+\":$CPATH\"}}',f'LIBRARY_PATH={shlex.quote(cuda + \"/lib:/usr/lib/wsl/lib\")}${{LIBRARY_PATH:+\":$LIBRARY_PATH\"}}',f'LD_LIBRARY_PATH={shlex.quote(cuda + \"/lib:/usr/lib/wsl/lib\")}${{LD_LIBRARY_PATH:+\":$LD_LIBRARY_PATH\"}}','export PATH CPATH LIBRARY_PATH LD_LIBRARY_PATH'])",
  "else:",
  " lines.extend([f'PATH={shlex.quote(target_bin)}:$PATH','export PATH'])",
  "if backend=='sglang':",
  " lines.extend(['if [ \"${1:-}\" = serve ]; then',' shift',f' exec {shlex.quote(str(Path(target).parent / \"python\"))} -m sglang.launch_server \"$@\"','fi'])",
  "lines.append(f'exec {shlex.quote(target)} \"$@\"')",
  "path=Path(wrapper)",
  "path.parent.mkdir(parents=True,exist_ok=True)",
  "path.write_text('\\n'.join(lines)+'\\n')",
  "os.chmod(path,0o755)",
].join("\n");
const MANAGED_PYTHON_VERSION = "3.12";
const CUDA_COMPILER_PACKAGES = [
  "nvidia-cuda-runtime",
  "nvidia-cuda-nvcc",
  "nvidia-cuda-crt",
  "nvidia-nvvm",
  "nvidia-cuda-cccl",
] as const;
const MAX_OUTPUT_TAIL_LENGTH = 4000;
const COMMAND_TIMEOUT_MS = 120_000;
const JOB_OUTPUT_THROTTLE_MS = 1_000;

const tailOutput = (value: string): string =>
  value.length > MAX_OUTPUT_TAIL_LENGTH ? value.slice(-MAX_OUTPUT_TAIL_LENGTH) : value;

const receiptDirectory = (config: Pick<Config, "data_dir">, distribution: string): string =>
  join(config.data_dir, "runtime", "wsl2", Buffer.from(distribution).toString("base64url"));

export const wslManagedRuntimeReceiptPath = (
  config: Pick<Config, "data_dir">,
  distribution: string,
  backend: WslManagedBackend,
): string => join(receiptDirectory(config, distribution), `${backend}.json`);

export const readWslManagedRuntimeReceipt = (
  config: Pick<Config, "data_dir">,
  distribution: string,
  backend: WslManagedBackend,
): WslManagedRuntimeReceipt | null => {
  const path = wslManagedRuntimeReceiptPath(config, distribution, backend);
  if (!existsSync(path)) return null;
  try {
    const receipt = Schema.decodeUnknownSync(WslManagedRuntimeReceiptSchema)(
      JSON.parse(readFileSync(path, "utf8")) as unknown,
    );
    return receipt.backend === backend && receipt.distribution === distribution ? receipt : null;
  } catch {
    return null;
  }
};

const writeReceipt = (
  config: Pick<Config, "data_dir">,
  receipt: WslManagedRuntimeReceipt,
): void => {
  const path = wslManagedRuntimeReceiptPath(config, receipt.distribution, receipt.backend);
  const temporary = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
};

const removeReceipt = (
  config: Pick<Config, "data_dir">,
  distribution: string,
  backend: WslManagedBackend,
): void => {
  rmSync(wslManagedRuntimeReceiptPath(config, distribution, backend), { force: true });
};

const normalizedHome = (home: string): string => {
  const normalized = posix.normalize(home.trim());
  if (!posix.isAbsolute(normalized) || normalized === "/") {
    throw new Error(`Unsafe WSL home directory: ${home}`);
  }
  return normalized;
};

export const wslManagedRuntimePaths = (
  home: string,
  backend: WslManagedBackend,
  nonce = "operation",
): WslManagedRuntimePaths => {
  const parent = posix.join(
    normalizedHome(home),
    ".local",
    "share",
    "local-studio",
    "runtime",
    "venvs",
  );
  const root = posix.join(parent, `${backend}-latest`);
  const pythonRoot = posix.join(root, "python");
  const venvRoot = posix.join(root, "venv");
  return {
    root,
    parent,
    pythonRoot,
    venvRoot,
    pythonPath: posix.join(venvRoot, "bin", "python"),
    packageBinaryPath: posix.join(venvRoot, "bin", backend),
    binaryPath: posix.join(root, "bin", backend),
    staging: posix.join(parent, `.${backend}-install-${nonce}`),
    backup: posix.join(parent, `.${backend}-backup-${nonce}`),
  };
};

export const wslManagedPackageSpec = (
  backend: WslManagedBackend,
  version?: string,
): string | null => {
  const normalized = version?.trim();
  if (!normalized) return backend;
  return /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(normalized) ? `${backend}==${normalized}` : null;
};

export const wslSglangTorchPackageSpecs = (
  versions: Schema.Schema.Type<typeof SglangTorchPackagesSchema>,
): string[] => [
  `torch==${versions.torch}`,
  `torchvision==${versions.torchvision}`,
  `torchaudio==${versions.torchaudio}`,
];

export const wslSglangKernelWheel = (
  kernel: Schema.Schema.Type<typeof SglangKernelSchema>,
): string | null => {
  if (!/^13(?:\.|$)/.test(kernel.cuda) || kernel.architecture !== "x86_64") return null;
  if (!/^[0-9][0-9A-Za-z._-]*$/.test(kernel.version)) return null;
  return `https://github.com/sgl-project/whl/releases/download/v${kernel.version}/sgl_kernel-${kernel.version}+cu130-cp310-abi3-manylinux2014_x86_64.whl`;
};

export const wslManagedInstallArguments = (
  installer: "uv" | "pip",
  installerPath: string,
  pythonPath: string,
  packageSpec: string,
): readonly [string, readonly string[]] =>
  installer === "uv"
    ? [
        installerPath,
        [
          "pip",
          "install",
          "--python",
          pythonPath,
          "--upgrade",
          packageSpec,
          "--torch-backend=auto",
        ],
      ]
    : [pythonPath, ["-m", "pip", "install", "--upgrade", packageSpec]];

const commandFailure = (
  message: string,
  result?: AsyncCommandResult,
  usedCommand?: string,
): RuntimeUpgradeResult => ({
  success: false,
  version: null,
  output: result?.stdout || null,
  error: result?.timedOut ? `${message} timed out` : result?.stderr || message,
  used_command: usedCommand ?? null,
});

const successResult = (
  version: string | null,
  output: string,
  usedCommand: string,
): RuntimeUpgradeResult => ({
  success: true,
  version,
  output: output || null,
  error: null,
  used_command: usedCommand,
});

const run = (
  runner: WslCommandRunner,
  distribution: string,
  args: readonly string[],
  timeoutMs: number,
  options: Pick<WslManagedRuntimeOptions, "onSpawn">,
  onOutput?: (chunk: string) => void,
): Effect.Effect<AsyncCommandResult> =>
  runner(distribution, args, {
    timeoutMs,
    ...(options.onSpawn ? { onSpawn: options.onSpawn } : {}),
    ...(onOutput ? { onOutput } : {}),
  });

const resolveCommand = (
  runner: WslCommandRunner,
  distribution: string,
  command: string,
  options: Pick<WslManagedRuntimeOptions, "onSpawn">,
): Effect.Effect<string | null> =>
  run(
    runner,
    distribution,
    ["/bin/sh", "-lc", 'command -v -- "$1"', "local-studio", command],
    COMMAND_TIMEOUT_MS,
    options,
  ).pipe(
    Effect.map((result) =>
      result.status === 0 && result.stdout.trim()
        ? (result.stdout.trim().split(/\r?\n/).at(-1) ?? null)
        : null,
    ),
  );

const resolveHome = (
  runner: WslCommandRunner,
  distribution: string,
  options: Pick<WslManagedRuntimeOptions, "onSpawn">,
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const uid = yield* run(
      runner,
      distribution,
      ["/usr/bin/id", "-u"],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (uid.status !== 0 || !/^\d+$/.test(uid.stdout.trim())) {
      return yield* Effect.fail(new Error(uid.stderr || "Could not resolve the WSL user id"));
    }
    const passwd = yield* run(
      runner,
      distribution,
      ["/usr/bin/getent", "passwd", uid.stdout.trim()],
      COMMAND_TIMEOUT_MS,
      options,
    );
    const home = passwd.stdout.trim().split(":")[5] ?? "";
    if (passwd.status !== 0 || !home) {
      return yield* Effect.fail(
        new Error(passwd.stderr || "Could not resolve the WSL home directory"),
      );
    }
    return normalizedHome(home);
  });

const cleanupPath = (
  runner: WslCommandRunner,
  distribution: string,
  path: string,
  options: Pick<WslManagedRuntimeOptions, "onSpawn">,
): Effect.Effect<void> =>
  run(runner, distribution, ["/bin/rm", "-rf", "--", path], COMMAND_TIMEOUT_MS, options).pipe(
    Effect.asVoid,
    Effect.catch(() => Effect.void),
  );

const activate = (
  runner: WslCommandRunner,
  distribution: string,
  paths: WslManagedRuntimePaths,
  options: Pick<WslManagedRuntimeOptions, "onSpawn">,
): Effect.Effect<RuntimeUpgradeResult | { hadBackup: boolean }> =>
  Effect.gen(function* () {
    const existing = yield* run(
      runner,
      distribution,
      ["/usr/bin/test", "-e", paths.root],
      COMMAND_TIMEOUT_MS,
      options,
    );
    const hadBackup = existing.status === 0;
    if (hadBackup) {
      const backup = yield* run(
        runner,
        distribution,
        ["/bin/mv", "--", paths.root, paths.backup],
        COMMAND_TIMEOUT_MS,
        options,
      );
      if (backup.status !== 0)
        return commandFailure("Could not stage the previous WSL runtime", backup);
    }
    const promote = yield* run(
      runner,
      distribution,
      ["/bin/mv", "--", paths.staging, paths.root],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (promote.status !== 0) {
      const backupExists = yield* run(
        runner,
        distribution,
        ["/usr/bin/test", "-e", paths.backup],
        COMMAND_TIMEOUT_MS,
        options,
      );
      if (backupExists.status === 0) {
        yield* run(
          runner,
          distribution,
          ["/bin/mv", "--", paths.backup, paths.root],
          COMMAND_TIMEOUT_MS,
          options,
        );
      }
      return commandFailure("Could not activate the WSL runtime", promote);
    }
    return { hadBackup };
  });

const rollbackActivation = (
  runner: WslCommandRunner,
  distribution: string,
  paths: WslManagedRuntimePaths,
  hadBackup: boolean,
  options: Pick<WslManagedRuntimeOptions, "onSpawn">,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* cleanupPath(runner, distribution, paths.root, options);
    if (hadBackup) {
      yield* run(
        runner,
        distribution,
        ["/bin/mv", "--", paths.backup, paths.root],
        COMMAND_TIMEOUT_MS,
        options,
      ).pipe(Effect.ignore);
    }
  });

const prepareWslCudaLayout = (
  runner: WslCommandRunner,
  stagingPython: string,
  stagingVenvRoot: string,
  usedCommand: string,
  options: Pick<WslManagedRuntimeOptions, "backend" | "distribution" | "onSpawn">,
): Effect.Effect<RuntimeUpgradeResult | { cudaRoot: string }> =>
  Effect.gen(function* () {
    const cudaRootResult = yield* run(
      runner,
      options.distribution,
      [stagingPython, "-c", CUDA_ROOT_SCRIPT],
      COMMAND_TIMEOUT_MS,
      options,
    );
    const cudaRootCandidate = cudaRootResult.status === 0 ? cudaRootResult.stdout.trim() : "";
    const cudaRoot = cudaRootCandidate.startsWith(`${stagingVenvRoot}/`) ? cudaRootCandidate : "";
    if (cudaRoot) {
      const cudaLibrary = posix.join(cudaRoot, "lib");
      const cudaRuntime = yield* run(
        runner,
        options.distribution,
        [
          "/usr/bin/find",
          cudaLibrary,
          "-maxdepth",
          "1",
          "-type",
          "f",
          "-name",
          "libcudart.so.*",
          "-print",
          "-quit",
        ],
        COMMAND_TIMEOUT_MS,
        options,
      );
      const cudaRuntimePath = cudaRuntime.stdout.trim();
      if (cudaRuntime.status !== 0 || !cudaRuntimePath.startsWith(`${cudaLibrary}/`)) {
        return commandFailure("Could not locate the managed CUDA runtime library", cudaRuntime);
      }
      const library64 = posix.join(cudaRoot, "lib64");
      const library64Exists = yield* run(
        runner,
        options.distribution,
        ["/usr/bin/test", "-e", library64],
        COMMAND_TIMEOUT_MS,
        options,
      );
      if (library64Exists.status !== 0) {
        const library64Link = yield* run(
          runner,
          options.distribution,
          ["/bin/ln", "-s", "lib", library64],
          COMMAND_TIMEOUT_MS,
          options,
        );
        if (library64Link.status !== 0) {
          return commandFailure("Could not prepare the managed CUDA library layout", library64Link);
        }
      }
      const cudaStubs = posix.join(cudaLibrary, "stubs");
      const cudaLayout = yield* Effect.all([
        run(
          runner,
          options.distribution,
          [
            "/bin/ln",
            "-sfn",
            posix.basename(cudaRuntimePath),
            posix.join(cudaLibrary, "libcudart.so"),
          ],
          COMMAND_TIMEOUT_MS,
          options,
        ),
        run(
          runner,
          options.distribution,
          ["/bin/mkdir", "-p", "--", cudaStubs],
          COMMAND_TIMEOUT_MS,
          options,
        ),
      ]);
      if (cudaLayout.some((result) => result.status !== 0)) {
        return commandFailure("Could not prepare the managed CUDA toolkit layout");
      }
      const driverLink = yield* run(
        runner,
        options.distribution,
        ["/bin/ln", "-sfn", "/usr/lib/wsl/lib/libcuda.so", posix.join(cudaStubs, "libcuda.so")],
        COMMAND_TIMEOUT_MS,
        options,
      );
      if (driverLink.status !== 0) {
        return commandFailure(
          "Could not expose the WSL CUDA driver to the managed runtime",
          driverLink,
        );
      }
    }
    if (options.backend === "sglang") {
      const kernelProbe = yield* run(
        runner,
        options.distribution,
        cudaRoot
          ? [
              "/usr/bin/env",
              `LD_LIBRARY_PATH=${posix.join(cudaRoot, "lib")}:/usr/lib/wsl/lib`,
              stagingPython,
              "-c",
              SGLANG_KERNEL_PROBE_SCRIPT,
            ]
          : [stagingPython, "-c", SGLANG_KERNEL_PROBE_SCRIPT],
        COMMAND_TIMEOUT_MS,
        options,
      );
      if (kernelProbe.status !== 0) {
        return commandFailure("SGLang CUDA kernel probe failed", kernelProbe, usedCommand);
      }
    }
    return { cudaRoot };
  });

export const installWslManagedRuntime = (
  options: WslManagedRuntimeOptions,
): Effect.Effect<RuntimeUpgradeResult> =>
  Effect.gen(function* () {
    if (process.platform !== "win32" && !options.runner) {
      return commandFailure("Managed WSL2 installation is available only on Windows");
    }
    const packageSpec = wslManagedPackageSpec(options.backend, options.version);
    if (!packageSpec) return commandFailure(`Invalid ${options.backend} version`);
    const runner = options.runner ?? runInWslWithOptions;
    const home = yield* resolveHome(runner, options.distribution, options).pipe(
      Effect.catch((error) => Effect.succeed(error)),
    );
    if (home instanceof Error) return commandFailure(home.message);
    const paths = wslManagedRuntimePaths(home, options.backend, randomUUID());
    const uv = yield* resolveCommand(runner, options.distribution, "uv", options);
    const python = yield* resolveCommand(runner, options.distribution, "python3", options);
    if (!uv && !python) {
      return commandFailure(`Python 3 or uv was not found in ${options.distribution}`);
    }
    options.onProgress?.({
      progress: 0.05,
      message: `Creating ${options.backend} in ${options.distribution}...`,
    });
    const parent = yield* run(
      runner,
      options.distribution,
      ["/bin/mkdir", "-p", "--", paths.parent],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (parent.status !== 0)
      return commandFailure("Could not create the WSL runtime directory", parent);
    const stagingPythonRoot = posix.join(paths.staging, "python");
    const stagingVenvRoot = posix.join(paths.staging, "venv");
    let basePython = python;
    if (uv) {
      const managedPython = yield* run(
        runner,
        options.distribution,
        [
          uv,
          "python",
          "install",
          "--no-bin",
          "--install-dir",
          stagingPythonRoot,
          MANAGED_PYTHON_VERSION,
        ],
        ENGINE_INSTALL_TIMEOUT_MS,
        options,
      );
      if (managedPython.status !== 0) {
        yield* cleanupPath(runner, options.distribution, paths.staging, options);
        return commandFailure("Could not install the managed WSL Python runtime", managedPython);
      }
      const findPython = yield* run(
        runner,
        options.distribution,
        [
          "/usr/bin/find",
          stagingPythonRoot,
          "-type",
          "f",
          "-path",
          `*/bin/python${MANAGED_PYTHON_VERSION}`,
          "-print",
          "-quit",
        ],
        COMMAND_TIMEOUT_MS,
        options,
      );
      basePython = findPython.status === 0 ? findPython.stdout.trim() : null;
      if (!basePython) {
        yield* cleanupPath(runner, options.distribution, paths.staging, options);
        return commandFailure("Could not locate the managed WSL Python runtime", findPython);
      }
    }
    if (!basePython) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return commandFailure("Could not resolve the WSL Python runtime");
    }
    const createCommand = uv ?? basePython;
    const createArguments = uv
      ? ["venv", "--python", basePython, "--relocatable", stagingVenvRoot]
      : ["-m", "venv", stagingVenvRoot];
    const create = yield* run(
      runner,
      options.distribution,
      [createCommand, ...createArguments],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (create.status !== 0) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return commandFailure("Could not create the managed WSL virtual environment", create);
    }
    const stagingPython = posix.join(stagingVenvRoot, "bin", "python");
    const stagingPackageBinary = posix.join(stagingVenvRoot, "bin", options.backend);
    const [installerCommand, installerArguments] = wslManagedInstallArguments(
      uv ? "uv" : "pip",
      uv ?? stagingPython,
      stagingPython,
      packageSpec,
    );
    const usedCommand = [installerCommand, ...installerArguments].join(" ");
    let output = "";
    let progress = 0.1;
    let lastUpdateAt = 0;
    options.onProgress?.({
      progress,
      message: `Installing ${packageSpec} in ${options.distribution}...`,
    });
    const install = yield* run(
      runner,
      options.distribution,
      [installerCommand, ...installerArguments],
      ENGINE_INSTALL_TIMEOUT_MS,
      options,
      (chunk) => {
        output = tailOutput(output + chunk);
        const now = Date.now();
        if (now - lastUpdateAt < JOB_OUTPUT_THROTTLE_MS) return;
        lastUpdateAt = now;
        progress = Math.min(0.85, progress + 0.01);
        options.onProgress?.({
          progress,
          message: `Installing ${packageSpec} in ${options.distribution}...`,
          outputTail: output,
        });
      },
    );
    if (install.status !== 0) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return commandFailure(`Install of ${packageSpec} failed`, install, usedCommand);
    }
    if (options.backend === "sglang" && uv) {
      const torchPackages = yield* run(
        runner,
        options.distribution,
        [stagingPython, "-c", SGLANG_TORCH_PACKAGES_SCRIPT],
        COMMAND_TIMEOUT_MS,
        options,
      );
      let packageVersions: Schema.Schema.Type<typeof SglangTorchPackagesSchema> | null = null;
      try {
        packageVersions =
          torchPackages.status === 0
            ? Schema.decodeUnknownSync(SglangTorchPackagesSchema)(
                JSON.parse(torchPackages.stdout) as unknown,
              )
            : null;
      } catch {
        packageVersions = null;
      }
      if (!packageVersions) {
        yield* cleanupPath(runner, options.distribution, paths.staging, options);
        return commandFailure("Could not resolve the SGLang Torch package set", torchPackages);
      }
      const torchInstall = yield* run(
        runner,
        options.distribution,
        [
          uv,
          "pip",
          "install",
          "--python",
          stagingPython,
          "--reinstall-package",
          "torch",
          "--reinstall-package",
          "torchvision",
          "--reinstall-package",
          "torchaudio",
          ...wslSglangTorchPackageSpecs(packageVersions),
          "--torch-backend=auto",
        ],
        ENGINE_INSTALL_TIMEOUT_MS,
        options,
      );
      output = tailOutput(output + torchInstall.stdout + torchInstall.stderr);
      if (torchInstall.status !== 0) {
        yield* cleanupPath(runner, options.distribution, paths.staging, options);
        return commandFailure("Could not install the SGLang CUDA Torch wheels", torchInstall);
      }
    }
    if (options.backend === "sglang") {
      const kernelMetadata = yield* run(
        runner,
        options.distribution,
        [stagingPython, "-c", SGLANG_KERNEL_SCRIPT],
        COMMAND_TIMEOUT_MS,
        options,
      );
      let kernel: Schema.Schema.Type<typeof SglangKernelSchema> | null = null;
      try {
        kernel =
          kernelMetadata.status === 0
            ? Schema.decodeUnknownSync(SglangKernelSchema)(
                JSON.parse(kernelMetadata.stdout) as unknown,
              )
            : null;
      } catch {
        kernel = null;
      }
      if (!kernel) {
        yield* cleanupPath(runner, options.distribution, paths.staging, options);
        return commandFailure("Could not resolve the SGLang kernel package", kernelMetadata);
      }
      const kernelWheel = wslSglangKernelWheel(kernel);
      if (kernel.cuda.startsWith("13") && !kernelWheel) {
        yield* cleanupPath(runner, options.distribution, paths.staging, options);
        return commandFailure(
          `No supported SGLang CUDA 13 kernel wheel is available for ${kernel.architecture}`,
        );
      }
      if (kernelWheel) {
        const kernelCommand = uv ?? stagingPython;
        const kernelArguments = uv
          ? [
              "pip",
              "install",
              "--python",
              stagingPython,
              "--reinstall-package",
              "sgl-kernel",
              "--no-deps",
              kernelWheel,
            ]
          : ["-m", "pip", "install", "--force-reinstall", "--no-deps", kernelWheel];
        const kernelInstall = yield* run(
          runner,
          options.distribution,
          [kernelCommand, ...kernelArguments],
          ENGINE_INSTALL_TIMEOUT_MS,
          options,
        );
        output = tailOutput(output + kernelInstall.stdout + kernelInstall.stderr);
        if (kernelInstall.status !== 0) {
          yield* cleanupPath(runner, options.distribution, paths.staging, options);
          return commandFailure("Could not install the SGLang CUDA kernel wheel", kernelInstall);
        }
      }
    }
    const cudaVersion = yield* run(
      runner,
      options.distribution,
      [stagingPython, "-c", CUDA_VERSION_SCRIPT],
      COMMAND_TIMEOUT_MS,
      options,
    );
    const cudaRelease = cudaVersion.stdout.trim();
    if (cudaVersion.status === 0 && /^\d+\.\d+$/.test(cudaRelease)) {
      const compilerSpecs = CUDA_COMPILER_PACKAGES.map(
        (packageName) => `${packageName}==${cudaRelease}.*`,
      );
      const compilerCommand = uv ?? stagingPython;
      const compilerArguments = uv
        ? ["pip", "install", "--python", stagingPython, ...compilerSpecs]
        : ["-m", "pip", "install", ...compilerSpecs];
      const compiler = yield* run(
        runner,
        options.distribution,
        [compilerCommand, ...compilerArguments],
        ENGINE_INSTALL_TIMEOUT_MS,
        options,
      );
      output = tailOutput(output + compiler.stdout + compiler.stderr);
      if (compiler.status !== 0) {
        yield* cleanupPath(runner, options.distribution, paths.staging, options);
        return commandFailure("Could not align the managed CUDA compiler packages", compiler);
      }
    }
    options.onProgress?.({ progress: 0.9, message: `Validating ${options.backend} and CUDA...` });
    const probe = yield* run(
      runner,
      options.distribution,
      [stagingPython, "-c", PROBE_SCRIPT, options.backend],
      COMMAND_TIMEOUT_MS,
      options,
    );
    let probeData: Schema.Schema.Type<typeof RuntimeProbeSchema> | null = null;
    try {
      probeData =
        probe.status === 0
          ? Schema.decodeUnknownSync(RuntimeProbeSchema)(JSON.parse(probe.stdout) as unknown)
          : null;
    } catch {
      probeData = null;
    }
    if (!probeData || !probeData.cuda || probeData.devices < 1) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return commandFailure(
        probeData
          ? `${options.backend} installed but CUDA is unavailable in ${options.distribution}`
          : `${options.backend} import/version probe failed in ${options.distribution}`,
        probe,
        usedCommand,
      );
    }
    const cli = yield* run(
      runner,
      options.distribution,
      [stagingPackageBinary, "--help"],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (cli.status !== 0) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return commandFailure(
        `${options.backend} CLI probe failed in ${options.distribution}`,
        cli,
        usedCommand,
      );
    }
    const cudaLayout = yield* prepareWslCudaLayout(
      runner,
      stagingPython,
      stagingVenvRoot,
      usedCommand,
      options,
    );
    if ("success" in cudaLayout) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return cudaLayout;
    }
    const { cudaRoot } = cudaLayout;
    const stagingWrapper = posix.join(paths.staging, "bin", options.backend);
    const wrapper = yield* run(
      runner,
      options.distribution,
      [
        stagingPython,
        "-c",
        WRAPPER_SCRIPT,
        stagingWrapper,
        stagingPackageBinary,
        cudaRoot,
        options.backend,
      ],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (wrapper.status !== 0) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return commandFailure(`Could not create the ${options.backend} WSL launcher`, wrapper);
    }
    const wrapperCli = yield* run(
      runner,
      options.distribution,
      [stagingWrapper, "--help"],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (wrapperCli.status !== 0) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return commandFailure(
        `${options.backend} WSL launcher probe failed`,
        wrapperCli,
        usedCommand,
      );
    }
    const activation = yield* activate(runner, options.distribution, paths, options);
    if ("success" in activation) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return activation;
    }
    const relocationPython = basePython?.startsWith(paths.staging)
      ? posix.join(paths.root, posix.relative(paths.staging, basePython))
      : basePython;
    if (!relocationPython) {
      yield* rollbackActivation(runner, options.distribution, paths, activation.hadBackup, options);
      return commandFailure(`Could not resolve the ${options.backend} relocation interpreter`);
    }
    const relocate = yield* run(
      runner,
      options.distribution,
      [relocationPython, "-c", RELOCATE_SCRIPT, paths.staging, paths.root],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (relocate.status !== 0) {
      yield* rollbackActivation(runner, options.distribution, paths, activation.hadBackup, options);
      return commandFailure(
        `${options.backend} relocation failed in ${options.distribution}`,
        relocate,
        usedCommand,
      );
    }
    const activatedCli = yield* run(
      runner,
      options.distribution,
      [paths.binaryPath, "--help"],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (activatedCli.status !== 0) {
      yield* rollbackActivation(runner, options.distribution, paths, activation.hadBackup, options);
      return commandFailure(
        `${options.backend} activated CLI probe failed in ${options.distribution}`,
        activatedCli,
        usedCommand,
      );
    }
    yield* cleanupPath(runner, options.distribution, paths.backup, options);
    yield* Effect.try({
      try: () =>
        writeReceipt(options.config, {
          schemaVersion: 1,
          backend: options.backend,
          distribution: options.distribution,
          root: paths.root,
          pythonPath: paths.pythonPath,
          binaryPath: paths.binaryPath,
          version: probeData.version,
          installedAt: new Date().toISOString(),
        }),
      catch: (error) => new Error(`Could not persist the managed WSL runtime: ${String(error)}`),
    });
    options.onProgress?.({
      progress: 1,
      message: `${options.backend} ${probeData.version} is ready in ${options.distribution}`,
    });
    return successResult(probeData.version, output || install.stdout, usedCommand);
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(commandFailure(error instanceof Error ? error.message : String(error))),
    ),
  );

export const uninstallWslManagedRuntime = (
  options: Omit<WslManagedRuntimeOptions, "version">,
): Effect.Effect<RuntimeUpgradeResult> =>
  Effect.gen(function* () {
    if (process.platform !== "win32" && !options.runner) {
      return commandFailure("Managed WSL2 removal is available only on Windows");
    }
    const receipt = readWslManagedRuntimeReceipt(
      options.config,
      options.distribution,
      options.backend,
    );
    if (!receipt) return successResult(null, "Managed WSL runtime is already absent", "no-op");
    const runner = options.runner ?? runInWslWithOptions;
    const home = yield* resolveHome(runner, options.distribution, options).pipe(
      Effect.catch((error) => Effect.succeed(error)),
    );
    if (home instanceof Error) return commandFailure(home.message);
    const paths = wslManagedRuntimePaths(home, options.backend);
    if (
      receipt.root !== paths.root ||
      receipt.pythonPath !== paths.pythonPath ||
      receipt.binaryPath !== paths.binaryPath
    ) {
      return commandFailure("Managed WSL runtime receipt does not match the safe runtime path");
    }
    options.onProgress?.({
      progress: 0.2,
      message: `Removing ${options.backend} from ${options.distribution}...`,
    });
    const remove = yield* run(
      runner,
      options.distribution,
      ["/bin/rm", "-rf", "--", paths.root],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (remove.status !== 0)
      return commandFailure("Could not remove the managed WSL runtime", remove);
    const verify = yield* run(
      runner,
      options.distribution,
      ["/usr/bin/test", "!", "-e", paths.root],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (verify.status !== 0)
      return commandFailure("Managed WSL runtime still exists after removal", verify);
    yield* Effect.try({
      try: () => removeReceipt(options.config, options.distribution, options.backend),
      catch: (error) => new Error(`Could not remove the managed WSL receipt: ${String(error)}`),
    });
    options.onProgress?.({
      progress: 1,
      message: `${options.backend} was removed from ${options.distribution}`,
    });
    return successResult(null, `Removed ${paths.root}`, `/bin/rm -rf -- ${paths.root}`);
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(commandFailure(error instanceof Error ? error.message : String(error))),
    ),
  );
