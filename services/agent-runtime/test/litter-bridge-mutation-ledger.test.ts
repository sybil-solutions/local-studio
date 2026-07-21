import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createLitterMutationLedger } from "../src/litter-bridge-mutation-ledger";

const NOW = new Date("2026-07-20T18:30:00.000Z");
const BODY_HASH = "a".repeat(64);
const identity = {
  controllerId: "controller-1",
  deviceId: "device-1",
  idempotencyKey: "turn-1",
};

const directory = () => mkdtempSync(path.join(tmpdir(), "local-studio-litter-ledger-"));

test("mutation ledger persists principal-bound accepted results", async () => {
  const dataDir = directory();
  const first = createLitterMutationLedger(dataDir, () => new Date(NOW));
  const result = { type: "agent_turn_ack", dispatchId: "dispatch-1" };
  await first.withMutation(identity, async (transaction) => {
    assert.deepEqual(transaction.reserve(BODY_HASH), { kind: "reserved" });
    transaction.markDispatching(BODY_HASH);
    transaction.settle(BODY_HASH, "accepted", result);
  });

  const restarted = createLitterMutationLedger(dataDir, () => new Date(NOW));
  await restarted.withMutation(identity, async (transaction) => {
    assert.deepEqual(transaction.reserve(BODY_HASH), { kind: "cached", result });
  });
  await restarted.withMutation({ ...identity, deviceId: "device-2" }, async (transaction) => {
    assert.deepEqual(transaction.reserve(BODY_HASH), { kind: "reserved" });
    transaction.settle(BODY_HASH, "rejected", { type: "error" });
  });
  assert.equal(statSync(first.filepath).mode & 0o777, 0o600);
});

test("mutation ledger rejects key reuse with another body", async () => {
  const ledger = createLitterMutationLedger(directory(), () => new Date(NOW));
  await ledger.withMutation(identity, async (transaction) => {
    transaction.reserve(BODY_HASH);
    transaction.settle(BODY_HASH, "accepted", { ok: true });
  });
  await ledger.withMutation(identity, async (transaction) => {
    assert.deepEqual(transaction.reserve("b".repeat(64)), { kind: "mismatch" });
  });
});

test("mutation ledger converts crash-ambiguous dispatches to indeterminate", async () => {
  const dataDir = directory();
  const first = createLitterMutationLedger(dataDir, () => new Date(NOW));
  await assert.rejects(
    first.withMutation(identity, async (transaction) => {
      transaction.reserve(BODY_HASH);
      transaction.markDispatching(BODY_HASH);
      throw new Error("simulated crash boundary");
    }),
  );

  const restarted = createLitterMutationLedger(dataDir, () => new Date(NOW));
  await restarted.withMutation(identity, async (transaction) => {
    assert.deepEqual(transaction.reserve(BODY_HASH), { kind: "indeterminate" });
  });
});

test("mutation ledger serializes concurrent retries", async () => {
  const ledger = createLitterMutationLedger(directory(), () => new Date(NOW));
  let dispatches = 0;
  const run = () =>
    ledger.withMutation(identity, async (transaction) => {
      const reservation = transaction.reserve(BODY_HASH);
      if (reservation.kind === "cached") return reservation.result;
      assert.equal(reservation.kind, "reserved");
      dispatches += 1;
      transaction.markDispatching(BODY_HASH);
      const result = { dispatchId: "dispatch-1" };
      transaction.settle(BODY_HASH, "accepted", result);
      return result;
    });
  const [first, second] = await Promise.all([run(), run()]);
  assert.deepEqual(first, second);
  assert.equal(dispatches, 1);
});
