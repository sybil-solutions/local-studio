import { describe, expect, test } from "bun:test";

import { parseWindowsProcessInventory } from "./process-inventory";

describe("parseWindowsProcessInventory", () => {
  test("parses a CIM JSON array into inventory entries with tokenized args", () => {
    const output = JSON.stringify([
      { ProcessId: 4200, ParentProcessId: 1000, CommandLine: '"C:\\Program Files\\Python\\python.exe" -m vllm' },
      { ProcessId: 4300, ParentProcessId: 4200, CommandLine: "llama-server.exe --port 8000" },
    ]);

    expect(parseWindowsProcessInventory(output)).toEqual([
      {
        pid: 4200,
        ppid: 1000,
        stat: "",
        command: '"C:\\Program Files\\Python\\python.exe" -m vllm',
        args: ["C:\\Program Files\\Python\\python.exe", "-m", "vllm"],
      },
      {
        pid: 4300,
        ppid: 4200,
        stat: "",
        command: "llama-server.exe --port 8000",
        args: ["llama-server.exe", "--port", "8000"],
      },
    ]);
  });

  test("accepts a single non-array object and drops rows without a pid", () => {
    const single = JSON.stringify({ ProcessId: 77, ParentProcessId: 1, CommandLine: "node server.js" });
    expect(parseWindowsProcessInventory(single)).toEqual([
      { pid: 77, ppid: 1, stat: "", command: "node server.js", args: ["node", "server.js"] },
    ]);

    const withEmptyPid = JSON.stringify([{ ParentProcessId: 1, CommandLine: "x" }]);
    expect(parseWindowsProcessInventory(withEmptyPid)).toEqual([]);
  });

  test("returns an empty list for malformed output", () => {
    expect(parseWindowsProcessInventory("")).toEqual([]);
    expect(parseWindowsProcessInventory("not json")).toEqual([]);
  });
});
