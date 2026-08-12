import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { InstanceRecord, LaunchPlan } from "../src/modules/compute/contracts";
import { makeProcessLauncher } from "../src/modules/compute/launchers/process";

const root = mkdtempSync(join(tmpdir(), "process-launcher-test-"));
const logPath = join(root, "model.log");

afterAll(() => rmSync(root, { recursive: true, force: true }));

const record: InstanceRecord = {
  name: "model",
  nodeId: "self",
  engine: "vllm",
  recipeId: "recipe",
  runtime: "process",
  ref: null,
  port: 8000,
  devices: [],
  nonce: "nonce",
  startedAt: new Date(0).toISOString(),
  readyDeadlineAt: new Date(60_000).toISOString(),
};

const plan: LaunchPlan = {
  kind: "process",
  argv: [process.execPath, "-e", "process.stdout.write('fresh')"],
  env: {},
  ports: [],
  mounts: [],
  devices: [],
  health: { path: "/health", readyDeadlineMs: 60_000, intervalMs: 100 },
};

describe("process launcher logs", () => {
  test("a new launch cannot inherit a previous failure", async () => {
    writeFileSync(logPath, "stale failure\n");
    const launcher = makeProcessLauncher(() => logPath);
    const reference = await Effect.runPromise(launcher.start(plan, record));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (!(await Effect.runPromise(launcher.alive(reference)))) break;
      await Bun.sleep(10);
    }
    const tail = await Effect.runPromise(launcher.logTail(reference, record));
    expect(tail).toBe("fresh");
    expect(readFileSync(logPath, "utf8")).toBe("fresh");
  });

  test("owns and stops a real detached process tree", async () => {
    const launcher = makeProcessLauncher(() => logPath);
    const longRunning: LaunchPlan = {
      ...plan,
      argv: [process.execPath, "-e", "setInterval(() => {}, 1000)", "--", "--port", "8000"],
    };
    const reference = await Effect.runPromise(launcher.start(longRunning, record));
    expect(await Effect.runPromise(launcher.owns(reference, record))).toBe(true);
    await Effect.runPromise(launcher.stop(reference, 2_000));
    expect(await Effect.runPromise(launcher.alive(reference))).toBe(false);
  });
});
