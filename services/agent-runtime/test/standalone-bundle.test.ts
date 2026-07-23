import { afterAll, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const runtimeDir = path.resolve(import.meta.dir, "..");
const repoDir = path.resolve(runtimeDir, "..", "..");
const output = path.join(runtimeDir, "dist", "standalone.mjs");
const original = existsSync(output) ? readFileSync(output) : null;

afterAll(() => {
  if (original === null) rmSync(output, { force: true });
  else Bun.write(output, original);
});

test("standalone bundle contains no build-machine path", async () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "run", "bundle"],
    cwd: runtimeDir,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}` },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
  expect(readFileSync(output, "utf8")).not.toContain(repoDir);
});
