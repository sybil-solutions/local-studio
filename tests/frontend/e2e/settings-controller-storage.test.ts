import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  getControllerApiKey,
  loadSavedControllers,
  normalizeControllerUrl,
  saveSavedControllers,
} from "@/lib/api/controllers";

type WindowLike = {
  localStorage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
  dispatchEvent: (event: Event) => boolean;
};

const STORAGE_KEY = "local-studio.controllers";
let previousWindow: unknown;
let storage: Map<string, string>;
let dispatchedEvents: string[];

function installWindow(): void {
  const fakeWindow: WindowLike = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    },
    dispatchEvent: (event) => {
      dispatchedEvents.push(event.type);
      return true;
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
}

beforeEach(() => {
  previousWindow = globalThis.window;
  storage = new Map();
  dispatchedEvents = [];
  installWindow();
});

afterEach(() => {
  if (previousWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});

test("saved controller settings normalize URLs, dedupe entries, and preserve API keys", () => {
  const saved = saveSavedControllers([
    {
      url: "http://homelab.local:8080/v1/",
      apiKey: " first-key ",
      name: " Homelab ",
    },
    {
      url: "http://homelab.local:8080/",
      apiKey: "second-key",
      name: "Primary",
    },
    {
      url: "  ",
      apiKey: "ignored",
    },
  ]);

  assert.deepEqual(saved, [
    {
      url: "http://homelab.local:8080",
      apiKey: "second-key",
      name: "Primary",
    },
  ]);
  assert.deepEqual(loadSavedControllers(), saved);
  assert.equal(getControllerApiKey("http://homelab.local:8080/v1"), "second-key");
  assert.deepEqual(dispatchedEvents, ["vllm:controllers-changed", "storage"]);
});

test("saved controller settings migrate string entries into normalized objects", () => {
  storage.set(
    STORAGE_KEY,
    JSON.stringify([
      "http://controller.local:8080/v1",
      { url: "http://controller.local:8080/", apiKey: "secret" },
      { url: "http://second.local:8080/v1", name: "second" },
    ]),
  );

  const loaded = loadSavedControllers();

  assert.deepEqual(loaded, [
    { url: "http://controller.local:8080", apiKey: "secret" },
    { url: "http://second.local:8080", name: "second" },
  ]);
  assert.deepEqual(JSON.parse(storage.get(STORAGE_KEY) ?? "[]"), loaded);
});

test("controller URL normalization strips OpenAI suffixes without losing non-URL input", () => {
  assert.equal(normalizeControllerUrl(" http://127.0.0.1:8080/v1/ "), "http://127.0.0.1:8080");
  assert.equal(normalizeControllerUrl("homelab-controller/v1/"), "homelab-controller");
  assert.equal(normalizeControllerUrl(""), "");
});
