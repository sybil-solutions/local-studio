// CRITICAL
// @ts-nocheck
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

type SetupOptions = {
  workspace: string;
  modelsDir: string;
  controllerDir: string;
  dryRun: boolean;
  skipBuild: boolean;
  skipDownloads: boolean;
  skipStart: boolean;
  installPiper: boolean;
};

type CommandOptions = {
  cwd?: string;
  env?: Record<string, string>;
  optional?: boolean;
};

const usage = (): void => {
  console.log(`Usage: bun scripts/rockem/mi300x-setup.ts [options]

Options:
  --workspace <path>       Workspace for runtime repos (default: ~/rockem)
  --models-dir <path>      Models root path (default: /models)
  --controller-dir <path>  Controller directory (default: ./controller)
  --dry-run                Print commands without executing
  --skip-build             Skip HIP project builds
  --skip-downloads         Skip model downloads
  --skip-start             Skip controller/llama-server startup
  --install-piper          Install piper via apt when missing
  --help                   Show this help
`);
};

const parseOptions = (): SetupOptions => {
  const scriptPath = process.argv[1] ?? resolve(".");
  const root = resolve(scriptPath, "..", "..");
  const defaults: SetupOptions = {
    workspace: resolve(
      process.env["ROCKEM_WORKSPACE"] ?? resolve(homedir(), "rockem"),
    ),
    modelsDir: resolve(process.env["ROCKEM_MODELS_DIR"] ?? "/models"),
    controllerDir: resolve(
      process.env["ROCKEM_CONTROLLER_DIR"] ?? resolve(root, "controller"),
    ),
    dryRun: false,
    skipBuild: false,
    skipDownloads: false,
    skipStart: false,
    installPiper: false,
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--dry-run") {
      defaults.dryRun = true;
      continue;
    }
    if (arg === "--skip-build") {
      defaults.skipBuild = true;
      continue;
    }
    if (arg === "--skip-downloads") {
      defaults.skipDownloads = true;
      continue;
    }
    if (arg === "--skip-start") {
      defaults.skipStart = true;
      continue;
    }
    if (arg === "--install-piper") {
      defaults.installPiper = true;
      continue;
    }
    const next = args[index + 1];
    if (!next) {
      throw new Error(`Missing value for ${arg}`);
    }
    if (arg === "--workspace") {
      defaults.workspace = resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--models-dir") {
      defaults.modelsDir = resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--controller-dir") {
      defaults.controllerDir = resolve(next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return defaults;
};

const runCommand = (
  command: string,
  args: string[],
  options: SetupOptions,
  extra: CommandOptions = {},
): void => {
  const line = [command, ...args].join(" ");
  console.log(`\n$ ${line}`);
  if (options.dryRun) return;

  const result = spawnSync(command, args, {
    cwd: extra.cwd,
    env: { ...process.env, ...(extra.env ?? {}) },
    stdio: "inherit",
  });
  if (result.status === 0) return;
  if (extra.optional) {
    console.warn(
      `Optional command failed (${result.status ?? "unknown"}): ${line}`,
    );
    return;
  }
  throw new Error(`Command failed (${result.status ?? "unknown"}): ${line}`);
};

const commandExists = (name: string): boolean =>
  spawnSync("which", [name], { stdio: "ignore" }).status === 0;

const ensureRepo = (
  name: string,
  url: string,
  path: string,
  options: SetupOptions,
): void => {
  if (!existsSync(path)) {
    runCommand("git", ["clone", "--depth", "1", url, path], options);
    return;
  }
  runCommand("git", ["-C", path, "fetch", "--depth", "1", "origin"], options, {
    optional: true,
  });
  runCommand("git", ["-C", path, "pull", "--ff-only"], options, {
    optional: true,
  });
  console.log(`Using existing ${name} repo at ${path}`);
};

const buildCmakeProject = (
  path: string,
  configureFlags: string[],
  options: SetupOptions,
): void => {
  const buildDir = resolve(path, "build");
  runCommand("cmake", ["-S", ".", "-B", buildDir, ...configureFlags], options, {
    cwd: path,
  });
  runCommand("cmake", ["--build", buildDir, "-j"], options, { cwd: path });
};

const startBackgroundProcess = (
  name: string,
  commandLine: string,
  options: SetupOptions,
  cwd?: string,
): void => {
  console.log(`\nStarting ${name}: ${commandLine}`);
  if (options.dryRun) return;

  const result = spawnSync(
    "bash",
    ["-lc", `nohup ${commandLine} >/tmp/${name}.log 2>&1 & echo $!`],
    {
      cwd,
      env: process.env,
      encoding: "utf-8",
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Failed to start ${name}: ${result.stderr || result.stdout}`,
    );
  }
  console.log(`${name} pid=${result.stdout.trim()} log=/tmp/${name}.log`);
};

const downloadFile = (
  url: string,
  outputPath: string,
  options: SetupOptions,
): void => {
  if (existsSync(outputPath)) {
    console.log(`Already downloaded: ${outputPath}`);
    return;
  }
  runCommand(
    "curl",
    ["-fL", "--retry", "3", "--retry-delay", "1", "-o", outputPath, url],
    options,
  );
};

const ensureBaseCommands = (): void => {
  const required = ["git", "cmake", "curl", "bun", "python3"];
  for (const cmd of required) {
    if (!commandExists(cmd)) {
      throw new Error(`Missing required command: ${cmd}`);
    }
  }
};

const main = (): void => {
  const options = parseOptions();
  console.log("Rock M MI300X setup");
  console.log(JSON.stringify(options, null, 2));

  ensureBaseCommands();
  mkdirSync(options.workspace, { recursive: true });
  mkdirSync(options.modelsDir, { recursive: true });

  const whisperPath = resolve(options.workspace, "whisper.cpp");
  const llamaPath = resolve(options.workspace, "llama.cpp");
  const sdPath = resolve(options.workspace, "stable-diffusion.cpp");

  ensureRepo(
    "whisper.cpp",
    "https://github.com/ggerganov/whisper.cpp.git",
    whisperPath,
    options,
  );
  ensureRepo(
    "llama.cpp",
    "https://github.com/ggerganov/llama.cpp.git",
    llamaPath,
    options,
  );
  ensureRepo(
    "stable-diffusion.cpp",
    "https://github.com/leejet/stable-diffusion.cpp.git",
    sdPath,
    options,
  );

  if (!options.skipBuild) {
    buildCmakeProject(whisperPath, ["-DGGML_HIP=ON"], options);
    buildCmakeProject(llamaPath, ["-DGGML_HIP=ON"], options);
    buildCmakeProject(sdPath, ["-DSD_HIPBLAS=ON"], options);
  }

  if (options.installPiper && !commandExists("piper")) {
    runCommand("sudo", ["apt-get", "update"], options, { optional: true });
    runCommand("sudo", ["apt-get", "install", "-y", "piper"], options, {
      optional: true,
    });
  }

  mkdirSync(resolve(options.modelsDir, "stt"), { recursive: true });
  mkdirSync(resolve(options.modelsDir, "tts"), { recursive: true });
  mkdirSync(resolve(options.modelsDir, "llm"), { recursive: true });
  mkdirSync(resolve(options.modelsDir, "image"), { recursive: true });

  if (!options.skipDownloads) {
    downloadFile(
      process.env["ROCKEM_STT_MODEL_URL"] ??
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
      resolve(options.modelsDir, "stt", "ggml-base.en.bin"),
      options,
    );
    downloadFile(
      process.env["ROCKEM_TTS_MODEL_URL"] ??
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx",
      resolve(options.modelsDir, "tts", "en_US-lessac-medium.onnx"),
      options,
    );
    downloadFile(
      process.env["ROCKEM_TTS_MODEL_CONFIG_URL"] ??
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json",
      resolve(options.modelsDir, "tts", "en_US-lessac-medium.onnx.json"),
      options,
    );
  }

  if (!options.skipStart) {
    const controllerBun =
      process.env["ROCKEM_BUN_PATH"] ??
      resolve(homedir(), ".bun", "bin", "bun");
    const controllerCommand = [
      `VLLM_STUDIO_MODELS_DIR=${options.modelsDir}`,
      "VLLM_STUDIO_GPU_SMI_TOOL=amd-smi",
      `${controllerBun} run src/main.ts`,
    ].join(" ");
    startBackgroundProcess(
      "vllm-studio-controller",
      controllerCommand,
      options,
      options.controllerDir,
    );

    const llamaServer = resolve(llamaPath, "build", "bin", "llama-server");
    const llamaModel =
      process.env["ROCKEM_LLM_MODEL"] ??
      resolve(options.modelsDir, "llm", "model.gguf");
    if (existsSync(llamaServer) && existsSync(llamaModel)) {
      const llamaCommand = `${llamaServer} -m ${llamaModel} --host 0.0.0.0 --port 8000 --ctx-size 4096`;
      startBackgroundProcess("llama-server", llamaCommand, options);
    } else {
      console.warn(
        "Skipped llama-server start (missing binary or model). Set ROCKEM_LLM_MODEL after you download a GGUF model.",
      );
    }
  }

  console.log("\nSetup complete.");
  console.log("Next: bun scripts/rockem/mi300x-smoketest.ts");
};

main();
