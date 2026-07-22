import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  evaluateRequestBoundary,
  type RequestBoundaryInput,
} from "@/lib/security/request-boundary";

const base = (overrides: Partial<RequestBoundaryInput> = {}): RequestBoundaryInput => ({
  method: "POST",
  host: "127.0.0.1:4783",
  forwardedHost: null,
  forwardedProto: null,
  origin: "http://127.0.0.1:4783",
  fetchSite: "same-origin",
  csrfCookie: "token",
  csrfHeader: "token",
  tailscaleUser: null,
  requestProtocol: "http:",
  allowedTailscaleHosts: ["studio.tail.example.ts.net"],
  allowedTailscaleUsers: [],
  csrfToken: "token",
  ...overrides,
});

describe("request boundary", () => {
  test("allows a loopback same-origin mutation with CSRF proof", () => {
    assert.deepEqual(evaluateRequestBoundary(base()), { ok: true, remote: false });
  });

  test("allows an explicitly configured Tailscale Serve origin", () => {
    assert.deepEqual(
      evaluateRequestBoundary(
        base({
          host: "127.0.0.1:4783",
          forwardedHost: "studio.tail.example.ts.net",
          forwardedProto: "https",
          origin: "https://studio.tail.example.ts.net",
        }),
      ),
      { ok: true, remote: true },
    );
  });

  test("rejects unlisted hosts and forwarded hosts", () => {
    assert.equal(evaluateRequestBoundary(base({ host: "evil.example" })).ok, false);
    assert.equal(evaluateRequestBoundary(base({ forwardedHost: "evil.example" })).ok, false);
  });

  test("rejects cross-site, wrong-origin, and missing-token mutations", () => {
    assert.equal(evaluateRequestBoundary(base({ fetchSite: "cross-site" })).ok, false);
    assert.equal(evaluateRequestBoundary(base({ origin: "https://evil.example" })).ok, false);
    assert.equal(evaluateRequestBoundary(base({ csrfHeader: null })).ok, false);
  });

  test("enforces an optional Tailscale user allowlist", () => {
    const remote = {
      host: "studio.tail.example.ts.net",
      origin: "https://studio.tail.example.ts.net",
      requestProtocol: "https:",
      allowedTailscaleUsers: ["owner@example.com"],
    };
    assert.equal(
      evaluateRequestBoundary(base({ ...remote, tailscaleUser: "other@example.com" })).ok,
      false,
    );
    assert.deepEqual(
      evaluateRequestBoundary(base({ ...remote, tailscaleUser: "owner@example.com" })),
      { ok: true, remote: true },
    );
  });
});
