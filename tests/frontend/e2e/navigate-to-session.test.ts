import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { hrefWithOpenNonce, navigateToSessionHref } from "@/features/agent/ui/projects-nav/helpers";
import {
  sessionIdForNavigation,
  settledAgentNavigationHref,
} from "@/features/agent/ui/agent-workspace-navigation";

// Regression coverage for sidebar session navigation. The old
// `window.location.assign` hard-navigation fallback was deliberately removed
// (it caused full page reloads — "black pane for seconds"); session clicks are
// soft router pushes only. These tests pin that contract.

type FakeWindow = {
  location: { search: string; assign(href: string): void };
  setTimeout(cb: () => void, ms: number): number;
  __pendingTimers: Array<() => void>;
  __assigned: string[];
};

function installFakeWindow(search = ""): FakeWindow {
  const win: FakeWindow = {
    location: {
      search,
      assign: (href) => {
        win.__assigned.push(href);
      },
    },
    setTimeout: (cb) => {
      win.__pendingTimers.push(cb);
      return win.__pendingTimers.length;
    },
    __pendingTimers: [],
    __assigned: [],
  };
  (globalThis as { window?: unknown }).window = win;
  return win;
}

function flushTimers(win: FakeWindow): void {
  const pending = win.__pendingTimers.splice(0);
  for (const cb of pending) cb();
}

function makeRouter() {
  const pushed: string[] = [];
  return { push: (href: string) => pushed.push(href), pushed };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("issues exactly one soft router.push", () => {
  installFakeWindow("?session=old");
  const router = makeRouter();
  navigateToSessionHref(router, "/agent?session=target");
  assert.deepEqual(router.pushed, ["/agent?session=target"]);
});

test("never hard-navigates, even when the URL did not move", () => {
  const win = installFakeWindow("?session=old"); // URL never moved
  const router = makeRouter();
  navigateToSessionHref(router, "/agent?session=target");
  assert.equal(win.__pendingTimers.length, 0);
  flushTimers(win);
  assert.deepEqual(win.__assigned, []);
});

test("hrefWithOpenNonce appends ?open= when the href has no query", () => {
  const out = hrefWithOpenNonce("/agent");
  assert.match(out, /^\/agent\?open=.+/);
});

test("hrefWithOpenNonce appends &open= when the href already has a query", () => {
  const out = hrefWithOpenNonce("/agent?session=abc");
  assert.match(out, /^\/agent\?session=abc&open=.+/);
});

test("new task settlement removes the stale thread from the previous browser URL", () => {
  assert.equal(
    settledAgentNavigationHref(
      "http://localhost/agent?project=chats&session=old-thread",
      "chats",
      null,
    ),
    "http://localhost/agent?project=chats",
  );
});

test("thread settlement preserves the requested canonical route and removes one-shot params", () => {
  assert.equal(
    settledAgentNavigationHref(
      "http://localhost/agent?project=old&new=nonce&replace=1",
      "work",
      "thread-1",
    ),
    "http://localhost/agent?project=work&session=thread-1",
  );
});

test("new task navigation discards a stale session carried through the router transition", () => {
  assert.equal(sessionIdForNavigation("old-thread", "new-task-nonce"), null);
  assert.equal(sessionIdForNavigation("thread-1", null), "thread-1");
});
