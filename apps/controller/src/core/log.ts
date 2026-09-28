import type { Bus } from "./bus";
import type { Obs } from "./obs";

const SECRET = /(Bearer\s+|x-api-key:\s*|api[_-]?key["'=:\s]+|token=)([A-Za-z0-9._\-]{12,})/gi;

export const redact = (s: string): string => s.replace(SECRET, (_m, p: string) => `${p}[redacted]`);

export interface Log {
  info(msg: string): void;
  warn(msg: string, where?: string): void;
  error(msg: string, where?: string): void;
}

export const errText = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e));

export const createLog = (bus: Bus, obs: Obs): Log => {
  const out = (level: "info" | "warn" | "error", msg: string, where?: string) => {
    const clean = redact(msg);
    const at = Date.now();
    const line = JSON.stringify({ ts: new Date(at).toISOString(), level, ...(where ? { where } : {}), msg: clean });
    if (level === "info") console.log(line);
    else {
      console.error(line);
      obs.error(where ?? level, clean);
    }
    bus.emit({ type: "log", data: { level, msg: clean, at } });
  };
  return { info: (m) => out("info", m), warn: (m, w) => out("warn", m, w), error: (m, w) => out("error", m, w) };
};
