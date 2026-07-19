import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getUpstreamTimeoutMs } from "./proxy-timeouts";

describe("controller proxy timeouts", () => {
  test("allows model lifecycle requests to outlive cold starts", () => {
    assert.equal(getUpstreamTimeoutMs(["launch", "recipe-1"], "POST"), 360_000);
    assert.equal(getUpstreamTimeoutMs(["wait-ready"], "POST"), 360_000);
  });

  test("keeps ordinary requests bounded", () => {
    assert.equal(getUpstreamTimeoutMs(["status"]), 5_000);
  });
});
