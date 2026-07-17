import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPrivateLogStream,
  ensureLogsDirectory,
  listLogFiles,
  primaryLogPathFor,
  readFileTailBytes,
  tailFileLines,
} from "./log-files";

const SECRET = "SYNTHETIC_TAIL_SECRET";
const QUERY_SECRET = "SYNTHETIC_PROBE_SECRET";
const QUERY_PREFIX = "https://service.invalid/path?process%2Eenv%2EACCESS_TOKEN=";
const FILLER_CHUNK = Buffer.from(`${"ordinary historical diagnostic ".repeat(2_000)}\n`);
const OVERSIZED_CHUNK_COUNT = 160;
const MULTILINE_CHUNK_COUNT = 200;
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "local-studio-log-tail-"));
  chmodSync(directory, 0o700);
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

test("reconstructs multiline redaction state before applying a byte tail", () => {
  const path = join(directory, "multiline.log");
  writeFileSync(
    path,
    [`api_key="${SECRET}`, "SYNTHETIC_CONTINUATION", 'end" trailing diagnostic'].join("\n"),
    { mode: 0o600 },
  );

  const tail = readFileTailBytes(path, 64);

  expect(tail).not.toContain(SECRET);
  expect(tail).not.toContain("SYNTHETIC_CONTINUATION");
  expect(tail).toContain("trailing diagnostic");
});

test("returns bounded trailing records from ordinary large logs", () => {
  const path = join(directory, "large.log");
  const lines = Array.from({ length: 7_000 }, (_, index) => `ordinary diagnostic ${index}`);
  writeFileSync(path, lines.join("\n"), { mode: 0o644 });
  const lastLine = lines.at(-1);
  if (!lastLine) throw new Error("Missing final synthetic log line");

  expect(tailFileLines(path, 5)).toEqual(lines.slice(-5));
  expect(readFileTailBytes(path, 128)).toContain(lastLine);
  if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
});

const writeSparseLog = (path: string, size: number): void => {
  const descriptor = openSync(path, "w", 0o600);
  const newline = Buffer.from("\n");
  truncateSync(path, size);
  for (let offset = 64 * 1024; offset < size; offset += 64 * 1024) {
    writeSync(descriptor, newline, 0, newline.length, offset - 1);
  }
  writeSync(descriptor, newline, 0, newline.length, size - 1);
  closeSync(descriptor);
};

const writeOversizedLog = (path: string, secretPosition: "head" | "middle" | "tail"): void => {
  const descriptor = openSync(path, "w", 0o600);
  const secret = Buffer.from(`api_key=${SECRET}\n`);
  if (secretPosition === "head") writeSync(descriptor, secret);
  for (let index = 0; index < OVERSIZED_CHUNK_COUNT; index += 1) {
    if (secretPosition === "middle" && index === OVERSIZED_CHUNK_COUNT / 2) {
      writeSync(descriptor, secret);
    }
    writeSync(descriptor, FILLER_CHUNK);
  }
  if (secretPosition === "tail") writeSync(descriptor, secret);
  closeSync(descriptor);
};

const writeOversizedMultilineSecret = (path: string): void => {
  const descriptor = openSync(path, "w", 0o600);
  writeSync(descriptor, Buffer.from('api_key="\n'));
  for (let index = 0; index < MULTILINE_CHUNK_COUNT; index += 1) {
    writeSync(descriptor, FILLER_CHUNK);
  }
  writeSync(descriptor, Buffer.from(`${SECRET}\n`));
  closeSync(descriptor);
  expect(statSync(path).size).toBeGreaterThan(8 * 1024 * 1024);
};

const expectTailSurfacesRedacted = (path: string): void => {
  expect(readFileTailBytes(path, 1_024)).not.toContain(SECRET);
  expect(tailFileLines(path, 5).join("\n")).not.toContain(SECRET);
};

const regularFileNames = (path: string): string[] =>
  readdirSync(path).filter((name) => lstatSync(join(path, name)).isFile());

const expectPersistedFilesRedacted = (path: string): void => {
  const names = regularFileNames(path);
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    const persistedPath = join(path, name);
    expect(readFileSync(persistedPath, "utf8")).not.toContain(SECRET);
    if (process.platform !== "win32") expect(statSync(persistedPath).mode & 0o777).toBe(0o600);
  }
};

