import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createLitterMutationLedger,
  type MutationCorrelation,
} from "../src/litter-bridge-mutation-ledger";

const NOW = new Date("2026-07-20T18:30:00.000Z");
const BODY_HASH = "a".repeat(64);
const identity = {
  controllerId: "controller-1",
  deviceId: "device-1",
  idempotencyKey: "turn-1",
};

const directory = () => mkdtempSync(path.join(tmpdir(), "local-studio-litter-ledger-"));

const correlation = (dispatchId = "dispatch-1"): MutationCorrelation => ({
  dispatchId,
  sessionId: "session-1",
  sessionFile: "/tmp/session-1.jsonl",
  messageId: "message-1",
  contentHash: "b".repeat(64),
  baseRevision: 7,
  baseOffset: 128,
  modelId: "provider/model-1",
  dispatchedAt: NOW.toISOString(),
});

test("mutation ledger persists principal-bound accepted results and exact status", () => {
  const dataDir = directory();
  const first = createLitterMutationLedger(dataDir, () => new Date(NOW));
  const reservation = first.reserve(identity, BODY_HASH, "owner-1");
  assert.equal(reservation.kind, "reserved");
  if (reservation.kind !== "reserved") return;
  first.markDispatching(identity, BODY_HASH, reservation.lease, correlation());
  const result = { type: "agent_turn_ack", dispatchId: "dispatch-1" };
  first.settleDispatched(identity, BODY_HASH, "dispatch-1", "accepted", {
    status: 202,
    result,
  });
  first.close();

  const restarted = createLitterMutationLedger(dataDir, () => new Date(NOW));
  assert.deepEqual(restarted.reserve(identity, BODY_HASH, "owner-2"), {
    kind: "cached",
    stored: { status: 202, result },
  });
  const otherPrincipal = restarted.reserve(
    { ...identity, deviceId: "device-2" },
    BODY_HASH,
    "owner-2",
  );
  assert.equal(otherPrincipal.kind, "reserved");
  assert.equal(statSync(restarted.filepath).mode & 0o777, 0o600);
  restarted.close();
});

test("mutation ledger rejects key reuse with another body", () => {
  const ledger = createLitterMutationLedger(directory(), () => new Date(NOW));
  const reservation = ledger.reserve(identity, BODY_HASH, "owner-1");
  assert.equal(reservation.kind, "reserved");
  assert.deepEqual(ledger.reserve(identity, "b".repeat(64), "owner-2"), { kind: "mismatch" });
  ledger.close();
});

test("mutation ledger preserves crash correlation for transcript reconciliation", () => {
  const dataDir = directory();
  const first = createLitterMutationLedger(dataDir, () => new Date(NOW));
  const reservation = first.reserve(identity, BODY_HASH, "owner-1");
  assert.equal(reservation.kind, "reserved");
  if (reservation.kind !== "reserved") return;
  first.markDispatching(identity, BODY_HASH, reservation.lease, correlation());
  first.markIndeterminate(identity, BODY_HASH, "dispatch-1");
  first.close();

  const restarted = createLitterMutationLedger(dataDir, () => new Date(NOW));
  assert.deepEqual(restarted.reserve(identity, BODY_HASH, "owner-2"), {
    kind: "reconcile",
    correlation: correlation(),
  });
  restarted.close();
});

test("mutation ledger makes transient rejection retryable under the same key", () => {
  const ledger = createLitterMutationLedger(directory(), () => new Date(NOW));
  const first = ledger.reserve(identity, BODY_HASH, "owner-1");
  assert.equal(first.kind, "reserved");
  if (first.kind !== "reserved") return;
  ledger.releaseRetryable(identity, BODY_HASH, first.lease);
  const retry = ledger.reserve(identity, BODY_HASH, "owner-2");
  assert.equal(retry.kind, "reserved");
  assert.notEqual(retry.kind === "reserved" ? retry.lease.token : null, first.lease.token);
  ledger.close();
});

test("mutation ledger expires boot leases without permitting a stale dispatch", () => {
  let observedAt = NOW.getTime();
  const ledger = createLitterMutationLedger(directory(), () => new Date(observedAt), {
    leaseMs: 1_000,
  });
  const first = ledger.reserve(identity, BODY_HASH, "owner-1");
  assert.equal(first.kind, "reserved");
  assert.equal(ledger.reserve(identity, BODY_HASH, "owner-2").kind, "busy");
  observedAt += 1_001;
  const takeover = ledger.reserve(identity, BODY_HASH, "owner-2");
  assert.equal(takeover.kind, "reserved");
  if (first.kind === "reserved") {
    assert.throws(
      () => ledger.markDispatching(identity, BODY_HASH, first.lease, correlation("stale")),
      /lease was lost/i,
    );
  }
  ledger.close();
});

