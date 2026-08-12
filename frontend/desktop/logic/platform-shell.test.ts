import { describe, expect, test } from "bun:test";
import { resolveInteractiveShell } from "./platform-shell";

describe("resolveInteractiveShell", () => {
  test("preserves the configured Unix shell", () => {
    expect(resolveInteractiveShell({ platform: "darwin", env: { SHELL: "/bin/zsh" } })).toEqual({
      shell: "/bin/zsh",
      args: [],
    });
  });

  test("prefers PowerShell 7 on Windows", () => {
    const shell = resolveInteractiveShell({
      platform: "win32",
      env: {
        Path: String.raw`C:\Tools;C:\Windows\System32`,
        COMSPEC: String.raw`C:\Windows\cmd.exe`,
      },
      executableExists: (candidate) => candidate === String.raw`C:\Tools\pwsh.exe`,
    });
    expect(shell).toEqual({ shell: String.raw`C:\Tools\pwsh.exe`, args: ["-NoLogo"] });
  });

  test("falls back to COMSPEC when PowerShell is unavailable", () => {
    const shell = resolveInteractiveShell({
      platform: "win32",
      env: { COMSPEC: String.raw`C:\Windows\System32\cmd.exe` },
      executableExists: () => false,
    });
    expect(shell).toEqual({ shell: String.raw`C:\Windows\System32\cmd.exe`, args: [] });
  });

  test("uses Windows PowerShell before cmd", () => {
    const powershell = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
    const shell = resolveInteractiveShell({
      platform: "win32",
      env: { SystemRoot: String.raw`C:\Windows`, COMSPEC: String.raw`C:\Windows\cmd.exe` },
      executableExists: (candidate) => candidate === powershell,
    });
    expect(shell).toEqual({ shell: powershell, args: ["-NoLogo"] });
  });
});
