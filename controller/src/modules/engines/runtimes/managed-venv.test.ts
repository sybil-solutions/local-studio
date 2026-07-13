import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { venvConsoleScriptPath, venvPythonPath } from "./managed-venv";

const venvDirectory = join("data", "runtime", "venvs", "vllm-latest");

describe("venvPythonPath", () => {
  test("uses the platform venv layout", () => {
    const expected =
      process.platform === "win32"
        ? join(venvDirectory, "Scripts", "python.exe")
        : join(venvDirectory, "bin", "python");
    expect(venvPythonPath(venvDirectory)).toBe(expected);
  });
});

describe("venvConsoleScriptPath", () => {
  test("locates console scripts next to the interpreter", () => {
    const python = venvPythonPath(venvDirectory);
    const expected =
      process.platform === "win32"
        ? join(venvDirectory, "Scripts", "vllm.exe")
        : join(venvDirectory, "bin", "vllm");
    expect(venvConsoleScriptPath(python, "vllm")).toBe(expected);
  });
});
