import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SECRET = "SYNTHETIC_CHILD_RUNTIME_SECRET";
const MODULE_URL = pathToFileURL(
  join(import.meta.dir, "..", "..", "src", "core", "console-redaction.ts"),
).href;
const BOOTSTRAP_URL = pathToFileURL(
  join(import.meta.dir, "..", "..", "src", "bootstrap.ts"),
).href;
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "local-studio-runtime-redaction-"));
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

const runChild = (mode: string): ReturnType<typeof Bun.spawnSync> => {
  const fixture = join(directory, `${mode}.ts`);
  writeFileSync(
    fixture,
    [
      `import { installConsoleRedaction } from ${JSON.stringify(MODULE_URL)};`,
      "installConsoleRedaction();",
      'const secret = process.env["SYNTHETIC_RUNTIME_SECRET"] ?? "";',
      'const mode = process.env["SYNTHETIC_RUNTIME_MODE"] ?? "";',
      'if (mode === "console") {',
      '  console.log("api_key:", secret);',
      '  console.error("OPENAI_API_KEY=%s", secret);',
      '} else if (mode === "split") {',
      '  process.stdout.write("{\\n  \\\"api_key\\\":\\n\\n");',
      '  process.stdout.write(`  "${secret}"\\n}\\n`);',
      '  console.error(`[\\n  "--api-key",\\n,\\n  "${secret}"\\n]`);',
      '  process.stdout.write("ordinary split diagnostic\\n");',
      '} else if (mode === "warning") {',
      "  process.emitWarning(`Authorization: Bearer ${secret}`);",
      "  await Bun.sleep(25);",
      '} else if (mode === "cross-stream") {',
      '  console.log("\\\"api_key\\\"");',
      '  console.log(":");',
      "  console.error(secret);",
      '} else if (mode === "cross-chunk-key") {',
      '  process.stdout.write("api_");',
      "  process.stderr.write(`key=${secret}\\n`);",
      '  process.stdout.write("ordinary stdout diagnostic\\n");',
      '  process.stderr.write("ordinary stderr diagnostic\\n");',
      '} else if (mode === "cross-chunk-separator") {',
      '  process.stdout.write("api_key");',
      '  process.stderr.write("=");',
      "  process.stdout.write(`${secret}\\n`);",
      '} else if (mode === "output-error") {',
      '  process.stdout.write("api_key=\\n");',
      "  console.error(secret);",
      '} else if (mode === "no-newline") {',
      '  process.stdout.write("api_");',
      "  process.stderr.write(`key=${secret}`);",
      '} else if (mode === "exception") {',
      "  queueMicrotask(() => { throw new Error(`api_key=${secret}`); });",
      "  await Bun.sleep(1_000);",
      '} else if (mode === "rejection") {',
      "  void Promise.reject(new Error(`OPENAI_API_KEY=${secret}`));",
      "  await Bun.sleep(1_000);",
      "}",
    ].join("\n"),
  );
  return Bun.spawnSync({
    cmd: [process.execPath, fixture],
    cwd: directory,
    env: {
      ...process.env,
      SYNTHETIC_RUNTIME_MODE: mode,
      SYNTHETIC_RUNTIME_SECRET: SECRET,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
};

const childOutput = (result: ReturnType<typeof Bun.spawnSync>): string =>
  `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}`;

const runBootstrapChild = (): ReturnType<typeof Bun.spawnSync> => {
  const preload = join(directory, "startup-warning-preload.ts");
  const fixture = join(directory, "startup-warning.ts");
  writeFileSync(
    preload,
    [
      "const originalSet = Reflect.set;",
      "let triggered = false;",
      "Reflect.set = (target, key, value, receiver = target) => {",
      "  const result = originalSet(target, key, value, receiver);",
      '  if (!triggered && target === process && key === "emitWarning") {',
      "    triggered = true;",
      '    process.emitWarning(`Authorization: Bearer ${process.env["SYNTHETIC_RUNTIME_SECRET"]}`);',
      "  }",
      "  return result;",
      "};",
    ].join("\n"),
  );
  writeFileSync(fixture, `import ${JSON.stringify(BOOTSTRAP_URL)}; await Bun.sleep(25);`);
  return Bun.spawnSync({
    cmd: [process.execPath, "--preload", preload, fixture],
    cwd: directory,
    env: { ...process.env, SYNTHETIC_RUNTIME_SECRET: SECRET },
    stdout: "pipe",
    stderr: "pipe",
  });
};

const expectSafeOutput = (result: ReturnType<typeof Bun.spawnSync>): string => {
  const output = childOutput(result);
  if (output.includes(SECRET)) {
    throw new Error(output.replaceAll(SECRET, "[unredacted synthetic value]"));
  }
  expect(output.includes("[redacted]")).toBe(true);
  return output;
};

test("formats each console call before atomically redacting its output", () => {
  const result = runChild("console");
  const output = expectSafeOutput(result);

  expect(result.exitCode).toBe(0);
  expect(output.includes("api_key: [redacted]")).toBe(true);
  expect(output.includes("OPENAI_API_KEY=[redacted]")).toBe(true);
});

test("retains split-value redaction state across console and stream writes", () => {
  const result = runChild("split");
  const output = expectSafeOutput(result);

  expect(result.exitCode).toBe(0);
  expect(output).toContain("ordinary split diagnostic");
});

test("shares ordered redaction state across console output streams", () => {
  const result = runChild("cross-stream");
  expectSafeOutput(result);
  expect(result.exitCode).toBe(0);
});

for (const mode of ["cross-chunk-key", "cross-chunk-separator", "output-error", "no-newline"]) {
  test(`redacts ${mode} through one ordered console stream`, () => {
    const result = runChild(mode);
    expectSafeOutput(result);
    expect(result.exitCode).toBe(0);
    if (mode === "cross-chunk-key") {
      expect(result.stdout?.toString()).toContain("ordinary stdout diagnostic");
      expect(result.stderr?.toString()).toContain("ordinary stderr diagnostic");
    }
    const redactedStream = mode === "cross-chunk-separator" ? result.stdout : result.stderr;
    expect(redactedStream?.toString()).toContain("[redacted]");
  });
}

test("sanitizes native warnings before Bun reports them", () => {
  const result = runChild("warning");
  expectSafeOutput(result);
  expect(result.exitCode).toBe(0);
});

test("queues startup warnings until console redaction is installed", () => {
  const result = runBootstrapChild();
  expectSafeOutput(result);
  expect(result.exitCode).toBe(0);
});

for (const mode of ["exception", "rejection"]) {
  test(`sanitizes a fatal ${mode} exactly once and exits unsuccessfully`, () => {
    const result = runChild(mode);
    const output = expectSafeOutput(result);

    expect(result.exitCode).not.toBe(0);
    expect(output.match(/Controller fatal error/g)?.length).toBe(1);
  });
}
