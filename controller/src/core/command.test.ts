import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { resolveBinary } from "./command";

const executableName = (name: string): string =>
  process.platform === "win32" ? `${name}.exe` : name;

const createExecutable = (directory: string, name: string): string => {
  const filePath = join(directory, executableName(name));
  writeFileSync(filePath, "");
  chmodSync(filePath, 0o755);
  return filePath;
};

describe("resolveBinary", () => {
  let temporaryDirectory: string;
  let savedPath: string | undefined;
  let savedRuntimeBin: string | undefined;
  let savedSnap: string | undefined;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "resolve-binary-"));
    savedPath = process.env["PATH"];
    savedRuntimeBin = process.env["LOCAL_STUDIO_RUNTIME_BIN"];
    savedSnap = process.env["SNAP"];
    delete process.env["LOCAL_STUDIO_RUNTIME_BIN"];
    delete process.env["SNAP"];
  });

  afterEach(() => {
    process.env["PATH"] = savedPath;
    if (savedRuntimeBin === undefined) delete process.env["LOCAL_STUDIO_RUNTIME_BIN"];
    else process.env["LOCAL_STUDIO_RUNTIME_BIN"] = savedRuntimeBin;
    if (savedSnap === undefined) delete process.env["SNAP"];
    else process.env["SNAP"] = savedSnap;
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test("resolves a bare name from PATH using the platform delimiter", () => {
    const expected = createExecutable(temporaryDirectory, "local-studio-test-tool");
    process.env["PATH"] = temporaryDirectory;
    expect(resolveBinary("local-studio-test-tool")).toBe(expected);
  });

  test("searches every PATH entry, not just the first", () => {
    const emptyDirectory = join(temporaryDirectory, "empty");
    const toolDirectory = join(temporaryDirectory, "tools");
    mkdirSync(emptyDirectory);
    mkdirSync(toolDirectory);
    const expected = createExecutable(toolDirectory, "local-studio-test-tool");
    process.env["PATH"] = [emptyDirectory, toolDirectory].join(delimiter);
    expect(resolveBinary("local-studio-test-tool")).toBe(expected);
  });

  test("returns null when the binary is not on PATH", () => {
    process.env["PATH"] = temporaryDirectory;
    expect(resolveBinary("local-studio-missing-tool")).toBeNull();
  });

  test("returns null for an empty name", () => {
    expect(resolveBinary("")).toBeNull();
  });

  test("resolves an explicit path directly", () => {
    const expected = createExecutable(temporaryDirectory, "local-studio-test-tool");
    expect(resolveBinary(expected)).toBe(expected);
  });

  test("returns null for an explicit path that does not exist", () => {
    expect(
      resolveBinary(join(temporaryDirectory, executableName("local-studio-missing-tool"))),
    ).toBeNull();
  });

  test("prefers LOCAL_STUDIO_RUNTIME_BIN over PATH", () => {
    const runtimeDirectory = join(temporaryDirectory, "runtime-bin");
    const pathDirectory = join(temporaryDirectory, "path-bin");
    mkdirSync(runtimeDirectory);
    mkdirSync(pathDirectory);
    const expected = createExecutable(runtimeDirectory, "local-studio-test-tool");
    createExecutable(pathDirectory, "local-studio-test-tool");
    process.env["LOCAL_STUDIO_RUNTIME_BIN"] = runtimeDirectory;
    process.env["PATH"] = pathDirectory;
    expect(resolveBinary("local-studio-test-tool")).toBe(expected);
  });
});
