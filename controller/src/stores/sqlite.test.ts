import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteDatabase } from "./sqlite";

let directory: string;
const modeOf = (path: string): number => statSync(path).mode & 0o777;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "local-studio-sqlite-security-"));
  chmodSync(directory, 0o700);
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

test("hardens live SQLite WAL and shared-memory sidecars on reopen", () => {
  if (process.platform === "win32") return;
  const path = join(directory, "controller.db");
  const first = openSqliteDatabase(path);
  first.run("PRAGMA journal_mode = WAL");
  first.run("CREATE TABLE synthetic_sidecar (value TEXT)");
  first.run("INSERT INTO synthetic_sidecar VALUES ('synthetic')");
  const sidecars = [`${path}-wal`, `${path}-shm`];
  for (const sidecar of sidecars) {
    expect(existsSync(sidecar)).toBe(true);
    chmodSync(sidecar, 0o666);
  }

  const second = openSqliteDatabase(path);
  for (const sidecar of sidecars) expect(modeOf(sidecar)).toBe(0o600);
  second.close();
  first.close();
});

test("rejects every symlinked SQLite sidecar without touching its target", () => {
  if (process.platform === "win32") return;
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const path = join(directory, `controller-${suffix.slice(1)}.db`);
    const target = join(directory, `target${suffix}`);
    const content = `UNCHANGED_SYNTHETIC_SIDECAR_${suffix}`;
    const database = openSqliteDatabase(path);
    database.close();
    writeFileSync(target, content, { mode: 0o644 });
    symlinkSync(target, `${path}${suffix}`);

    expect(() => openSqliteDatabase(path)).toThrow("Unsafe private database sidecar");
    expect(readFileSync(target, "utf8")).toBe(content);
    expect(modeOf(target)).toBe(0o644);
  }
});
