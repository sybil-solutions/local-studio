import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { loadReasoningVisible, setReasoningVisible } from "@/features/agent/messages/reasoning-pref";
import { REASONING_VISIBILITY_CHANGED_EVENT } from "@/lib/workspace-events";

type FakeWindow = {
  localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void };
  dispatchEvent(event: { type: string }): boolean;
  __events: string[];
};

function installFakeWindow(): FakeWindow {
  const store = new Map<string, string>();
  const win: FakeWindow = {
    localStorage: {
      getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k, v) => {
        store.set(k, v);
      },
    },
    dispatchEvent: (event) => {
      win.__events.push(event.type);
      return true;
    },
    __events: [],
  };
  (globalThis as { window?: unknown }).window = win;
  return win;
}

beforeEach(() => {
  installFakeWindow();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("defaults to visible when the key is unset", () => {
  assert.equal(loadReasoningVisible(), true);
});

test("hiding then reading round-trips through storage", () => {
  setReasoningVisible(false);
  assert.equal(loadReasoningVisible(), false);
});

test("re-showing flips it back to visible", () => {
  setReasoningVisible(false);
  setReasoningVisible(true);
  assert.equal(loadReasoningVisible(), true);
});

test("only the explicit '0' sentinel hides reasoning", () => {
  const win = (globalThis as { window: FakeWindow }).window;
  win.localStorage.setItem("local-studio.agent.reasoningVisible", "anything-else");
  assert.equal(loadReasoningVisible(), true);
});

test("setting dispatches the visibility-changed event", () => {
  const win = (globalThis as { window: FakeWindow }).window;
  setReasoningVisible(false);
  assert.ok(win.__events.includes(REASONING_VISIBILITY_CHANGED_EVENT));
});