const startLogMigration = (dataDirectory: string): ReturnType<typeof Bun.spawn> => {
  const modulePath = join(import.meta.dir, "log-files.ts");
  return Bun.spawn({
    cmd: [
      process.execPath,
      "-e",
      `import { ensureLogsDirectory } from ${JSON.stringify(modulePath)}; ensureLogsDirectory(${JSON.stringify(dataDirectory)});`,
    ],
    stdout: "ignore",
    stderr: "ignore",
  });
};

const waitForMigrationTemporary = async (
  child: ReturnType<typeof startLogMigration>,
  logsDirectory: string,
): Promise<string | null> => {
  for (let attempt = 0; attempt < 5_000 && child.exitCode === null; attempt += 1) {
    const temporary = readdirSync(logsDirectory).find((name) => name.endsWith(".tmp"));
    if (temporary) return temporary;
    await Bun.sleep(1);
  }
  return null;
};

test("reads a 64 MiB persisted tail with bounded filesystem input", async () => {
  const dataDirectory = join(directory, "bounded-data");
  const path = primaryLogPathFor(dataDirectory, "bounded-large");
  const stream = createPrivateLogStream(path);
  await new Promise<void>((resolveClose, rejectClose) => {
    stream.once("error", rejectClose);
    stream.end(resolveClose);
  });
  writeSparseLog(path, 64 * 1024 * 1024);
  appendFileSync(path, `ordinary trailing diagnostic\napi_key=${SECRET}\n`);
  let bytesRead = 0;

  const tail = readFileTailBytes(path, 1024, (bytes) => {
    bytesRead += bytes;
  });

  expect(bytesRead).toBeGreaterThan(0);
  expect(bytesRead).toBeLessThanOrEqual(192 * 1024);
  expect(tail).not.toContain(SECRET);
  expect(tail).toContain("ordinary trailing diagnostic");
});

test("fails closed when a large untrusted tail may start inside a multiline secret", () => {
  const path = join(directory, "untrusted-large.log");
  writeSparseLog(path, 64 * 1024 * 1024);
  const descriptor = openSync(path, "r+");
  const opener = Buffer.from(`api_key="${SECRET}`);
  writeSync(descriptor, opener, 0, opener.length, 0);
  closeSync(descriptor);
  appendFileSync(path, `${SECRET}\n`);
  let bytesRead = 0;

  const tail = readFileTailBytes(path, 1024, (bytes) => {
    bytesRead += bytes;
  });

  expect(bytesRead).toBeLessThanOrEqual(192 * 1024);
  expect(tail).not.toContain(SECRET);
  expect(tail).toContain("[redacted]");
});

test("fails closed when bounded tails start after a split separator", () => {
  const path = join(directory, "large-split-separator.log");
  writeSparseLog(path, 9 * 1024 * 1024);
  appendFileSync(
    path,
    ['"api_key"', ":", " ".repeat(140_000), `"${SECRET}"`].join("\n"),
  );

  const byteTail = readFileTailBytes(path, 1_024);
  const lineTail = tailFileLines(path, 5, 1_024).join("\n");
  expect(byteTail).not.toContain(SECRET);
  expect(lineTail).not.toContain(SECRET);
  expect(byteTail).toContain("[redacted]");
  expect(lineTail).toContain("[redacted]");
});

test("invalidates trusted redaction after unlink and recreate", async () => {
  const dataDirectory = join(directory, "identity-unlink-data");
  const path = primaryLogPathFor(dataDirectory, "identity-unlink");
  const stream = createPrivateLogStream(path);
  await new Promise<void>((resolveClose, rejectClose) => {
    stream.once("error", rejectClose);
    stream.end(resolveClose);
  });
  unlinkSync(path);
  writeOversizedMultilineSecret(path);

  expectTailSurfacesRedacted(path);
});

test("invalidates trusted redaction after atomic log rotation", async () => {
  const dataDirectory = join(directory, "identity-rotate-data");
  const path = primaryLogPathFor(dataDirectory, "identity-rotate");
  const stream = createPrivateLogStream(path);
  await new Promise<void>((resolveClose, rejectClose) => {
    stream.once("error", rejectClose);
    stream.end(resolveClose);
  });
  const replacement = join(directory, "identity-rotate-replacement.log");
  const rotated = join(directory, "identity-rotate-previous.log");
  writeOversizedMultilineSecret(replacement);
  renameSync(path, rotated);
  renameSync(replacement, path);

  expectTailSurfacesRedacted(path);
});

