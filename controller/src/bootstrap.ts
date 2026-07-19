process.umask(0o077);

const originalEmitWarning: unknown = Reflect.get(process, "emitWarning");
const pendingWarnings: unknown[][] = [];
const pendingEmitWarning = (...values: unknown[]): void => {
  pendingWarnings.push(values);
};
const earlyFatal = (): never => {
  process.stderr.write("Controller fatal error: [redacted]\n");
  process.exit(1);
};
const handleEarlyException = (): void => earlyFatal();
const handleEarlyRejection = (): void => earlyFatal();

Reflect.set(process, "emitWarning", pendingEmitWarning);
process.on("uncaughtException", handleEarlyException);
process.on("unhandledRejection", handleEarlyRejection);

const releaseEarlyGuard = (): void => {
  process.off("uncaughtException", handleEarlyException);
  process.off("unhandledRejection", handleEarlyRejection);
  if (Reflect.get(process, "emitWarning") === pendingEmitWarning) {
    Reflect.set(process, "emitWarning", originalEmitWarning);
  }
};

try {
  const { installConsoleRedaction } = await import("./core/console-redaction");
  installConsoleRedaction(originalEmitWarning);
  releaseEarlyGuard();
  const emitWarning: unknown = Reflect.get(process, "emitWarning");
  if (typeof emitWarning === "function") {
    for (const warning of pendingWarnings) Reflect.apply(emitWarning, process, warning);
  }
} catch {
  releaseEarlyGuard();
  earlyFatal();
}

if (import.meta.main) {
  try {
    await import("./main");
  } catch (error) {
    console.error("Controller startup failed", error);
    process.exit(1);
  }
}

export {};
