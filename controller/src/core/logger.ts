import type { WriteStream } from "node:fs";
import { Effect } from "effect";
import { createPrivateLogStream } from "./log-files";
import { createLogPayloadRedactor, redactLogValue } from "./log-redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  filePath?: string;
  onLine?: (line: string, meta: { level: LogLevel }) => void;
}

export interface Logger {
  debug: (message: string, details?: Record<string, unknown>) => void;
  info: (message: string, details?: Record<string, unknown>) => void;
  warn: (message: string, details?: Record<string, unknown>) => void;
  error: (message: string, details?: Record<string, unknown>) => void;
  shutdown: () => Effect.Effect<void>;
}

export const createLogger = (level: LogLevel, options: LoggerOptions = {}): Logger => {
  const redactor = createLogPayloadRedactor();
  const stream = ((): WriteStream | null => {
    if (!options.filePath) return null;
    try {
      const opened = createPrivateLogStream(options.filePath);
      opened.on("error", () => {});
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
      options.onLine(line, { level: target });
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

  const shutdown = (): Effect.Effect<void> => {
    if (!stream || stream.closed || stream.destroyed) return Effect.void;
    return Effect.callback<void>((resume) => {
      let completed = false;
      const cleanup = (): void => {
        stream.removeListener("close", finish);
        stream.removeListener("error", finish);
      };
      const finish = (): void => {
        if (completed) return;
        completed = true;
        cleanup();
        resume(Effect.void);
      };
      stream.once("close", finish);
      stream.once("error", finish);
      stream.end();
      return Effect.sync(() => {
        cleanup();
        if (!stream.closed) stream.destroy();
      });
    }).pipe(
      Effect.timeoutOrElse({
        duration: 2_000,
        orElse: () => Effect.sync(() => stream.destroy()),
      }),
    );
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
    shutdown,
  };
};

export const resolveLogLevel = (fallback: LogLevel): LogLevel => {
  const raw = process.env["LOCAL_STUDIO_LOG_LEVEL"]?.toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return fallback;
};
