import { createWriteStream, mkdirSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { dirname } from "node:path";
import { Effect } from "effect";

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
  const stream = ((): WriteStream | null => {
    if (!options.filePath) return null;
    try {
      mkdirSync(dirname(options.filePath), { recursive: true });
      const output = createWriteStream(options.filePath, { flags: "a" });
      output.on("error", () => {});
      return output;
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
      return message;
    }
    return `${message} ${JSON.stringify(details)}`;
  };

  const toFileLine = (
    target: LogLevel,
    message: string,
    details?: Record<string, unknown>,
  ): string => {
    const ts = new Date().toISOString();
    const base = format(message, details);
    return `${ts} ${target.toUpperCase()} ${base}\n`;
  };

  const tryWrite = (target: LogLevel, message: string, details?: Record<string, unknown>): void => {
    const line = toFileLine(target, message, details);

    if (stream) {
      try {
        stream.write(line);
      } catch {}
    }

    if (options.onLine) {
      try {
        options.onLine(line.trimEnd(), { level: target });
      } catch {}
    }
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
      if (shouldLog("debug")) {
        console.debug(format(message, details));
        tryWrite("debug", message, details);
      }
    },
    info: (message, details): void => {
      if (shouldLog("info")) {
        console.info(format(message, details));
        tryWrite("info", message, details);
      }
    },
    warn: (message, details): void => {
      if (shouldLog("warn")) {
        console.warn(format(message, details));
        tryWrite("warn", message, details);
      }
    },
    error: (message, details): void => {
      if (shouldLog("error")) {
        console.error(format(message, details));
        tryWrite("error", message, details);
      }
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