test("mutation ledger prunes terminal rows only after the idempotency horizon", () => {
  let observedAt = NOW.getTime();
  const ledger = createLitterMutationLedger(directory(), () => new Date(observedAt), {
    retentionMs: 60_000,
  });
  const first = ledger.reserve(identity, BODY_HASH, "owner-1");
  assert.equal(first.kind, "reserved");
  if (first.kind !== "reserved") return;
  ledger.settleReservedRejected(identity, BODY_HASH, first.lease, {
    status: 418,
    result: { type: "error", code: "stable" },
  });
  observedAt += 59_999;
  assert.equal(ledger.reserve(identity, BODY_HASH, "owner-2").kind, "cached");
  observedAt += 2;
  const expired = ledger.reserve(identity, "c".repeat(64), "owner-2");
  assert.equal(expired.kind, "reserved");
  ledger.close();
});

test("mutation ledger serializes two-process cold start", async () => {
  const dataDir = directory();
  const moduleUrl = pathToFileURL(
    path.resolve(import.meta.dirname, "../src/litter-bridge-mutation-ledger.ts"),
  ).href;
  const source = `
    import { createLitterMutationLedger } from ${JSON.stringify(moduleUrl)};
    const ledger = createLitterMutationLedger(${JSON.stringify(dataDir)}, () => new Date(${JSON.stringify(NOW.toISOString())}));
    const result = ledger.reserve(${JSON.stringify(identity)}, ${JSON.stringify(BODY_HASH)}, process.env.LEDGER_TEST_OWNER ?? "owner");
    process.stdout.write(result.kind);
    const { promise, resolve } = Promise.withResolvers();
    process.stdin.resume();
    process.stdin.once("end", resolve);
    await promise;
    ledger.close();
  `;
  const childArgs = process.versions.bun
    ? ["-e", source]
    : ["--experimental-strip-types", "--input-type=module", "-e", source];
  const spawnChild = (owner: string) => {
    const child = spawn(process.execPath, childArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, LEDGER_TEST_OWNER: owner },
    });
    const result = Promise.withResolvers<string>();
    const exit = Promise.withResolvers<void>();
    let stderr = "";
    child.stdout.once("data", (chunk) => result.resolve(String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", (error) => {
      result.reject(error);
      exit.reject(error);
    });
    child.once("exit", (code) => {
      if (code === 0) {
        exit.resolve();
        return;
      }
      const failure = new Error(stderr || `child exited ${code}`);
      result.reject(failure);
      exit.reject(failure);
    });
    return { child, result: result.promise, exit: exit.promise };
  };
  const first = spawnChild("owner-a");
  const second = spawnChild("owner-b");
  const results = await Promise.all([first.result, second.result]);
  first.child.stdin.end();
  second.child.stdin.end();
  await Promise.all([first.exit, second.exit]);
  assert.deepEqual(results.sort(), ["busy", "reserved"]);
});

test("mutation ledger fails closed on corruption and unsafe permissions", () => {
  const dataDir = directory();
  const ledger = createLitterMutationLedger(dataDir, () => new Date(NOW));
  const filepath = ledger.filepath;
  ledger.close();
  writeFileSync(filepath, "{}\n", { mode: 0o600 });
  assert.throws(() => createLitterMutationLedger(dataDir, () => new Date(NOW)));

  const permissionDir = directory();
  const permissionLedger = createLitterMutationLedger(permissionDir, () => new Date(NOW));
  const permissionFile = permissionLedger.filepath;
  permissionLedger.close();
  chmodSync(permissionFile, 0o644);
  assert.throws(
    () => createLitterMutationLedger(permissionDir, () => new Date(NOW)),
    /permissions are unsafe/i,
  );
});

test("mutation ledger releases a poisoned dispatch after the reconciliation window", () => {
  let observedAt = NOW.getTime();
  const ledger = createLitterMutationLedger(directory(), () => new Date(observedAt), {
    reconcileWindowMs: 1_000,
  });
  const first = ledger.reserve(identity, BODY_HASH, "owner-1");
  assert.equal(first.kind, "reserved");
  if (first.kind !== "reserved") return;
  ledger.markDispatching(identity, BODY_HASH, first.lease, correlation());
  assert.equal(ledger.reserve(identity, BODY_HASH, "owner-2").kind, "reconcile");
  observedAt += 1_001;
  const recovered = ledger.reserve(identity, BODY_HASH, "owner-2");
  assert.equal(recovered.kind, "reserved");
  assert.notEqual(recovered.kind === "reserved" ? recovered.lease.token : null, first.lease.token);
  ledger.close();
});
