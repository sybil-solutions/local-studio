import { Effect } from "effect";
import {
  runCommandAsyncEffect,
  type AsyncCommandOptions,
  type AsyncCommandResult,
} from "../../core/command";

export interface WslDistribution {
  readonly name: string;
  readonly version: number;
  readonly default: boolean;
}

const WSL_TIMEOUT_MS = 15_000;

export const normalizeWslOutput = (value: string): string =>
  value
    .replaceAll("\0", "")
    .replace(/^\uFEFF/, "")
    .trim();

export const parseWslVerboseList = (value: string): WslDistribution[] => {
  const distributions: WslDistribution[] = [];
  for (const rawLine of normalizeWslOutput(value).split(/\r?\n/)) {
    const isDefault = /^\s*\*/.test(rawLine);
    const line = rawLine.replace(/^\s*\*\s*/, "").trim();
    const columns = line.split(/\s{2,}/).map((column) => column.trim());
    const version = Number(columns.at(-1));
    const name = columns[0] ?? "";
    if (!name || columns.length < 3 || !Number.isInteger(version)) continue;
    distributions.push({ name, version, default: isDefault });
  }
  return distributions;
};

export const parseWslQuietList = (value: string): string[] =>
  normalizeWslOutput(value)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s*/, "").trim())
    .filter(Boolean);

export const isWslApplicationDistribution = (name: string): boolean =>
  !name.toLowerCase().startsWith("docker-desktop");

const wsl = (
  args: readonly string[],
  timeoutMs = WSL_TIMEOUT_MS,
): Effect.Effect<AsyncCommandResult> => runCommandAsyncEffect("wsl.exe", [...args], { timeoutMs });

export const listWslDistributions = (): Effect.Effect<readonly WslDistribution[]> =>
  process.platform !== "win32"
    ? Effect.succeed([])
    : wsl(["--list", "--verbose"]).pipe(
        Effect.map((result) =>
          result.status === 0
            ? parseWslVerboseList(result.stdout).filter(
                (distribution) =>
                  distribution.version === 2 && isWslApplicationDistribution(distribution.name),
              )
            : [],
        ),
      );

export const listRunningWslDistributions = (): Effect.Effect<readonly string[]> =>
  process.platform !== "win32"
    ? Effect.succeed([])
    : wsl(["--list", "--running", "--quiet"]).pipe(
        Effect.map((result) => (result.status === 0 ? parseWslQuietList(result.stdout) : [])),
      );

export const runInWsl = (
  distribution: string,
  args: readonly string[],
  timeoutMs = WSL_TIMEOUT_MS,
): Effect.Effect<AsyncCommandResult> =>
  wsl(["--distribution", distribution, "--exec", ...args], timeoutMs);

export const runInWslWithOptions = (
  distribution: string,
  args: readonly string[],
  options: AsyncCommandOptions,
): Effect.Effect<AsyncCommandResult> =>
  runCommandAsyncEffect("wsl.exe", ["--distribution", distribution, "--exec", ...args], options);
