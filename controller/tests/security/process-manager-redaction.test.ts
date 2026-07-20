import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { Effect } from "effect";
import type { Config } from "../../src/config/env";
import type { ProcessRunner, SpawnedProcess } from "../../src/core/command";
import type { Logger } from "../../src/core/logger";
import { asRecipeId, type Recipe } from "../../src/modules/models/types";
import { makeProcessManager } from "../../src/modules/engines/process/process-manager";
import { EventManager } from "../../src/modules/system/event-manager";

const STRUCTURED_SECRET = "SYNTHETIC_ENGINE_STRUCTURED_SECRET";
const ARGV_SECRET = "SYNTHETIC_ENGINE_ARGV_SECRET";
const PRIVATE_KEY_SECRET = "SYNTHETIC_ENGINE_PRIVATE_KEY_SECRET";
const PAT_SECRET = "SYNTHETIC_ENGINE_PAT_SECRET";
const DATABASE_URL_SECRET = "SYNTHETIC_ENGINE_DATABASE_URL_SECRET";
const DOTTED_ENV_SECRET = "SYNTHETIC_ENGINE_DOTTED_ENV_SECRET";
const DOUBLE_SEPARATOR_SECRET = "SYNTHETIC_ENGINE_DOUBLE_SEPARATOR_SECRET";
const QUERY_SECRET = "SYNTHETIC_PROBE_SECRET";
const QUERY_PREFIX = "https://service.invalid/path?process%2Eenv%2EACCESS_TOKEN=";
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "local-studio-process-redaction-"));
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

const configFor = (binary: string): Config => ({
  host: "127.0.0.1",
  port: 8080,
  inference_host: "127.0.0.1",
  inference_port: 18000,
  data_dir: join(directory, "data"),
  db_path: join(directory, "data", "controller.db"),
  models_dir: join(directory, "models"),
  llama_bin: binary,
  strict_openai_models: false,
  providers: [],
});

const recipe = (): Recipe => ({
  id: asRecipeId("split-engine-output"),
  name: "Split engine output",
  model_path: join(directory, "model.gguf"),
  vision: null,
  backend: "llamacpp",
  runtime: { kind: "binary", ref: "synthetic" },
  env_vars: null,
  tensor_parallel_size: 1,
  pipeline_parallel_size: 1,
  max_model_len: 4096,
  gpu_memory_utilization: 0.9,
  kv_cache_dtype: "auto",
  max_num_seqs: 1,
  trust_remote_code: false,
  tool_call_parser: null,
  reasoning_parser: null,
  enable_auto_tool_choice: false,
  quantization: null,
  dtype: null,
  host: "127.0.0.1",
  port: 18000,
  served_model_name: null,
  python_path: null,
  extra_args: {},
  max_thinking_tokens: null,
  thinking_mode: "off",
});

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  shutdown: () => Effect.void,
};

class CapturingEventManager extends EventManager {
  public readonly lines: string[] = [];

  public override publishLogLine(_sessionId: string, line: string): Effect.Effect<void> {
    return Effect.sync(() => this.lines.push(line)).pipe(Effect.asVoid);
  }
}

const failedChild = (): SpawnedProcess => ({
  pid: 42000,
  exitCode: 1,
  stdout: Readable.from([
    "{\n",
    '  "api_key":\n',
    "\n",
    `  "${STRUCTURED_SECRET}"\n`,
    "}\n",
    "[\n",
    '  "--api-key",\n',
    ",\n",
    `  "${ARGV_SECRET}"\n`,
    "]\n",
    `SSH_PRIVATE_KEY=${PRIVATE_KEY_SECRET}\n`,
    `GITHUB_PAT=${PAT_SECRET}\n`,
    `DATABASE_URL=${DATABASE_URL_SECRET}\n`,
    `process.env.ACCESS_TOKEN=${DOTTED_ENV_SECRET}\n`,
    `OPENAI__API__KEY=${DOUBLE_SEPARATOR_SECRET}\n`,
  ]),
  stderr: null,
  on: () => undefined,
  unref: () => undefined,
});

