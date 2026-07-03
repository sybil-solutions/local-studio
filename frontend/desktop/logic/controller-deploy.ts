import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ControllerDeployResult {
  ok: boolean;
  url?: string;
  apiKey?: string;
  error?: string;
}

export interface ControllerDeployOptions {
  host: string;
  port?: number;
  installDir?: string;
}

const MARKER = "LOCAL_STUDIO_CONTROLLER ";
const INSTALL_SCRIPT_URL =
  "https://raw.githubusercontent.com/sybil-solutions/local-studio/main/scripts/install-controller.sh";
const DEPLOY_TIMEOUT_MS = 15 * 60_000;

// "user@host" / "host" / tailnet names; conservative charset keeps the value
// safe to place inside the ssh argv (never inside a shell string).
const HOST_PATTERN = /^[A-Za-z0-9._@-]+$/;

export const isValidDeployHost = (host: string): boolean =>
  HOST_PATTERN.test(host) && !host.startsWith("-");

/** Local checkout copy of the installer, when running from a dev tree. */
const findLocalInstallScript = (resourcesPath: string | null): string | null => {
  const candidates = [
    resourcesPath ? resolve(resourcesPath, "install-controller.sh") : null,
    resolve(__dirname, "..", "..", "..", "scripts", "install-controller.sh"),
    resolve(process.cwd(), "..", "scripts", "install-controller.sh"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

export const parseDeployMarker = (line: string): { url: string; apiKey: string } | null => {
  const index = line.indexOf(MARKER);
  if (index === -1) return null;
  try {
    const payload = JSON.parse(line.slice(index + MARKER.length)) as {
      url?: string;
      api_key?: string;
    };
    if (payload.url && payload.api_key) return { url: payload.url, apiKey: payload.api_key };
  } catch {
    return null;
  }
  return null;
};

/**
 * Deploy a controller to `host` over ssh. Streams progress lines via `onLog`;
 * resolves with the controller URL + API key parsed from the installer's
 * final marker line. Uses the local checkout's installer when present (dev),
 * otherwise fetches the published script on the remote side.
 */
export const deployController = (
  options: ControllerDeployOptions,
  resourcesPath: string | null,
  onLog: (line: string) => void,
): Promise<ControllerDeployResult> => {
  const host = options.host.trim();
  if (!isValidDeployHost(host)) {
    return Promise.resolve({ ok: false, error: "Invalid host (use host or user@host)" });
  }
  const port = options.port && Number.isFinite(options.port) ? options.port : 8080;
  const installDir = options.installDir?.trim() || "";
  if (installDir && !/^[A-Za-z0-9._/~-]+$/.test(installDir)) {
    return Promise.resolve({ ok: false, error: "Invalid install directory" });
  }

  const envPrefix = [
    `LOCAL_STUDIO_PORT=${port}`,
    ...(installDir ? [`LOCAL_STUDIO_DIR=${installDir}`] : []),
  ].join(" ");

  const localScript = findLocalInstallScript(resourcesPath);
  const remoteCommand = localScript
    ? `${envPrefix} bash -s`
    : `curl -fsSL ${INSTALL_SCRIPT_URL} | ${envPrefix} bash`;

  return new Promise((resolvePromise) => {
    const child = spawn(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, remoteCommand],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    if (localScript) {
      child.stdin.write(readFileSync(localScript, "utf8"));
    }
    child.stdin.end();

    let result: ControllerDeployResult | null = null;
    let stderrTail = "";
    let buffered = "";

    const handleChunk = (chunk: Buffer, isError: boolean) => {
      buffered += chunk.toString("utf8");
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trimEnd();
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
        if (!line) continue;
        const marker = parseDeployMarker(line);
        if (marker) {
          result = { ok: true, url: marker.url, apiKey: marker.apiKey };
          onLog("controller registered");
          continue;
        }
        if (isError) stderrTail = `${stderrTail}\n${line}`.slice(-2000);
        onLog(line);
      }
    };

    child.stdout.on("data", (chunk: Buffer) => handleChunk(chunk, false));
    child.stderr.on("data", (chunk: Buffer) => handleChunk(chunk, true));

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolvePromise({ ok: false, error: "Deploy timed out after 15 minutes" });
    }, DEPLOY_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolvePromise({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (result) return resolvePromise(result);
      resolvePromise({
        ok: false,
        error:
          code === 255
            ? `ssh could not reach "${host}" (check the hostname and that key auth works)${stderrTail ? `: ${stderrTail.trim().split("\n").pop()}` : ""}`
            : `Installer exited with code ${code}${stderrTail ? `: ${stderrTail.trim().split("\n").pop()}` : ""}`,
      });
    });
  });
};
