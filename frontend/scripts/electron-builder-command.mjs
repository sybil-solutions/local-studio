import { spawn } from "node:child_process";
import { Effect } from "effect";

const COMMAND_TIMEOUT_MS = 30_000;
const COMMAND_OUTPUT_BYTES = 64 * 1024;

function commandEnvironment() {
  return Object.fromEntries(
    ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "SystemRoot", "TEMP", "TMP", "TMPDIR", "WINDIR"].flatMap(
      (key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]]),
    ),
  );
}

function desktopCommandEffect(command, args, outputLimit) {
  return Effect.callback((resume) => {
    const child = spawn(command, args, {
      env: commandEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let outputBytes = 0;
    let settled = false;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      resume(Effect.succeed(success));
    };
    const output = (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= outputLimit) return;
      child.kill();
      finish(false);
    };
    child.stdout?.on("data", output);
    child.stderr?.on("data", output);
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      child.kill();
    });
  });
}

export function desktopCommandSucceeds(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const outputLimit = options.outputBytes ?? COMMAND_OUTPUT_BYTES;
  return Effect.runPromise(
    desktopCommandEffect(command, args, outputLimit).pipe(
      Effect.timeout(timeoutMs),
      Effect.catch(() => Effect.succeed(false)),
    ),
  );
}
