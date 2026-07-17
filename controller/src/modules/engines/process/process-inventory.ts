import { realProcessRunner, type ProcessRunner } from "../../../core/command";

export type ProcessInventoryEntry = {
  pid: number;
  ppid: number;
  processGroupId: number;
  startIdentity: string;
  stat: string;
  command: string;
  args: string[];
};

export type ProcessInventoryResult =
  | { status: "available"; entries: ProcessInventoryEntry[] }
  | { status: "unavailable"; entries: ProcessInventoryEntry[] };

const processInventoryEnvironment = (): NodeJS.ProcessEnv => ({
  ...process.env,
  LC_ALL: "C",
  LANG: "C",
  LANGUAGE: "C",
});

export const normalizeProcessStartIdentity = (value: string): string | null => {
  const startedAtMs = Date.parse(value.replace(/\s+/g, " ").trim());
  return Number.isSafeInteger(startedAtMs) && startedAtMs > 0 ? String(startedAtMs) : null;
};

export const splitCommand = (command: string): string[] => {
  const matches = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((token) => token.replace(/^"|"$/g, ""));
};

export const parseInventoryLine = (line: string): ProcessInventoryEntry | null => {
  const match = line
    .trim()
    .match(
      /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)(?:\s+(.*))?$/,
    );
  if (!match) return null;
  const startIdentity = normalizeProcessStartIdentity(match[4] ?? "");
  if (!startIdentity) return null;
  const command = match[6] ?? "";
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    processGroupId: Number(match[3]),
    startIdentity,
    stat: match[5] ?? "",
    command,
    args: splitCommand(command),
  };
};

export const readProcessInventory = (
  runner: ProcessRunner = realProcessRunner,
): ProcessInventoryResult => {
  try {
    const result = runner.runSync(
      "ps",
      ["-eo", "pid=,ppid=,pgid=,lstart=,stat=,args="],
      { env: processInventoryEnvironment() },
    );
    if (result.status !== 0) return { status: "unavailable", entries: [] };
    const output = result.stdout.trim();
    if (!output) return { status: "available", entries: [] };
    const parsed = output.split("\n").map(parseInventoryLine);
    if (parsed.some((entry) => entry === null)) {
      return {
        status: "unavailable",
        entries: parsed.flatMap((entry) => entry ?? []).filter((entry) => entry.pid > 0),
      };
    }
    return {
      status: "available",
      entries: parsed.flatMap((entry) => entry ?? []).filter((entry) => entry.pid > 0),
    };
  } catch {
    return { status: "unavailable", entries: [] };
  }
};

export const listProcessInventory = (
  runner: ProcessRunner = realProcessRunner,
): ProcessInventoryEntry[] => {
  const result = readProcessInventory(runner);
  return result.entries;
};
