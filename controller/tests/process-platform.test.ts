import { describe, expect, test } from "bun:test";
import { makeProcessPlatform, parseWindowsProcessList } from "../src/core/process-platform";

describe("Windows process platform", () => {
  test("parses CIM process identities without inventing missing values", () => {
    expect(
      parseWindowsProcessList(
        JSON.stringify([
          {
            ProcessId: 11,
            CommandLine: '"C:\\Program Files\\llama-server.exe" --port 8000',
            CreationDate: "20260810120000.000000-180",
          },
          { ProcessId: 12, CommandLine: null, CreationDate: null },
        ]),
      ),
    ).toEqual([
      {
        pid: 11,
        commandLine: '"C:\\Program Files\\llama-server.exe" --port 8000',
        startToken: "20260810120000.000000-180",
      },
      { pid: 12, commandLine: "", startToken: null },
    ]);
  });

  test("queries CIM and plans graceful then forced tree termination", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const platform = makeProcessPlatform({
      platform: "win32",
      kill: () => {},
      run: (command, args) => {
        calls.push({ command, args });
        if (command === "powershell.exe") {
          return {
            status: 0,
            stdout: JSON.stringify({
              ProcessId: 42,
              CommandLine: "llama-server.exe --port 8000",
              CreationDate: "token",
            }),
          };
        }
        return { status: 0, stdout: "" };
      },
    });

    expect(platform.inspect(42)).toEqual({
      pid: 42,
      commandLine: "llama-server.exe --port 8000",
      startToken: "token",
    });
    platform.terminateTree(42, false);
    platform.terminateTree(42, true);
    expect(calls.at(-2)).toEqual({ command: "taskkill.exe", args: ["/PID", "42", "/T"] });
    expect(calls.at(-1)).toEqual({
      command: "taskkill.exe",
      args: ["/PID", "42", "/T", "/F"],
    });
  });
});
