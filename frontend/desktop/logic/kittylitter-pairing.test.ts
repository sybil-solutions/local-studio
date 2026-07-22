import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getKittylitterPairingJson, normalizeKittylitterPairingJson } from "./kittylitter-pairing";

const PAYLOAD = JSON.stringify({ v: 1, node_id: "node-1", token: "token-1", host_name: "mac" });

const dirs: string[] = [];

const fakeBinary = (failures: number): { bin: string; counter: string } => {
  const dir = mkdtempSync(path.join(tmpdir(), "kittylitter-fake-"));
  dirs.push(dir);
  const counter = path.join(dir, "count");
  writeFileSync(counter, "0");
  const bin = path.join(dir, "kittylitter");
  writeFileSync(
    bin,
    `#!/bin/sh\nn=$(cat "${counter}")\nn=$((n+1))\nprintf %s "$n" > "${counter}"\nif [ "$n" -le ${failures} ]; then exit 1; fi\nprintf %s '${PAYLOAD}'\n`,
  );
  chmodSync(bin, 0o755);
  return { bin, counter };
};

afterEach(() => {
  delete process.env.KITTYLITTER_BIN;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.serial("kittylitter pairing retry", () => {
  test("recovers when the binary fails before the daemon is ready", async () => {
    const { bin, counter } = fakeBinary(2);
    process.env.KITTYLITTER_BIN = bin;
    const result = await getKittylitterPairingJson({ retries: 2, retryDelayMs: 10 });
    expect(result.ok).toBe(true);
    expect(result.pairingJson).toBe(normalizeKittylitterPairingJson(PAYLOAD));
    expect(readFileSync(counter, "utf8")).toBe("3");
  });

  test("reports the exit code after exhausting retries", async () => {
    const { bin, counter } = fakeBinary(99);
    process.env.KITTYLITTER_BIN = bin;
    const result = await getKittylitterPairingJson({ retries: 2, retryDelayMs: 10 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("(1)");
    expect(readFileSync(counter, "utf8")).toBe("3");
  });

  test("succeeds immediately when the daemon is warm", async () => {
    const { bin, counter } = fakeBinary(0);
    process.env.KITTYLITTER_BIN = bin;
    const result = await getKittylitterPairingJson({ retries: 2, retryDelayMs: 10 });
    expect(result.ok).toBe(true);
    expect(readFileSync(counter, "utf8")).toBe("1");
  });
});