test("migrates a new historical log after the directory was scanned", () => {
  const dataDirectory = join(directory, "identity-new-data");
  const logsDirectory = ensureLogsDirectory(dataDirectory);
  const path = join(logsDirectory, "vllm_identity-new.log");
  writeOversizedMultilineSecret(path);

  ensureLogsDirectory(dataDirectory);

  expect(readFileSync(path, "utf8")).not.toContain(SECRET);
  expectTailSurfacesRedacted(path);
});

test("remigrates a cached path after atomic replacement", () => {
  const dataDirectory = join(directory, "identity-remigrate-data");
  const logsDirectory = ensureLogsDirectory(dataDirectory);
  const path = join(logsDirectory, "vllm_identity-remigrate.log");
  writeFileSync(path, "ordinary historical diagnostic\n", { mode: 0o600 });
  ensureLogsDirectory(dataDirectory);
  const replacement = join(directory, "identity-remigrate-replacement.log");
  const rotated = join(directory, "identity-remigrate-previous.log");
  writeOversizedMultilineSecret(replacement);
  renameSync(path, rotated);
  renameSync(replacement, path);

  ensureLogsDirectory(dataDirectory);

  expect(readFileSync(path, "utf8")).not.toContain(SECRET);
  expectTailSurfacesRedacted(path);
});

test("migrates split secret values before serving API tails", () => {
  const dataDirectory = join(directory, "split-value-data");
  const logsDirectory = join(dataDirectory, "logs");
  mkdirSync(logsDirectory, { recursive: true, mode: 0o700 });
  chmodSync(dataDirectory, 0o700);
  chmodSync(logsDirectory, 0o700);
  const path = join(logsDirectory, "vllm_split-value.log");
  const structuredSecret = "SYNTHETIC_MIGRATED_STRUCTURED_SECRET";
  const argvSecret = "SYNTHETIC_MIGRATED_ARGV_SECRET";
  writeFileSync(
    path,
    [
      "{",
      '  "api_key":',
      "",
      `  "${structuredSecret}"`,
      "}",
      "[",
      '  "--api-key",',
      ",",
      `  "${argvSecret}"`,
      "]",
    ].join("\n"),
    { mode: 0o600 },
  );

  ensureLogsDirectory(dataDirectory);

  const persisted = readFileSync(path, "utf8");
  const apiTail = tailFileLines(path, 20).join("\n");
  expect(persisted).not.toContain(structuredSecret);
  expect(persisted).not.toContain(argvSecret);
  expect(apiTail).not.toContain(structuredSecret);
  expect(apiTail).not.toContain(argvSecret);
  expect(apiTail).toContain("[redacted]");
});

test("migrates normalized query continuations before serving file tails", () => {
  const dataDirectory = join(directory, "query-continuation-data");
  const logsDirectory = join(dataDirectory, "logs");
  mkdirSync(logsDirectory, { recursive: true, mode: 0o700 });
  chmodSync(dataDirectory, 0o700);
  chmodSync(logsDirectory, 0o700);
  const path = join(logsDirectory, "vllm_query-continuation.log");
  writeFileSync(path, `${QUERY_PREFIX}\n${QUERY_SECRET}\n`, { mode: 0o600 });

  ensureLogsDirectory(dataDirectory);

  const persisted = readFileSync(path, "utf8");
  const apiTail = tailFileLines(path, 10).join("\n");
  expect(`${persisted}\n${apiTail}`).not.toContain(QUERY_SECRET);
  expect(`${persisted}\n${apiTail}`).toContain("[redacted]");
});

test("retains pending redaction across oversized migration syntax", () => {
  const dataDirectory = join(directory, "oversized-syntax-data");
  const logsDirectory = join(dataDirectory, "logs");
  mkdirSync(logsDirectory, { recursive: true, mode: 0o700 });
  chmodSync(dataDirectory, 0o700);
  chmodSync(logsDirectory, 0o700);
  const path = join(logsDirectory, "vllm_oversized-syntax.log");
  const secret = "SYNTHETIC_OVERSIZED_SYNTAX_SECRET";
  writeFileSync(path, ['"api_key":', " ".repeat(65_537), `"${secret}"`].join("\n"), {
    mode: 0o600,
  });

  ensureLogsDirectory(dataDirectory);

  const persisted = readFileSync(path, "utf8");
  const apiTail = tailFileLines(path, 10).join("\n");
  expect(persisted).not.toContain(secret);
  expect(apiTail).not.toContain(secret);
  expect(apiTail).toContain("[redacted]");
});

