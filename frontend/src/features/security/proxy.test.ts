import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NextRequest } from "next/server";
import { FRONTEND_CALLBACK_TOKEN_HEADER } from "@shared/agent/frontend-callback-auth";
import { proxy } from "@/proxy";

function request(pathname: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://127.0.0.1:4783${pathname}`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:4783",
      origin: "http://127.0.0.1:4783",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
  });
}

describe("proxy CSRF entry paths", () => {
  test("allows the access form and authenticated callback path without a CSRF header", () => {
    const access = proxy(request("/api/auth/session"));
    assert.equal(access.status, 200);
    assert.equal(access.headers.get("x-middleware-next"), "1");

    const callback = proxy(
      request("/api/agent/plan", {
        [FRONTEND_CALLBACK_TOKEN_HEADER]: "runtime-credential",
      }),
    );
    assert.equal(callback.status, 200);
    assert.equal(callback.headers.get("x-middleware-next"), "1");
  });

  test("keeps the exemption unavailable to cross-site and uncredentialed requests", async () => {
    const crossSite = proxy(
      request("/api/auth/session", {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      }),
    );
    assert.equal(crossSite.status, 403);
    assert.deepEqual(await crossSite.json(), { error: "Cross-site mutation rejected" });

    const callback = proxy(request("/api/agent/plan"));
    assert.equal(callback.status, 403);
    assert.deepEqual(await callback.json(), { error: "CSRF validation failed" });
  });
});
