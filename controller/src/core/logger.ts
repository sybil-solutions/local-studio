import type { WriteStream } from "node:fs";
import { createPrivateLogStream } from "./log-files";
import { createLogPayloadRedactor, redactLogValue } from "./log-redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  filePath?: string;
  /** Called after formatting a log line (best-effort). Useful for pushing logs to SSE channels. */
  onLine?: (line: string, meta: { level: LogLevel }) => void | Promise<void>;
}

export interface Logger {
  debug: (message: string, details?: Record<string, unknown>) => void;
  info: (message: string, details?: Record<string, unknown>) => void;
  warn: (message: string, details?: Record<string, unknown>) => void;
  error: (message: string, details?: Record<string, unknown>) => void;
}

export const createLogger = (level: LogLevel, options: LoggerOptions = {}): Logger => {
  const redactor = createLogPayloadRedactor();
  const stream = ((): WriteStream | null => {
    if (!options.filePath) return null;
    try {
      const opened = createPrivateLogStream(options.filePath);
      opened.on("error", Boolean);
      return opened;
    } catch {
      return null;
    }
  })();

  const priority: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };

  const shouldLog = (target: LogLevel): boolean => priority[target] >= priority[level];

  const format = (message: string, details?: Record<string, unknown>): string => {
    if (!details || Object.keys(details).length === 0) {
      return redactor.redact(message);
    }
    return redactor.redact(`${message} ${JSON.stringify(redactLogValue(details))}`);
  };

  const toLine = (target: LogLevel, message: string): string => {
    const ts = new Date().toISOString();
    return `${ts} ${target.toUpperCase()} ${message}`;
  };

  const writeConsole = (writeLine: (message: string) => void, line: string): void => {
    try {
      writeLine(line);
    } catch {
      return;
    }
  };

  const writeFile = (line: string): void => {
    if (!stream) return;
    try {
      stream.write(`${line}\n`);
    } catch {
      return;
    }
  };

  const publishLine = (line: string, target: LogLevel): void => {
    if (!options.onLine) return;
    try {
      void Promise.allSettled([options.onLine(line, { level: target })]);
    } catch {
      return;
    }
  };

  const write = (
    target: LogLevel,
    consoleWrite: (message: string) => void,
    message: string,
    details?: Record<string, unknown>,
  ): void => {
    if (!shouldLog(target)) return;
    const line = toLine(target, format(message, details));
    writeConsole(consoleWrite, line);
    writeFile(line);
    publishLine(line, target);
  };

  return {
    debug: (message, details): void => {
      write("debug", console.debug, message, details);
    },
    info: (message, details): void => {
      write("info", console.info, message, details);
    },
    warn: (message, details): void => {
      write("warn", console.warn, message, details);
    },
    error: (message, details): void => {
      write("error", console.error, message, details);
    },
  };
};

export const resolveLogLevel = (fallback: LogLevel): LogLevel => {
  const raw = process.env["LOCAL_STUDIO_LOG_LEVEL"]?.toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return fallback;
};
