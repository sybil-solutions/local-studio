import { resolve } from "node:path";
import { installConsoleRedaction } from "./core/console-redaction";
import { createPrivateLogStream, primaryLogPathFor } from "./core/log-files";
import { redactLogPayload } from "./core/log-redaction";

const defaultDataDirectory = resolve(import.meta.dir, "..", "..", "data");

const failureMessage = (error: unknown): string => {
  const diagnostic = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return redactLogPayload(`Controller startup failed: ${diagnostic}`);
};

const diagnosticDirectories = (): string[] => [
  ...new Set(
    [process.env["LOCAL_STUDIO_DATA_DIR"], defaultDataDirectory]
      .filter((path): path is string => Boolean(path))
      .map((path) => resolve(path)),
  ),
];

const persistFailure = async (message: string): Promise<void> => {
  for (const directory of diagnosticDirectories()) {
    try {
      const stream = createPrivateLogStream(primaryLogPathFor(directory, "controller"));
      await new Promise<void>((resolveWrite, rejectWrite) => {
        stream.once("error", rejectWrite);
        stream.end(`${message}\n`, resolveWrite);
      });
      return;
    } catch {
      continue;
    }
  }
};

const replayWarnings = (warnings: readonly unknown[][]): void => {
  const emitWarning: unknown = Reflect.get(process, "emitWarning");
  if (typeof emitWarning !== "function") return;
  for (const warning of warnings) Reflect.apply(emitWarning, process, warning);
};

export const startControllerBootstrap = async (
  releaseEarlyGuard: () => unknown[][],
): Promise<void> => {
  const warnings = releaseEarlyGuard();
  installConsoleRedaction();
  replayWarnings(warnings);

  try {
    const { startController } = await import("./controller-lifecycle");
    await startController();
  } catch (error) {
    const message = failureMessage(error);
    await persistFailure(message);
    console.error(message);
    process.exit(1);
  }
};
