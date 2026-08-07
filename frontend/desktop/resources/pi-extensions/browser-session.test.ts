import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BROWSER_SESSION_HEADER } from "../../../../shared/agent/browser-session";
import { browserExtensionConfig, callBrowserAction, type BrowserExtensionConfig } from "./browser";

describe("Pi browser session transport", () => {
  test("requires a configured session and canonical header", () => {
    assert.throws(() => browserExtensionConfig({}));
    assert.deepEqual(
      browserExtensionConfig({
        LOCAL_STUDIO_BROWSER_SESSION_HEADER: BROWSER_SESSION_HEADER,
        LOCAL_STUDIO_BROWSER_SESSION_ID: "session-a",
      }),
      {
        frontendBase: "http://127.0.0.1:3000",
        sessionHeader: BROWSER_SESSION_HEADER,
        sessionId: "session-a",
        timeoutMs: 60_000,
      },
    );
  });

  test("sends the current session only in the canonical header", async () => {
    const requests: Request[] = [];
    const request: typeof fetch = (input, init) => {
      requests.push(new Request(input, init));
      return Promise.resolve(Response.json({ data: { url: "https://example.com" }, ok: true }));
    };
    const config = (sessionId: string): BrowserExtensionConfig => ({
      frontendBase: "http://127.0.0.1:3000",
      sessionHeader: BROWSER_SESSION_HEADER,
      sessionId,
      timeoutMs: 1_000,
    });
    await callBrowserAction(
      config("session-a"),
      "navigate",
      { url: "https://example.com" },
      undefined,
      request,
    );
    await callBrowserAction(config("session-b"), "get-url", {}, undefined, request);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.headers.get(BROWSER_SESSION_HEADER), "session-a");
    assert.equal(requests[1]?.headers.get(BROWSER_SESSION_HEADER), "session-b");
    assert.deepEqual(await requests[0]?.json(), { url: "https://example.com" });
    assert.deepEqual(await requests[1]?.json(), {});
  });
});
