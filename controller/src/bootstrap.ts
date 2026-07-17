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
let released = false;

Reflect.set(process, "emitWarning", pendingEmitWarning);
process.on("uncaughtException", handleEarlyException);
process.on("unhandledRejection", handleEarlyRejection);

const releaseEarlyGuard = (): unknown[][] => {
  if (released) return [];
  released = true;
  process.off("uncaughtException", handleEarlyException);
  process.off("unhandledRejection", handleEarlyRejection);
  if (Reflect.get(process, "emitWarning") === pendingEmitWarning) {
    Reflect.set(process, "emitWarning", originalEmitWarning);
  }
  return pendingWarnings.splice(0);
};

try {
  const { startControllerBootstrap } = await import("./runtime-bootstrap");
  await startControllerBootstrap(releaseEarlyGuard);
} catch {
  releaseEarlyGuard();
  earlyFatal();
}

export {};