const crossStreamFailedChild = (): SpawnedProcess => ({
  pid: 42001,
  exitCode: 1,
  stdout: Readable.from(['"api_key"\n', ":\n"]),
  stderr: Readable.from([`${STRUCTURED_SECRET}\n`]),
  on: () => undefined,
  unref: () => undefined,
});

const queryContinuationFailedChild = (): SpawnedProcess => ({
  pid: 42004,
  exitCode: 1,
  stdout: Readable.from([`${QUERY_PREFIX}\n`, `${QUERY_SECRET}\n`]),
  stderr: null,
  on: () => undefined,
  unref: () => undefined,
});

type Interleaving = "key" | "separator" | "error" | "no-newline";
const INTERLEAVINGS: readonly Interleaving[] = ["key", "separator", "error", "no-newline"];

const interleavedFailedChild = (interleaving: Interleaving): SpawnedProcess => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const events = new EventEmitter();
  queueMicrotask(() => {
    if (interleaving === "error") {
      stdout.write("api_key=\n");
      events.emit("error", new Error(STRUCTURED_SECRET));
    } else if (interleaving === "separator") {
      stdout.write("api_key");
      stderr.write("=");
      stdout.write(`${STRUCTURED_SECRET}\n`);
    } else if (interleaving === "key") {
      stdout.write("api_");
      stderr.write(`key=${STRUCTURED_SECRET}\n`);
    } else {
      stdout.write("api_");
      stderr.write(`key=${STRUCTURED_SECRET}`);
    }
    stdout.end();
    stderr.end();
  });
  return {
    pid: 42002,
    exitCode: 1,
    stdout,
    stderr,
    on: (event, listener): void => {
      events.on(event, listener);
    },
    unref: () => undefined,
  };
};

const runtimeErrorChild = (): SpawnedProcess => {
  return {
    pid: 42003,
    get exitCode(): null {
      throw new Error(STRUCTURED_SECRET);
    },
    stdout: Readable.from(["api_key=\n"]),
    stderr: null,
    on: () => undefined,
    unref: () => undefined,
  };
};

const runner: ProcessRunner = {
  runSync: () => ({ status: 0, stdout: "", stderr: "" }),
  spawnDetached: () => failedChild(),
};

const launch = async (binary: string, processRunner: ProcessRunner, events?: EventManager) => {
  const manager = await Effect.runPromise(
    makeProcessManager(configFor(binary), logger, events, processRunner),
  );
  return Effect.runPromise(manager.launchModel(recipe()));
};

test("redacts split engine output in persisted and failure tails", async () => {
  const binary = join(directory, "llama-server");
  writeFileSync(binary, "");
  chmodSync(binary, 0o755);
  const events = new CapturingEventManager();
  const result = await launch(binary, runner, events);
  let persisted = "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    persisted = readFileSync(result.log_file ?? "", "utf8");
    if (persisted.includes("[redacted]")) break;
    await Bun.sleep(5);
  }

  expect(result.success).toBe(false);
  expect(result.message).not.toContain(STRUCTURED_SECRET);
  expect(result.message).not.toContain(ARGV_SECRET);
  expect(result.message).not.toContain(PRIVATE_KEY_SECRET);
  expect(result.message).not.toContain(PAT_SECRET);
  expect(result.message).not.toContain(DATABASE_URL_SECRET);
  expect(result.message).not.toContain(DOTTED_ENV_SECRET);
  expect(result.message).not.toContain(DOUBLE_SEPARATOR_SECRET);
  expect(result.message).toContain("[redacted]");
  expect(persisted).not.toContain(STRUCTURED_SECRET);
  expect(persisted).not.toContain(ARGV_SECRET);
  expect(persisted).not.toContain(PRIVATE_KEY_SECRET);
  expect(persisted).not.toContain(PAT_SECRET);
  expect(persisted).not.toContain(DATABASE_URL_SECRET);
  expect(persisted).not.toContain(DOTTED_ENV_SECRET);
  expect(persisted).not.toContain(DOUBLE_SEPARATOR_SECRET);
  expect(events.lines.join("\n")).not.toContain(PRIVATE_KEY_SECRET);
  expect(events.lines.join("\n")).not.toContain(PAT_SECRET);
  expect(events.lines.join("\n")).not.toContain(DATABASE_URL_SECRET);
  expect(events.lines.join("\n")).not.toContain(DOTTED_ENV_SECRET);
  expect(events.lines.join("\n")).not.toContain(DOUBLE_SEPARATOR_SECRET);
  expect(persisted).toContain("[redacted]");
});

