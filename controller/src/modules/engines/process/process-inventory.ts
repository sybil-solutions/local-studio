import { realProcessRunner, type ProcessRunner } from "../../../core/command";

export type ProcessInventoryEntry = {
  pid: number;
  ppid: number;
  pgid: number;
  stat: string;
  command: string;
  args: string[];
};

export const splitCommand = (command: string): string[] => {
  const matches = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((token) => token.replace(/^"|"$/g, ""));
};

const parseInventoryLine = (line: string): ProcessInventoryEntry | null => {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
  if (!match) return null;
  const command = match[5] ?? "";
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    pgid: Number(match[3]),
    stat: match[4] ?? "",
    command,
    args: splitCommand(command),
  };
};

export const listProcessInventory = (
  runner: ProcessRunner = realProcessRunner,
): ProcessInventoryEntry[] => {
  try {
    const result = runner.runSync("ps", ["-eo", "pid=,ppid=,pgid=,stat=,args="]);
    if (result.status !== 0) return [];
    const output = result.stdout.trim();
    if (!output) return [];
    return output
      .split("\n")
      .flatMap((line) => parseInventoryLine(line) ?? [])
      .filter((entry) => entry.pid > 0);
  } catch {
    return [];
  }
};