for (const secretPosition of ["head", "middle", "tail"] as const) {
  test(`redacts an oversized historical log with a secret at the ${secretPosition}`, () => {
    const dataDirectory = join(directory, `data-${secretPosition}`);
    const logsDirectory = join(dataDirectory, "logs");
    mkdirSync(logsDirectory, { recursive: true, mode: 0o700 });
    chmodSync(dataDirectory, 0o700);
    chmodSync(logsDirectory, 0o700);
    const path = join(logsDirectory, "vllm_controller.log");
    writeOversizedLog(path, secretPosition);
    expect(statSync(path).size).toBeGreaterThan(8 * 1024 * 1024);

    ensureLogsDirectory(dataDirectory);

    expect(listLogFiles(dataDirectory).map((entry) => entry.path)).toEqual([path]);
    expect(readdirSync(logsDirectory).some((name) => name.includes("unredacted"))).toBe(false);
    expectPersistedFilesRedacted(logsDirectory);
  });
}

test("recovers a legacy raw-log artifact without retaining its marker", () => {
  const dataDirectory = join(directory, "legacy-data");
  const logsDirectory = join(dataDirectory, "logs");
  mkdirSync(logsDirectory, { recursive: true, mode: 0o700 });
  chmodSync(dataDirectory, 0o700);
  chmodSync(logsDirectory, 0o700);
  const legacyPath = join(
    logsDirectory,
    ".vllm_controller.log.unredacted-41000-synthetic-generation",
  );
  const legacyControllerPath = join(
    dataDirectory,
    ".controller.log.unredacted-41001-synthetic-generation",
  );
  writeFileSync(legacyPath, `api_key=${SECRET}\n`, { mode: 0o600 });
  writeFileSync(legacyControllerPath, `api_key=${SECRET}\n`, { mode: 0o600 });

  ensureLogsDirectory(dataDirectory);

  expect(readdirSync(logsDirectory).some((name) => name.includes("unredacted"))).toBe(false);
  expect(readdirSync(dataDirectory).some((name) => name.includes("unredacted"))).toBe(false);
  expectPersistedFilesRedacted(logsDirectory);
});

test("removes a historical log when its identity changes during migration", async () => {
  const dataDirectory = join(directory, "failed-data");
  const logsDirectory = join(dataDirectory, "logs");
  mkdirSync(logsDirectory, { recursive: true, mode: 0o700 });
  chmodSync(dataDirectory, 0o700);
  chmodSync(logsDirectory, 0o700);
  const path = join(logsDirectory, "vllm_controller.log");
  writeSparseLog(path, 64 * 1024 * 1024);
  appendFileSync(path, `api_key=${SECRET}\n`);
  const child = startLogMigration(dataDirectory);
  const temporary = await waitForMigrationTemporary(child, logsDirectory);
  expect(temporary).toMatch(/^\.log-migration-[0-9a-f-]+\.tmp$/);
  child.kill("SIGSTOP");
  unlinkSync(path);
  child.kill("SIGCONT");
  await child.exited;

  expect(readdirSync(logsDirectory).some((name) => name.endsWith(".tmp"))).toBe(false);
  expect(regularFileNames(logsDirectory)).toEqual([]);
}, 30_000);

test("recovers an interrupted oversized-log migration", async () => {
  const dataDirectory = join(directory, "interrupted-data");
  const logsDirectory = join(dataDirectory, "logs");
  mkdirSync(logsDirectory, { recursive: true, mode: 0o700 });
  chmodSync(dataDirectory, 0o700);
  chmodSync(logsDirectory, 0o700);
  const path = join(logsDirectory, "vllm_controller.log");
  writeSparseLog(path, 64 * 1024 * 1024);
  appendFileSync(path, `api_key=${SECRET}\n`);
  const child = startLogMigration(dataDirectory);
  const temporary = await waitForMigrationTemporary(child, logsDirectory);
  if (temporary) child.kill("SIGKILL");
  await child.exited;
  expect(temporary).toMatch(/^\.log-migration-[0-9a-f-]+\.tmp$/);

  ensureLogsDirectory(dataDirectory);

  expect(readdirSync(logsDirectory).some((name) => name.endsWith(".tmp"))).toBe(false);
  expectPersistedFilesRedacted(logsDirectory);
}, 30_000);
