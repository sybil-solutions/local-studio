import { format } from "node:util";
import { redactLogPayload, redactLogValue } from "./log-redaction";
import {
  createRedactedRecordMultiplexer,
  redactedRecordPayload,
  type RedactedRecordMultiplexer,
} from "./redacted-record-multiplexer";

type ConsoleOutput = "stdout" | "stderr";

const CONSOLE_METHODS = [
  "assert",
  "clear",
  "count",
  "countReset",
  "debug",
  "dir",
  "dirxml",
  "error",
  "group",
  "groupCollapsed",
  "groupEnd",
  "info",
  "log",
  "profile",
  "profileEnd",
  "table",
  "time",
  "timeEnd",
  "timeLog",
  "timeStamp",
  "trace",
  "warn",
] as const;

interface InstalledMethod {
  name: (typeof CONSOLE_METHODS)[number];
  original: CallableFunction;
  installed: (...values: unknown[]) => unknown;
}

interface InstalledStreams {
  flush: () => void;
  restore: () => void;
}

const FORMATTED_CONSOLE_METHODS = new Set<InstalledMethod["name"]>([
  "debug",
  "error",
  "group",
  "groupCollapsed",
  "info",
  "log",
  "trace",
  "warn",
]);

const STDERR_CONSOLE_METHODS = new Set<InstalledMethod["name"]>([
  "assert",
  "error",
  "trace",
  "warn",
]);

const consoleOutput = (name: InstalledMethod["name"]): ConsoleOutput =>
  STDERR_CONSOLE_METHODS.has(name) ? "stderr" : "stdout";

const redactedConsoleArguments = (
  name: InstalledMethod["name"],
  values: readonly unknown[],
  multiplexer: RedactedRecordMultiplexer<ConsoleOutput>,
): unknown[] => {
  const redactRecord = (value: string): string =>
    redactedRecordPayload(multiplexer.writeRecord(consoleOutput(name), value));
  if (name === "assert") {
    const [condition, ...details] = values;
    if (condition || details.length === 0) return [condition];
    return [condition, redactRecord(format(...details))];
  }
  if (FORMATTED_CONSOLE_METHODS.has(name)) {
    return [redactRecord(format(...values))];
  }
  const redacted = redactLogValue(values);
  return Array.isArray(redacted)
    ? redacted.map((value) => (typeof value === "string" ? redactRecord(value) : value))
    : [];
};

const installMethodRedaction = (
  multiplexer: RedactedRecordMultiplexer<ConsoleOutput>,
  invoke: (operation: () => unknown) => unknown,
): InstalledMethod[] => {
  const installedMethods: InstalledMethod[] = [];
  for (const name of CONSOLE_METHODS) {
    const original: unknown = Reflect.get(console, name);
    if (typeof original !== "function") continue;
    const installed = (...values: unknown[]): unknown =>
      invoke(() =>
        Reflect.apply(original, console, redactedConsoleArguments(name, values, multiplexer)),
      );
    Reflect.set(console, name, installed);
    installedMethods.push({ name, original, installed });
  }
  return installedMethods;
};

const sanitizedWarning = (value: unknown): unknown => {
  if (!(value instanceof Error)) return redactLogValue(value);
  const error = new Error(redactLogPayload(value.message));
  error.name = redactLogPayload(value.name);
  if (value.stack) error.stack = redactLogPayload(value.stack);
  return error;
};

const fatalMessage = (reason: unknown): string => {
  const diagnostic = reason instanceof Error ? (reason.stack ?? reason.message) : format(reason);
  return redactLogPayload(`Controller fatal error: ${diagnostic}`);
};

const installProcessRedaction = (): (() => void) => {
  const originalEmitWarning: unknown = Reflect.get(process, "emitWarning");
  const installedEmitWarning = (...values: unknown[]): unknown =>
    typeof originalEmitWarning === "function"
      ? Reflect.apply(originalEmitWarning, process, values.map(sanitizedWarning))
      : undefined;
  let reportingFatal = false;
  const reportFatal = (reason: unknown): void => {
    if (reportingFatal) return;
    reportingFatal = true;
    try {
      console.error(fatalMessage(reason));
    } finally {
      process.exit(1);
    }
  };
  const handleException = (error: unknown): void => reportFatal(error);
  const handleRejection = (reason: unknown): void => reportFatal(reason);

  Reflect.set(process, "emitWarning", installedEmitWarning);
  process.on("uncaughtException", handleException);
  process.on("unhandledRejection", handleRejection);

  return () => {
    process.off("uncaughtException", handleException);
    process.off("unhandledRejection", handleRejection);
    if (Reflect.get(process, "emitWarning") === installedEmitWarning) {
      Reflect.set(process, "emitWarning", originalEmitWarning);
    }
  };
};

const installStreamRedaction = (
  multiplexer: RedactedRecordMultiplexer<ConsoleOutput>,
  bypassed: () => boolean,
): InstalledStreams => {
  const streams: readonly { label: ConsoleOutput; stream: NodeJS.WriteStream }[] = [
    { label: "stdout", stream: process.stdout },
    { label: "stderr", stream: process.stderr },
  ];
  const installed = streams.flatMap(({ label, stream }) => {
    const original: unknown = Reflect.get(stream, "write");
    if (typeof original !== "function") return [];
    const replacement = (chunk: unknown, ...rest: unknown[]): boolean => {
      const output = bypassed() ? chunk : redactedRecordPayload(multiplexer.write(label, chunk));
      return Boolean(Reflect.apply(original, stream, [output, ...rest]));
    };
    Reflect.set(stream, "write", replacement);
    return [{ label, stream, original, replacement }];
  });
  const flush = (): void => {
    const pending = multiplexer.flush();
    for (const { label, stream, original } of installed) {
      const records = pending.filter((record) => record.label === label);
      if (records.length > 0) Reflect.apply(original, stream, [redactedRecordPayload(records)]);
    }
  };
  const restore = (): void => {
    flush();
    for (const { stream, original, replacement } of installed) {
      if (Reflect.get(stream, "write") === replacement) Reflect.set(stream, "write", original);
    }
  };
  return { flush, restore };
};

export const installConsoleRedaction = (): (() => void) => {
  const restoreProcess = installProcessRedaction();
  const multiplexer = createRedactedRecordMultiplexer<ConsoleOutput>();
  let bypassDepth = 0;
  const invoke = (operation: () => unknown): unknown => {
    bypassDepth += 1;
    try {
      return operation();
    } finally {
      bypassDepth -= 1;
    }
  };
  const installedStreams = installStreamRedaction(multiplexer, () => bypassDepth > 0);
  const installedMethods = installMethodRedaction(multiplexer, invoke);
  const flushStreams = (): void => installedStreams.flush();
  process.on("exit", flushStreams);

  return () => {
    process.off("exit", flushStreams);
    for (const { name, original, installed } of installedMethods) {
      if (Reflect.get(console, name) === installed) Reflect.set(console, name, original);
    }
    installedStreams.restore();
    restoreProcess();
  };
};
