import assert from "node:assert/strict";
import test from "node:test";
import { mergeControllersPreference } from "@/lib/desktop-ui-preferences";

test("controller preference merge preserves renderer credentials and fills metadata", () => {
  const current = JSON.stringify([
    { url: "http://local:8080", apiKey: "local-key", name: "Local", source: "renderer" },
  ]);
  const incoming = JSON.stringify([
    { url: "http://local:8080", apiKey: "stale-key", name: "Stale", color: "blue" },
    { url: "http://remote:8080", apiKey: "remote-key", name: "Remote" },
  ]);

  assert.deepEqual(JSON.parse(mergeControllersPreference(current, incoming) ?? "[]"), [
    {
      url: "http://local:8080",
      apiKey: "local-key",
      name: "Local",
      color: "blue",
      source: "renderer",
    },
    { url: "http://remote:8080", apiKey: "remote-key", name: "Remote" },
  ]);
});

test("controller preference merge uses incoming labels for blank renderer fields", () => {
  const current = JSON.stringify([{ url: "http://local:8080", apiKey: " ", name: "" }]);
  const incoming = JSON.stringify([
    { url: "http://local:8080", apiKey: "restored-key", name: "Restored" },
  ]);

  assert.deepEqual(JSON.parse(mergeControllersPreference(current, incoming) ?? "[]"), [
    { url: "http://local:8080", apiKey: "restored-key", name: "Restored" },
  ]);
});

test("controller preference merge skips malformed entries and preserves ordering", () => {
  const current = JSON.stringify([
    { url: "http://first:8080" },
    null,
    "invalid",
    { name: "missing URL" },
  ]);
  const incoming = JSON.stringify([["invalid"], { url: "http://second:8080" }, { url: "" }]);

  assert.deepEqual(JSON.parse(mergeControllersPreference(current, incoming) ?? "[]"), [
    { url: "http://first:8080" },
    { url: "http://second:8080" },
  ]);
});

test("controller preference merge leaves malformed persisted values untouched", () => {
  assert.equal(mergeControllersPreference("{", "[]"), null);
  assert.equal(mergeControllersPreference("[]", "{}"), null);
  assert.equal(mergeControllersPreference("[]", "{"), null);
  assert.equal(mergeControllersPreference("[]", "[]"), null);
});
