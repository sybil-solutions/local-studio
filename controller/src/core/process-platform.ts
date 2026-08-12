import { spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";

export type ProcessIdentity = {
  pid: number;
  commandLine: string;
  startToken: string | null;
};

type CommandResult = { status: number | null; stdout: string };
type CommandRunner = (command: string, args: string[]) => CommandResult;
type KillProcess = (pid: number, signal?: NodeJS.Signals | 0) => void;

export type ProcessPlatform = {
  alive(pid: number): boolean;
  inspect(pid: number): ProcessIdentity | null;
  list(): ProcessIdentity[];
  terminateTree(pid: number, force: boolean): void;
};

type ProcessPlatformOptions = {
  platform?: NodeJS.Platform;
  run?: CommandRunner;
  kill?: KillProcess;
  readFile?: (path: string) => string;
};

const runCommand: CommandRunner = (command, args) => {
  try {
    const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
    return { status: result.status, stdout: result.stdout?.trim() ?? "" };
  } catch {
    return { status: null, stdout: "" };
  }
};

export const splitProcessCommandLine = (command: string): string[] =>
  (command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map((token) => token.replace(/^"|"$/g, ""));

export const parseWindowsProcessList = (output: string): ProcessIdentity[] => {
  if (!output.trim()) return [];
  try {
    const value = JSON.parse(output) as unknown;
    const rows = Array.isArray(value) ? value : [value];
    return rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const record = row as Record<string, unknown>;
      const pid = Number(record["ProcessId"]);
      if (!Number.isInteger(pid) || pid <= 0) return [];
      return [
        {
          pid,
          commandLine: typeof record["CommandLine"] === "string" ? record["CommandLine"] : "",
          startToken:
            typeof record["CreationDate"] === "string" && record["CreationDate"]
              ? record["CreationDate"]
              : null,
        },
      ];
    });
  } catch {
    return [];
  }
};

const parsePosixProcessList = (output: string): ProcessIdentity[] =>
  output
    .trim()
    .split("\n")
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!match) return [];
      const pid = Number(match[1]);
      return Number.isInteger(pid) && pid > 0
        ? [{ pid, commandLine: match[2] ?? "", startToken: null }]
        : [];
    });

const windowsPowerShell = (run: CommandRunner, script: string): CommandResult => {
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script];
  const legacy = run("powershell.exe", args);
  return legacy.status === 0 ? legacy : run("pwsh.exe", args);
};

export const makeProcessPlatform = (options: ProcessPlatformOptions = {}): ProcessPlatform => {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runCommand;
  const kill = options.kill ?? process.kill;
  const readFile = options.readFile ?? ((path: string): string => readFileSync(path, "utf8"));

  const alive = (pid: number): boolean => {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const inspect = (pid: number): ProcessIdentity | null => {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    if (platform === "win32") {
      const script = `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object ProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress`;
      return parseWindowsProcessList(windowsPowerShell(run, script).stdout)[0] ?? null;
    }
    const command = run("ps", ["-o", "command=", "-p", String(pid)]);
    if (command.status !== 0 || !command.stdout) return null;
    let startToken: string | null = null;
    if (platform === "linux") {
      try {
        const stat = readFile(`/proc/${pid}/stat`);
        startToken = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
      } catch {
        startToken = null;
      }
    }
    return { pid, commandLine: command.stdout, startToken };
  };

  const list = (): ProcessIdentity[] => {
    if (platform === "win32") {
      const script =
        "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress";
      return parseWindowsProcessList(windowsPowerShell(run, script).stdout);
    }
    const result = run("ps", ["-eo", "pid=,args="]);
    return result.status === 0 ? parsePosixProcessList(result.stdout) : [];
  };

  const terminateTree = (pid: number, force: boolean): void => {
    if (!Number.isInteger(pid) || pid <= 0) return;
    if (platform === "win32") {
      const args = ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
      const result = run("taskkill.exe", args);
      if (result.status === 0) return;
      try {
        kill(pid, force ? "SIGKILL" : "SIGTERM");
      } catch {
        return;
      }
      return;
    }
    const signal = force ? "SIGKILL" : "SIGTERM";
    for (const target of [-pid, pid]) {
      try {
        kill(target, signal);
      } catch {
        continue;
      }
    }
  };

  return { alive, inspect, list, terminateTree };
};

export const realProcessPlatform = makeProcessPlatform();

export const terminateChildProcess = (
  child: Pick<ChildProcess, "pid" | "kill">,
  force: boolean,
): boolean => {
  if (process.platform === "win32" && child.pid) {
    const result = runCommand("taskkill.exe", [
      "/PID",
      String(child.pid),
      "/T",
      ...(force ? ["/F"] : []),
    ]);
    if (result.status === 0) return true;
  }
  return child.kill(force ? "SIGKILL" : "SIGTERM");
};
