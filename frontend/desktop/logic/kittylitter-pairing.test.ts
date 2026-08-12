import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getKittylitterPairingJson, normalizeKittylitterPairingJson } from "./kittylitter-pairing";

const PAYLOAD = JSON.stringify({ v: 1, node_id: "node-1", token: "token-1", host_name: "mac" });
const temporaryDirectories: string[] = [];

afterEach(() => {
  delete process.env.KITTYLITTER_BIN;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const fakePairing = (
  failures: number,
): { execute: () => Promise<string>; attempts: () => number } => {
  let attempts = 0;
  return {
    execute: async () => {
      attempts += 1;
      if (attempts <= failures) throw Object.assign(new Error("unavailable"), { code: 1 });
      return PAYLOAD;
    },
    attempts: () => attempts,
  };
};

describe.serial("kittylitter pairing retry", () => {
  test("invokes a configured executable on POSIX platforms", async () => {
    if (process.platform === "win32") return;
    const directory = mkdtempSync(path.join(tmpdir(), "kittylitter-fake-"));
    temporaryDirectories.push(directory);
    const binary = path.join(directory, "kittylitter");
    writeFileSync(binary, `#!/bin/sh\nprintf %s '${PAYLOAD}'\n`);
    chmodSync(binary, 0o755);
    process.env.KITTYLITTER_BIN = binary;
    const result = await getKittylitterPairingJson({ retries: 0 });
    expect(result.ok).toBe(true);
  });

  test("recovers when the binary fails before the daemon is ready", async () => {
    const fake = fakePairing(2);
    const result = await getKittylitterPairingJson({
      retries: 2,
      retryDelayMs: 10,
      execute: fake.execute,
    });
    expect(result.ok).toBe(true);
    expect(result.pairingJson).toBe(normalizeKittylitterPairingJson(PAYLOAD));
    expect(fake.attempts()).toBe(3);
  });

  test("reports the exit code after exhausting retries", async () => {
    const fake = fakePairing(99);
    const result = await getKittylitterPairingJson({
      retries: 2,
      retryDelayMs: 10,
      execute: fake.execute,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("(1)");
    expect(fake.attempts()).toBe(3);
  });

  test("succeeds immediately when the daemon is warm", async () => {
    const fake = fakePairing(0);
    const result = await getKittylitterPairingJson({
      retries: 2,
      retryDelayMs: 10,
      execute: fake.execute,
    });
    expect(result.ok).toBe(true);
    expect(fake.attempts()).toBe(1);
  });
});
