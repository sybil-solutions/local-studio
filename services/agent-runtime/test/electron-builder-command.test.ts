import { describe, expect, test } from "bun:test";
import { desktopCommandSucceeds } from "../../../frontend/scripts/electron-builder-command.mjs";

describe("desktop package command boundary", () => {
  test("accepts a successful bounded command", async () => {
    await expect(desktopCommandSucceeds(process.execPath, ["-e", "process.exit(0)"])).resolves.toBe(
      true,
    );
  });

  test("interrupts a command at the Effect timeout", async () => {
    await expect(
      desktopCommandSucceeds(
        process.execPath,
        ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)"],
        { timeoutMs: 25 },
      ),
    ).resolves.toBe(false);
  });

  test("kills a command that exceeds its output cap", async () => {
    await expect(
      desktopCommandSucceeds(process.execPath, ["-e", "process.stdout.write('x'.repeat(1024))"], {
        outputBytes: 16,
      }),
    ).resolves.toBe(false);
  });
});
