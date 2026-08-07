import assert from "node:assert/strict";
import { test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "playwright-core";
import { BrowserHost } from "../src/browser-host/browser-host";
import { HostedPage } from "../src/browser-host/hosted-page";
import {
  createPlaywrightSessionLauncher,
  findBrowserBinary,
  PlaywrightManager,
} from "../src/browser-host/playwright";

type Settlement<A> =
  | { status: "fulfilled"; value: A }
  | { error: unknown; status: "rejected" }
  | { status: "timed-out" };

const settleWithin = <A>(promise: Promise<A>, timeoutMs: number): Promise<Settlement<A>> =>
  Promise.race([
    promise.then<Settlement<A>>(
      (value) => ({ status: "fulfilled", value }),
      (error: unknown) => ({ error, status: "rejected" }),
    ),
    Bun.sleep(timeoutMs).then<Settlement<A>>(() => ({ status: "timed-out" })),
  ]);

const listen = (server: ReturnType<typeof createServer>): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });

const close = (server: ReturnType<typeof createServer>): Promise<void> => {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
};

test.skipIf(findBrowserBinary() === null)(
  "keeps cookie, storage, frame, and input state isolated in real Chromium sessions",
  async () => {
    const executablePath = findBrowserBinary();
    if (!executablePath) throw new Error("Chromium disappeared after test selection");
    const hangingNavigation = Promise.withResolvers<void>();
    const fixture = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/hang") {
        hangingNavigation.resolve();
        return;
      }
      const marker = url.searchParams.get("marker");
      if (marker !== "session-a" && marker !== "session-b") {
        response.writeHead(400);
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": `scope=${marker}; Path=/; SameSite=Lax`,
      });
      response.end(`<!doctype html>
<html>
<head><title>${marker}</title></head>
<body style="background:${marker === "session-a" ? "#a11" : "#11a"};color:#fff">
<label>${marker}<input id="entry" /></label>
<script>localStorage.setItem("scope", ${JSON.stringify(marker)})</script>
</body>
</html>`);
    });
    const manager = new PlaywrightManager({
      launch: createPlaywrightSessionLauncher(),
      resolveBinary: () => executablePath,
    });
    const host = new BrowserHost<Page>(manager, { attachPage: HostedPage.attach });
    try {
      const port = await listen(fixture);
      const origin = `http://127.0.0.1:${port}`;
      await Promise.all([
        host.navigate("session-a", `${origin}/?marker=session-a`),
        host.navigate("session-b", `${origin}/?marker=session-b`),
      ]);
      await host.click("session-a", { selector: "#entry" });
      await host.dispatchKey("session-a", {
        code: "KeyA",
        key: "a",
        text: "typed-a",
        type: "char",
      });
      const sessionBBeforeInput = await host.evaluate(
        "session-b",
        "document.querySelector('#entry')?.value",
      );
      await host.click("session-b", { selector: "#entry" });
      await host.dispatchKey("session-b", {
        code: "KeyB",
        key: "b",
        text: "typed-b",
        type: "char",
      });
      const [sessionA, sessionB, frameA, frameB] = await Promise.all([
        host.evaluate(
          "session-a",
          "({ cookie: document.cookie, input: document.querySelector('#entry')?.value, storage: localStorage.getItem('scope') })",
        ),
        host.evaluate(
          "session-b",
          "({ cookie: document.cookie, input: document.querySelector('#entry')?.value, storage: localStorage.getItem('scope') })",
        ),
        host.pollFrame("session-a"),
        host.pollFrame("session-b"),
      ]);
      assert.equal(sessionBBeforeInput, "");
      assert.deepEqual(sessionA, {
        cookie: "scope=session-a",
        input: "typed-a",
        storage: "session-a",
      });
      assert.deepEqual(sessionB, {
        cookie: "scope=session-b",
        input: "typed-b",
        storage: "session-b",
      });
      assert.ok((frameA.frame?.data.length ?? 0) > 100);
      assert.ok((frameB.frame?.data.length ?? 0) > 100);
      assert.notEqual(frameA.frame?.data, frameB.frame?.data);
      const navigation = host.navigate("session-a", `${origin}/hang`);
      await hangingNavigation.promise;
      const release = host.releaseSession("session-a");
      const [releaseResult, navigationResult] = await Promise.all([
        settleWithin(release, 2_000),
        settleWithin(navigation, 2_000),
      ]);
      assert.equal(releaseResult.status, "fulfilled");
      assert.equal(navigationResult.status, "rejected");
      assert.equal(manager.current("session-a"), null);
    } finally {
      await host.stop();
      await close(fixture);
    }
  },
);
