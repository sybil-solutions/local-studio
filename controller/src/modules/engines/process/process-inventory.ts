import { realProcessRunner, type ProcessRunner } from "../../../core/command";

export type ProcessInventoryEntry = {
  pid: number;
  ppid: number;
  stat: string;
  command: string;
  args: string[];
};

export const splitCommand = (command: string): string[] => {
  const matches = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((token) => token.replace(/^"|"$/g, ""));
};

const parseInventoryLine = (line: string): ProcessInventoryEntry | null => {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
  if (!match) return null;
  const command = match[4] ?? "";
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    stat: match[3] ?? "",
    command,
    args: splitCommand(command),
  };
};

const WINDOWS_PROCESS_QUERY =
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CommandLine | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress";

type CimProcessRow = {
  ProcessId?: number;
  ParentProcessId?: number;
  CommandLine?: string | null;
};

export const parseWindowsProcessInventory = (output: string): ProcessInventoryEntry[] => {
  try {
    const parsed: unknown = JSON.parse(output);
    const rows = (Array.isArray(parsed) ? parsed : [parsed]) as CimProcessRow[];
    return rows
      .map((row): ProcessInventoryEntry => {
        const command = row.CommandLine ?? "";
        return {
          pid: Number(row.ProcessId ?? 0),
          ppid: Number(row.ParentProcessId ?? 0),
          stat: "",
          command,
          args: splitCommand(command),
        };
      })
      .filter((entry) => entry.pid > 0);
  } catch {
    return [];
  }
};

const listWindowsProcessInventory = (runner: ProcessRunner): ProcessInventoryEntry[] => {
  const result = runner.runSync("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    WINDOWS_PROCESS_QUERY,
  ]);
  if (result.status !== 0) return [];
  return parseWindowsProcessInventory(result.stdout);
};

const listPosixProcessInventory = (runner: ProcessRunner): ProcessInventoryEntry[] => {
  const result = runner.runSync("ps", ["-eo", "pid=,ppid=,stat=,args="]);
  if (result.status !== 0) return [];
  const output = result.stdout.trim();
  if (!output) return [];
  return output
    .split("\n")
    .flatMap((line) => parseInventoryLine(line) ?? [])
    .filter((entry) => entry.pid > 0);
};

export const listProcessInventory = (
  runner: ProcessRunner = realProcessRunner,
): ProcessInventoryEntry[] => {
  try {
    return process.platform === "win32"
      ? listWindowsProcessInventory(runner)
      : listPosixProcessInventory(runner);
  } catch {
    return [];
  }
};
