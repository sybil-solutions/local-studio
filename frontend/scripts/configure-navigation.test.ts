import assert from "node:assert/strict";
import test from "node:test";
import { configureSectionFromHash } from "../src/features/configure/configure-navigation";

test("configure navigation accepts every consolidated section", () => {
  assert.equal(configureSectionFromHash("#overview"), "overview");
  assert.equal(configureSectionFromHash("#rig"), "rig");
  assert.equal(configureSectionFromHash("#models"), "models");
  assert.equal(configureSectionFromHash("#integrations"), "integrations");
  assert.equal(configureSectionFromHash("#server"), "server");
});

test("configure navigation falls back to overview", () => {
  assert.equal(configureSectionFromHash(""), "overview");
  assert.equal(configureSectionFromHash("#unknown"), "overview");
});