test("shares ordered redaction state across merged engine output", async () => {
  const binary = join(directory, "llama-server");
  writeFileSync(binary, "");
  chmodSync(binary, 0o755);
  const crossStreamRunner: ProcessRunner = {
    ...runner,
    spawnDetached: () => crossStreamFailedChild(),
  };
  const result = await launch(binary, crossStreamRunner);
  let persisted = "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    persisted = readFileSync(result.log_file ?? "", "utf8");
    if (persisted.includes("[redacted]")) break;
    await Bun.sleep(5);
  }

  expect(result.success).toBe(false);
  expect(result.message).not.toContain(STRUCTURED_SECRET);
  expect(result.message).toContain("[redacted]");
  expect(persisted).not.toContain(STRUCTURED_SECRET);
  expect(persisted).toContain("[redacted]");
});

test("redacts query continuations in engine persistence failure tails and events", async () => {
  const binary = join(directory, "llama-server");
  writeFileSync(binary, "");
  chmodSync(binary, 0o755);
  const queryRunner: ProcessRunner = {
    ...runner,
    spawnDetached: queryContinuationFailedChild,
  };
  const events = new CapturingEventManager();
  const result = await launch(binary, queryRunner, events);
  const persisted = readFileSync(result.log_file ?? "", "utf8");
  const surfaces = `${result.message}\n${persisted}\n${events.lines.join("\n")}`;

  expect(result.success).toBe(false);
  expect(surfaces).not.toContain(QUERY_SECRET);
  expect(surfaces).toContain("[redacted]");
});

for (const interleaving of INTERLEAVINGS) {
  test(`redacts engine cross-stream ${interleaving} fragments`, async () => {
    const binary = join(directory, "llama-server");
    writeFileSync(binary, "");
    chmodSync(binary, 0o755);
    const interleavedRunner: ProcessRunner = {
      ...runner,
      spawnDetached: () => interleavedFailedChild(interleaving),
    };
    const events = new CapturingEventManager();
    const result = await launch(binary, interleavedRunner, events);
    const persisted = readFileSync(result.log_file ?? "", "utf8");

    expect(result.success).toBe(false);
    expect(result.message).not.toContain(STRUCTURED_SECRET);
    expect(persisted).not.toContain(STRUCTURED_SECRET);
    expect(events.lines.join("\n")).not.toContain(STRUCTURED_SECRET);
    expect(`${result.message}\n${persisted}`).toContain("[redacted]");
  });
}

test("redacts runtime errors through prior ordered output state", async () => {
  const binary = join(directory, "llama-server");
  writeFileSync(binary, "");
  chmodSync(binary, 0o755);
  const runtimeErrorRunner: ProcessRunner = {
    ...runner,
    spawnDetached: runtimeErrorChild,
  };
  const events = new CapturingEventManager();
  const result = await launch(binary, runtimeErrorRunner, events);
  const persisted = readFileSync(result.log_file ?? "", "utf8");

  expect(result.success).toBe(false);
  expect(result.message).not.toContain(STRUCTURED_SECRET);
  expect(persisted).not.toContain(STRUCTURED_SECRET);
  expect(events.lines.join("\n")).not.toContain(STRUCTURED_SECRET);
  expect(`${result.message}\n${persisted}`).toContain("[redacted]");
});
