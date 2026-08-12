import { describe, expect, test } from "bun:test";
import type { ProcessPlatform } from "../../../core/process-platform";
import { detectBackend, listProcesses } from "./process-scan";

const platform = (commandLine: string): ProcessPlatform => ({
  alive: () => true,
  inspect: () => null,
  list: () => [{ pid: 41, commandLine, startToken: null }],
  terminateTree: (): void => {},
});

describe("process discovery", () => {
  test("preserves quoted Windows executable paths", () => {
    const [entry] = listProcesses(
      platform(String.raw`"C:\Program Files\llama.cpp\llama-server.exe" --port 8080`),
    );
    expect(entry).toEqual({
      pid: 41,
      args: [String.raw`C:\Program Files\llama.cpp\llama-server.exe`, "--port", "8080"],
    });
    expect(detectBackend(entry?.args ?? [])).toBe("llamacpp");
  });
});
