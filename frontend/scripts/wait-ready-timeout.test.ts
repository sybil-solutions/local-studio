import assert from "node:assert/strict";
import test from "node:test";

import type { ApiCore, RequestOptions } from "../src/lib/api/core";
import { createSystemApi } from "../src/lib/api/system";

function fakeCore() {
  const calls: Array<{ endpoint: string; options: RequestOptions | undefined }> = [];
  const core = {
    request: async <T>(endpoint: string, options?: RequestOptions): Promise<T> => {
      calls.push({ endpoint, options });
      return { ready: true, elapsed: 1 } as unknown as T;
    },
  } as unknown as ApiCore;
  return { core, calls };
}

test("waitReady issues its request with a client timeout that outlives the controller long-poll", async () => {
  const { core, calls } = fakeCore();
  const system = createSystemApi(core);

  await system.waitReady(300);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.endpoint, "/wait-ready?timeout=300");
  // The controller holds the request open for up to `timeout` seconds; the
  // client fetch timeout must exceed that or a real model load (>30s default
  // client timeout) reports a spurious launch error on wizard step 4.
  assert.equal(calls[0]!.options?.timeout, 315_000);
  assert.equal(calls[0]!.options?.retries, 0);
});

test("waitReady default also carries the long client timeout", async () => {
  const { core, calls } = fakeCore();
  const system = createSystemApi(core);

  await system.waitReady();

  assert.equal(calls[0]!.endpoint, "/wait-ready?timeout=300");
  assert.equal(calls[0]!.options?.timeout, 315_000);
  assert.equal(calls[0]!.options?.retries, 0);
});

test("launch percent-encodes the recipe id path segment", async () => {
  const { core, calls } = fakeCore();
  const system = createSystemApi(core);

  await system.launch("weird id#1");

  assert.equal(calls[0]!.endpoint, "/launch/weird%20id%231");
});
