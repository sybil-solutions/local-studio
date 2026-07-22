import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Effect, Schedule } from "effect";
import type { KittylitterPairingResult } from "../interfaces";

const execFileAsync = promisify(execFile);

const PAIR_RETRIES = 2;
const PAIR_RETRY_DELAY_MS = 5_000;

const executablePath = (): string => {
  const configured = process.env.KITTYLITTER_BIN?.trim();
  const userHome = homedir();
  const candidates = [
    configured && path.isAbsolute(configured) ? configured : undefined,
    path.join(
      userHome,
      "Library",
      "Application Support",
      "com.sigkitten.kittylitter",
      "bin",
      "kittylitter",
    ),
    path.join(userHome, ".local", "bin", "kittylitter"),
    "/opt/homebrew/bin/kittylitter",
    "/usr/local/bin/kittylitter",
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? "kittylitter";
};

export const normalizeKittylitterPairingJson = (input: string): string => {
  const decoded: unknown = JSON.parse(input);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("invalid pairing payload");
  }
  const value = decoded as Record<string, unknown>;
  if (
    typeof value.v !== "number" ||
    !Number.isInteger(value.v) ||
    typeof value.node_id !== "string" ||
    !value.node_id ||
    typeof value.token !== "string" ||
    !value.token ||
    (value.host_name !== undefined && (typeof value.host_name !== "string" || !value.host_name)) ||
    (value.relay !== undefined && value.relay !== null && typeof value.relay !== "string")
  ) {
    throw new Error("invalid pairing payload");
  }
  return JSON.stringify({
    v: value.v,
    node_id: value.node_id,
    token: value.token,
    ...(value.host_name ? { host_name: value.host_name } : {}),
    ...(value.relay !== undefined ? { relay: value.relay } : {}),
  });
};

const errorCode = (error: unknown): string =>
  error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";

export const getKittylitterPairingJson = async (options?: {
  retries?: number;
  retryDelayMs?: number;
}): Promise<KittylitterPairingResult> => {
  const retries = options?.retries ?? PAIR_RETRIES;
  const retryDelayMs = options?.retryDelayMs ?? PAIR_RETRY_DELAY_MS;
  const pairAttempt = Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync(executablePath(), ["pair"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: 30_000,
      });
      return normalizeKittylitterPairingJson(String(stdout).trim());
    },
    catch: errorCode,
  });
  return Effect.runPromise(
    pairAttempt.pipe(
      Effect.retry(Schedule.both(Schedule.spaced(retryDelayMs), Schedule.recurs(retries))),
      Effect.map((pairingJson): KittylitterPairingResult => ({ ok: true, pairingJson })),
      Effect.catch((code) =>
        Effect.succeed<KittylitterPairingResult>({
          ok: false,
          error: `KittyLitter is unavailable (${code}). Start the controller and try again.`,
        }),
      ),
    ),
  );
};
