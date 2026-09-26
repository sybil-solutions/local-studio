import type { Bus } from "./bus";

const SECRET = /(Bearer\s+|x-api-key:\s*|api[_-]?key["'=:\s]+|token=)([A-Za-z0-9._\-]{12,})/gi;

export const redact = (s: string): string => s.replace(SECRET, (_m, p: string) => `${p}[redacted]`);

export interface Log {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export const createLog = (bus: Bus): Log => {
  const out = (level: "info" | "warn" | "error", msg: string) => {
    const clean = redact(msg);
    const line = `${new Date().toISOString()} ${level} ${clean}`;
    if (level === "error") console.error(line);
    else console.log(line);
    bus.emit({ type: "log", data: { level, msg: clean, at: Date.now() } });
  };
  return { info: (m) => out("info", m), warn: (m) => out("warn", m), error: (m) => out("error", m) };
};
