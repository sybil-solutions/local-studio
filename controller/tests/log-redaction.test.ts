import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect } from "effect";
import * as logFiles from "../src/core/log-files";
import { writeBoundedLogOutput } from "../src/core/log-proxy";
import { redactLogLine } from "../src/core/log-redaction";
import { createLogger } from "../src/core/logger";
import { makeInstanceStore } from "../src/modules/compute/instances/store";

const temporaryDirectories: string[] = [];
const syntheticSecret = "synthetic-secret-never-persist";

const temporaryDirectory = (): string => {
  const directory = fs.mkdtempSync(join(tmpdir(), "log-redaction-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("log redaction", () => {
  test("redacts supported credential forms idempotently", () => {
    const input = [
      `Authorization: Bearer ${syntheticSecret}`,
      `Authorization: Bearer "${syntheticSecret}"`,
      `{"authorization":"Bearer ${syntheticSecret}"}`,
      `Authorization: Basic ${syntheticSecret}`,
      `Authorization=Token ${syntheticSecret}`,
      `Authorization: Digest username="user", response="${syntheticSecret}"`,
      `authorization=Custom ${syntheticSecret}`,
      JSON.stringify({ raw: JSON.stringify({ Authorization: `Basic ${syntheticSecret}` }) }),
      JSON.stringify({ raw: JSON.stringify({ Authorization: `Token ${syntheticSecret}` }) }),
      JSON.stringify({ raw: JSON.stringify({ Authorization: `Custom ${syntheticSecret}` }) }),
      JSON.stringify({
        raw: JSON.stringify({
          Authorization: `Digest username="user", response="${syntheticSecret}"`,
        }),
      }),
      `X-Api-Key: ${syntheticSecret}`,
      `X-Api-Key: "prefix\\\"${syntheticSecret}"`,
      `OPENAI_API_KEY=${syntheticSecret}`,
      `{"api_key":"${syntheticSecret}"}`,
      `command --api-key=${syntheticSecret}`,
      `--api-key=${syntheticSecret}`,
      `--token ${syntheticSecret}`,
      `--api-key "${syntheticSecret}"`,
      `--token='${syntheticSecret}'`,
      `api_key: ${syntheticSecret}`,
      `password: "prefix\\\"${syntheticSecret}"`,
      `--password "prefix\\\"${syntheticSecret}"`,
      `--password "${syntheticSecret}`,
      `PASSWORD_TOKEN="prefix\\\"${syntheticSecret}"`,
      `PASSWORD_TOKEN="${syntheticSecret}\\`,
      `api_key: '${syntheticSecret}\\`,
      `--token "${syntheticSecret}\\`,
      `(OPENAI_API_KEY=${syntheticSecret})`,
      `[OPENAI_API_KEY=${syntheticSecret}]`,
      `env(OPENAI_API_KEY=${syntheticSecret})`,
      `["--api-key","${syntheticSecret}"]`,
      `argv=['--token','${syntheticSecret}']`,
      `--api-key,${syntheticSecret}`,
      `https://host.test/path?token=${syntheticSecret}`,
    ].join("\n");
    const once = redactLogLine(input);
    expect(once).not.toContain(syntheticSecret);
    expect(once).toContain("[redacted]");
    expect(redactLogLine(once)).toBe(once);
  });

  test("removes complete Authorization credentials from every logger sink", async () => {
    const root = temporaryDirectory();
    const filePath = logFiles.primaryLogPathFor(join(root, "data"), "authorization");
    const events: string[] = [];
    const consoleLines: string[] = [];
    const nestedSecrets = ["nested-basic", "nested-digest", "nested-token", "nested-custom"];
    const structuredSecrets = Object.fromEntries(
      [
        "api_key",
        "api-key",
        "apikey",
        "x-api-key",
        "auth_token",
        "access_token",
        "token",
        "secret",
        "password",
        "hf_token",
        "openai_api_key",
        "anthropic_api_key",
      ].map((key, index) => [key, `nested-structured-${index}`]),
    );
    const original = console.info;
    console.info = (...values: unknown[]) => consoleLines.push(values.join(" "));
    try {
      const logger = createLogger("info", {
        filePath,
        onLine: (line) => events.push(line),
      });
      logger.info(
        `Authorization: Basic ${syntheticSecret}\nAuthorization=Digest response="${syntheticSecret}"\nAuthorization: Token ${syntheticSecret}\nAuthorization=Custom ${syntheticSecret}`,
        {
          values: [
            JSON.stringify({ Authorization: `Basic ${nestedSecrets[0]}` }),
            JSON.stringify({
              Authorization: `Digest username="user", response="${nestedSecrets[1]}"`,
            }),
            JSON.stringify({ Authorization: `Token ${nestedSecrets[2]}` }),
            JSON.stringify({ Authorization: `Custom ${nestedSecrets[3]}` }),
            JSON.stringify(structuredSecrets),
          ],
        },
      );
      await Effect.runPromise(logger.shutdown());
    } finally {
      console.info = original;
    }
    const persisted = fs.readFileSync(filePath, "utf8").trimEnd();
    expect(persisted).not.toContain(syntheticSecret);
    for (const secret of nestedSecrets) expect(persisted).not.toContain(secret);
    for (const secret of Object.values(structuredSecrets)) expect(persisted).not.toContain(secret);
    expect(persisted.match(/\[redacted\]/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(events).toEqual([persisted]);
    expect(consoleLines).toEqual([persisted]);
  });

  test("uses the same redacted line for console, file, and event sinks", async () => {
    const root = temporaryDirectory();
    const filePath = logFiles.primaryLogPathFor(join(root, "data"), "controller");
    const events: string[] = [];
    const consoleLines: string[] = [];
    const original = console.info;
    console.info = (...values: unknown[]) => consoleLines.push(values.join(" "));
    try {
      const logger = createLogger("info", {
        filePath,
        onLine: (line) => events.push(line),
      });
      logger.info(`OPENAI_API_KEY=${syntheticSecret}`, {
        authorization: `Bearer ${syntheticSecret}`,
      });
      await Effect.runPromise(logger.shutdown());
    } finally {
      console.info = original;
    }
    const persisted = fs.readFileSync(filePath, "utf8").trimEnd();
    expect(persisted).not.toContain(syntheticSecret);
    expect(events).toEqual([persisted]);
    expect(consoleLines).toEqual([persisted]);
  });

  test("redacts dependency console output before a service can persist it", () => {
    const root = temporaryDirectory();
    const dependency = join(root, "dependency.mjs");
    const harness = join(root, "harness.ts");
    const secrets = ["dependency-basic", "dependency-token", "dependency-structured"];
    fs.writeFileSync(
      dependency,
      [
        `console.log("Authorization: Basic ${secrets[0]}")`,
        `console.error("Authorization=Token ${secrets[1]}")`,
        `console.warn({ raw: JSON.stringify({ api_key: "${secrets[2]}" }) })`,
      ].join("\n"),
    );
    fs.writeFileSync(
      harness,
      [
        `import ${JSON.stringify(new URL("../src/core/process-boundary.ts", import.meta.url).href)}`,
        `await import(${JSON.stringify(pathToFileURL(dependency).href)})`,
      ].join("\n"),
    );
    const result = spawnSync(process.execPath, [harness], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    for (const secret of secrets) expect(output).not.toContain(secret);
    expect(output.match(/\[redacted\]/g)).toHaveLength(3);
  });

  test("bounds persisted redacted diagnostics", () => {
    const root = temporaryDirectory();
    const filePath = logFiles.primaryLogPathFor(join(root, "data"), "bounded");
    const descriptor = logFiles.openPrivateLogFile(filePath, true);
    try {
      writeBoundedLogOutput(descriptor, "first-output\n", 16);
      writeBoundedLogOutput(descriptor, "second-output\n", 16);
      expect(fs.readFileSync(filePath, "utf8")).toBe("second-output\n");
      writeBoundedLogOutput(descriptor, "0123456789abcdefghijkl", 16);
    } finally {
      fs.closeSync(descriptor);
    }
    expect(fs.statSync(filePath).size).toBeLessThanOrEqual(16);
    expect(fs.readFileSync(filePath, "utf8")).toBe("6789abcdefghijkl");
  });

  test("repairs private directory and file modes", async () => {
    if (process.platform === "win32") return;
    const root = temporaryDirectory();
    const dataDirectory = join(root, "data");
    const filePath = logFiles.primaryLogPathFor(dataDirectory, "controller");
    fs.writeFileSync(filePath, "existing\n", { mode: 0o644 });
    fs.chmodSync(dataDirectory, 0o755);
    fs.chmodSync(logFiles.ensureLogsDirectory(dataDirectory), 0o755);
    fs.chmodSync(filePath, 0o644);
    const logger = createLogger("info", { filePath });
    logger.info("safe");
    await Effect.runPromise(logger.shutdown());
    expect(fs.lstatSync(dataDirectory).mode & 0o777).toBe(0o700);
    expect(fs.lstatSync(join(dataDirectory, "logs")).mode & 0o777).toBe(0o700);
    expect(fs.lstatSync(filePath).mode & 0o777).toBe(0o600);
  });

  test("repairs existing primary and fallback logs before reads", () => {
    if (process.platform === "win32") return;
    const root = temporaryDirectory();
    const dataDirectory = join(root, "data");
    const primary = logFiles.primaryLogPathFor(dataDirectory, "existing");
    const sessionId = `fallback-${process.pid}-${Date.now()}`;
    const fallback = logFiles.fallbackLogPathFor(sessionId);
    fs.writeFileSync(primary, "primary", { mode: 0o644 });
    fs.chmodSync(primary, 0o644);
    fs.writeFileSync(fallback, "fallback", { mode: 0o644 });
    fs.chmodSync(fallback, 0o644);
    try {
      logFiles.ensureLogsDirectory(dataDirectory);
      expect(fs.lstatSync(primary).mode & 0o777).toBe(0o600);
      expect(fs.lstatSync(fallback).mode & 0o777).toBe(0o600);
      expect(logFiles.resolveExistingLogPath(dataDirectory, sessionId)).toBe(fallback);
    } finally {
      fs.rmSync(fallback, { force: true });
    }
  });

  test("repairs inactive instance logs when the store starts", () => {
    if (process.platform === "win32") return;
    const root = temporaryDirectory();
    const dataDirectory = join(root, "data");
    const instancesDirectory = join(dataDirectory, "instances");
    const logsDirectory = join(instancesDirectory, "logs");
    const logPath = join(logsDirectory, "inactive.log");
    fs.mkdirSync(logsDirectory, { recursive: true, mode: 0o755 });
    fs.writeFileSync(logPath, "existing", { mode: 0o644 });
    fs.chmodSync(instancesDirectory, 0o755);
    fs.chmodSync(logsDirectory, 0o755);
    fs.chmodSync(logPath, 0o644);
    makeInstanceStore(dataDirectory);
    expect(fs.lstatSync(instancesDirectory).mode & 0o777).toBe(0o700);
    expect(fs.lstatSync(logsDirectory).mode & 0o777).toBe(0o700);
    expect(fs.lstatSync(logPath).mode & 0o777).toBe(0o600);
  });

  test("rejects hard-linked log targets before truncation", () => {
    const root = temporaryDirectory();
    const target = join(root, "target.log");
    const filePath = logFiles.primaryLogPathFor(join(root, "data"), "controller");
    fs.writeFileSync(target, "unchanged");
    fs.linkSync(target, filePath);
    expect(() => logFiles.openPrivateLogFile(filePath, true)).toThrow("Unsafe log file");
    expect(fs.readFileSync(target, "utf8")).toBe("unchanged");
  });

  test("rejects a replaced log directory before opening its files", () => {
    if (process.platform === "win32") return;
    const root = temporaryDirectory();
    const dataDirectory = join(root, "data");
    const directory = logFiles.ensureLogsDirectory(dataDirectory);
    const moved = `${directory}-moved`;
    const target = join(moved, "vllm_controller.log");
    fs.renameSync(directory, moved);
    fs.writeFileSync(target, "unchanged");
    fs.symlinkSync(moved, directory);
    expect(() => logFiles.openPrivateLogFile(join(directory, "vllm_controller.log"), true)).toThrow(
      "Unsafe log directory",
    );
    expect(fs.readFileSync(target, "utf8")).toBe("unchanged");
  });

  test("does not follow a log-file symlink", async () => {
    if (process.platform === "win32") return;
    const root = temporaryDirectory();
    const target = join(root, "target.log");
    const dataDirectory = join(root, "data");
    const filePath = logFiles.primaryLogPathFor(dataDirectory, "controller");
    fs.writeFileSync(target, "unchanged");
    fs.symlinkSync(target, filePath);
    const original = console.info;
    console.info = () => {};
    try {
      const logger = createLogger("info", { filePath });
      logger.info(`OPENAI_API_KEY=${syntheticSecret}`);
      await Effect.runPromise(logger.shutdown());
    } finally {
      console.info = original;
    }
    expect(fs.readFileSync(target, "utf8")).toBe("unchanged");
  });

  test("rejects or refuses to tail a log-file symlink", () => {
    if (process.platform === "win32") return;
    const root = temporaryDirectory();
    const target = join(root, "private.txt");
    const dataDirectory = join(root, "data");
    const sessionId = `symlink-${process.pid}-${Date.now()}`;
    const filePath = logFiles.primaryLogPathFor(dataDirectory, sessionId);
    fs.writeFileSync(target, syntheticSecret);
    fs.symlinkSync(target, filePath);
    expect(() => logFiles.resolveExistingLogPath(dataDirectory, sessionId)).toThrow(
      "Unsafe log file",
    );
    expect(logFiles.tailFileLines(filePath, 10)).toEqual([]);
  });

  test("installer establishes private modes before creating credentials", () => {
    const installer = fs.readFileSync(
      fileURLToPath(new URL("../../scripts/install-controller.sh", import.meta.url)),
      "utf8",
    );
    const umaskAt = installer.indexOf("umask 077");
    const earlyEnvModeAt = installer.indexOf('harden_private_file "$ENV_FILE"');
    const earlyLogModeAt = installer.indexOf('harden_private_file "$DATA_DIR/controller.log"');
    const sourceUpdateAt = installer.indexOf('git -C "$DIR" pull');
    const dependencyInstallAt = installer.indexOf('"$BUN" install');
    const credentialAt = installer.indexOf("openssl rand -hex 32");
    const launchdUmaskAt = installer.indexOf("<key>Umask</key><integer>63</integer>");
    const launchdOutputAt = installer.indexOf("<key>StandardOutPath</key>");
    expect(umaskAt).toBeGreaterThan(0);
    expect(earlyEnvModeAt).toBeGreaterThan(umaskAt);
    expect(earlyLogModeAt).toBeGreaterThan(earlyEnvModeAt);
    expect(sourceUpdateAt).toBeGreaterThan(earlyLogModeAt);
    expect(dependencyInstallAt).toBeGreaterThan(sourceUpdateAt);
    expect(credentialAt).toBeGreaterThan(umaskAt);
    expect(launchdUmaskAt).toBeGreaterThan(credentialAt);
    expect(launchdOutputAt).toBeGreaterThan(launchdUmaskAt);
    expect(installer).toContain('chmod 600 "$ENV_FILE"');
    expect(installer).toContain('chmod 600 "$DATA_DIR/controller.log"');
    expect(installer).toContain("UMask=0077");
    expect(installer).toContain("<key>StandardOutPath</key><string>/dev/null</string>");
    expect(installer).toContain("<key>StandardErrorPath</key><string>/dev/null</string>");
    expect(installer).toContain("StandardOutput=null");
    expect(installer).toContain("StandardError=null");
    expect(installer).not.toContain("StandardOutput=append:");
    expect(installer).not.toContain("StandardError=append:");
  });

  test("installer rejects old Bun and accepts the declared minimum or newer", () => {
    const installerPath = fileURLToPath(
      new URL("../../scripts/install-controller.sh", import.meta.url),
    );
    const controllerPackage = JSON.parse(
      fs.readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { engines?: { bun?: string } };
    const minimum = controllerPackage.engines?.bun?.replace(/^>=/, "");
    if (!minimum) throw new Error("Missing controller Bun engine requirement");
    const [major = 0, minor = 0, patch = 0] = minimum.split(".").map(Number);
    const old = [major, minor, Math.max(0, patch - 1)].join(".");
    const newer = [major, minor, patch + 1].join(".");
    const check = (version: string): number | null =>
      spawnSync("bash", [installerPath, "--check-bun-version", version, minimum]).status;
    expect(check(old)).not.toBe(0);
    expect(check(minimum)).toBe(0);
    expect(check(newer)).toBe(0);
    for (const malformed of ["1.3", "1..14", "1.3.x", "1.3.14.0", "1_3_14", `${minimum}-canary`]) {
      expect(check(malformed)).not.toBe(0);
    }
  });

  test("installer upgrades an old Bun or refuses an unsupported replacement", () => {
    const installerPath = fileURLToPath(
      new URL("../../scripts/install-controller.sh", import.meta.url),
    );
    const controllerPackage = JSON.parse(
      fs.readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { engines?: { bun?: string } };
    const minimum = controllerPackage.engines?.bun?.replace(/^>=/, "");
    if (!minimum) throw new Error("Missing controller Bun engine requirement");
    const [major = 0, minor = 0, patch = 0] = minimum.split(".").map(Number);
    const old = [major, minor, Math.max(0, patch - 1)].join(".");
    const runEnsure = (installed: string): ReturnType<typeof spawnSync> => {
      const root = temporaryDirectory();
      const home = join(root, "home");
      const bin = join(root, "bin");
      fs.mkdirSync(home, { recursive: true });
      fs.mkdirSync(bin, { recursive: true });
      const initialBun = join(root, "initial-bun");
      const installedBun = join(root, "installed-bun");
      const fakeCurl = join(bin, "curl");
      fs.writeFileSync(initialBun, `#!/usr/bin/env bash\nprintf '%s\\n' ${old}\n`);
      fs.writeFileSync(installedBun, `#!/usr/bin/env bash\nprintf '%s\\n' ${installed}\n`);
      fs.writeFileSync(
        fakeCurl,
        [
          "#!/usr/bin/env bash",
          'mkdir -p "$HOME/.bun/bin"',
          'cp "$FAKE_INSTALLED_BUN" "$HOME/.bun/bin/bun"',
          'chmod 700 "$HOME/.bun/bin/bun"',
          "printf ':\\n'",
        ].join("\n"),
      );
      fs.chmodSync(initialBun, 0o700);
      fs.chmodSync(installedBun, 0o700);
      fs.chmodSync(fakeCurl, 0o700);
      return spawnSync("bash", [installerPath, "--ensure-bun-version", minimum], {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          PATH: `${bin}:/usr/bin:/bin`,
          LOCAL_STUDIO_BUN_BINARY: initialBun,
          FAKE_INSTALLED_BUN: installedBun,
        },
      });
    };
    const upgraded = runEnsure(minimum);
    expect(upgraded.status).toBe(0);
    expect(upgraded.stdout).toContain(`bun: ${minimum}`);
    const refused = runEnsure(old);
    expect(refused.status).not.toBe(0);
    expect(refused.stdout).toContain(`older than required ${minimum} after upgrade`);
  });
});
