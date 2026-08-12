import { describe, expect, test } from "bun:test";
import { pythonPathInVenv } from "./python-venv-path";

describe("pythonPathInVenv", () => {
  test("uses the native Python layout for each platform", () => {
    expect(pythonPathInVenv(String.raw`C:\data\runtime\venvs\vllm-latest`, "win32")).toBe(
      String.raw`C:\data\runtime\venvs\vllm-latest\Scripts\python.exe`,
    );
    expect(pythonPathInVenv("/data/runtime/venvs/vllm-latest", "darwin")).toBe(
      "/data/runtime/venvs/vllm-latest/bin/python",
    );
    expect(pythonPathInVenv("/data/runtime/venvs/vllm-latest", "linux")).toBe(
      "/data/runtime/venvs/vllm-latest/bin/python",
    );
  });
});
