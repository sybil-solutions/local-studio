export type RuntimeShutdown = () => Promise<void>;

type RuntimeSignalProcess = {
  exit: (code?: number) => unknown;
  once: (event: "SIGINT" | "SIGTERM", listener: () => void) => unknown;
};

type RuntimeSignalShutdownOptions = {
  dispose: () => void;
  process: RuntimeSignalProcess;
  reportError: (error: unknown) => void;
  stop: () => Promise<void>;
};

export function createRuntimeShutdown(
  stop: () => Promise<void>,
  dispose: () => void,
): RuntimeShutdown {
  let stopping: Promise<void> | null = null;
  return () => {
    stopping ??= Promise.resolve().then(stop).finally(dispose);
    return stopping;
  };
}

export function installRuntimeSignalShutdown({
  dispose,
  process: runtimeProcess,
  reportError,
  stop,
}: RuntimeSignalShutdownOptions): RuntimeShutdown {
  const shutdown = createRuntimeShutdown(stop, dispose);
  let signaled = false;
  const onSignal = () => {
    if (signaled) return;
    signaled = true;
    void shutdown().then(
      () => runtimeProcess.exit(0),
      (error) => {
        reportError(error);
        runtimeProcess.exit(1);
      },
    );
  };
  runtimeProcess.once("SIGINT", onSignal);
  runtimeProcess.once("SIGTERM", onSignal);
  return shutdown;
}
