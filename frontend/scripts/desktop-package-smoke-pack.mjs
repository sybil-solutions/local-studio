import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveSmokeArchitecture,
  selectedEnvironment,
  smokeControllerUrl,
} from "./desktop-package-smoke.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const frontendDirectory = resolve(import.meta.dirname, "..");
const buildEnvironmentNames = [
  "CI",
  "GITHUB_ACTIONS",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCAL_STUDIO_DESKTOP_SMOKE_ARCH",
  "LOGNAME",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
];
const buildControllerUrls = [
  "BACKEND_URL",
  "LOCAL_STUDIO_BACKEND_URL",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_BACKEND_URL",
];
const buildControllerKeys = ["API_KEY", "INFERENCE_API_KEY", "LOCAL_STUDIO_API_KEY"];

export function electronBuilderArguments(architecture) {
  return [
    "--dir",
    "--config",
    "desktop/electron-builder.yml",
    "-c.mac.identity=null",
    "-c.mac.hardenedRuntime=false",
    `--${architecture}`,
  ];
}

export function smokeBuildEnvironment(source = process.env) {
  const environment = {
    ...selectedEnvironment(source, buildEnvironmentNames),
    NEXT_TELEMETRY_DISABLED: "1",
  };
  for (const name of buildControllerUrls) environment[name] = smokeControllerUrl;
  for (const name of buildControllerKeys) environment[name] = "";
  return environment;
}

async function runCommand(executable, arguments_, environment, label) {
  const child = spawn(executable, arguments_, {
    cwd: frontendDirectory,
    env: environment,
    stdio: "inherit",
  });
  const result = await new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveResult({ code, signal }));
  });
  if (result.code !== 0) {
    throw new Error(
      `${label} failed with ${result.code === null ? `signal ${result.signal}` : `code ${result.code}`}`,
    );
  }
}

async function runBuilder() {
  const architecture = resolveSmokeArchitecture();
  const environment = smokeBuildEnvironment();
  await runCommand(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "desktop:build"],
    environment,
    "desktop build",
  );
  const executable = join(
    frontendDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
  );
  await runCommand(
    executable,
    electronBuilderArguments(architecture),
    environment,
    "electron-builder",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await runBuilder();
}
