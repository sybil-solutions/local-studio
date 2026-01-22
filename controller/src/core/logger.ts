/**
 * Logging levels.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Logger contract.
 */
export interface Logger {
  debug: (message: string, details?: Record<string, unknown>) => void;
  info: (message: string, details?: Record<string, unknown>) => void;
  warn: (message: string, details?: Record<string, unknown>) => void;
  error: (message: string, details?: Record<string, unknown>) => void;
}

/**
 * Create a logger with a minimum level.
 * @param level - Minimum log level.
 * @returns Logger instance.
 */
export const createLogger = (level: LogLevel): Logger => {
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

  return {
    debug: (message, details): void => {
      if (shouldLog("debug")) {
        console.debug(format(message, details));
      }
    },
    info: (message, details): void => {
      if (shouldLog("info")) {
        console.info(format(message, details));
      }
    },
    warn: (message, details): void => {
      if (shouldLog("warn")) {
        console.warn(format(message, details));
      }
    },
    error: (message, details): void => {
      if (shouldLog("error")) {
        console.error(format(message, details));
      }
    },
  };
};

/**
 * Resolve the log level from environment variables.
 * @param fallback - Default log level.
 * @returns Resolved log level.
 */
export const resolveLogLevel = (fallback: LogLevel): LogLevel => {
  const raw = process.env["VLLM_STUDIO_LOG_LEVEL"]?.toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return fallback;
};
