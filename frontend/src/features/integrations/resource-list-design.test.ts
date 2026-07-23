import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const machines = source("../configure/rig-node-card.tsx");
const machineEditor = source("../configure/node-form-modal.tsx");
const plugins = source("./plugins-section.tsx");
const connectors = source("../settings/connectors-section.tsx");
const providers = source("./model-providers-section.tsx");
const skills = source("./skills-section.tsx");
const serves = source("../recipes/recipes-content/recipe-row.tsx");

describe("configure resource list design", () => {
  test("uses the Serve row language across every resource family", () => {
    for (const file of [machines, plugins, connectors, providers, skills, serves]) {
      assert.match(file, /<ModelRow/);
      assert.match(file, /onClick=/);
    }
  });

  test("opens each resource editor in a right-side drawer", () => {
    assert.match(machineEditor, /<ResourceDrawer/);
    assert.match(plugins, /function PluginDrawer/);
    assert.match(connectors, /function ConnectorDrawer/);
    assert.match(connectors, /function CatalogDrawer/);
    assert.match(providers, /function ProviderDrawer/);
    assert.match(skills, /function SkillDrawer/);
  });

  test("shows provider or source identity beside non-model resources", () => {
    for (const file of [plugins, connectors, providers, skills]) {
      assert.match(file, /<ResourceLogo/);
    }
    assert.match(plugins, /Company or source/);
    assert.match(connectors, /Company/);
    assert.match(providers, /Company/);
    assert.match(skills, /Source/);
  });

  test("keeps row actions separate from whole-row editor clicks", () => {
    assert.match(machines, /actions=/);
    assert.match(plugins, /PluginRowActions/);
    assert.match(connectors, /<ModelButton/);
    assert.match(providers, /<ModelButton/);
    assert.match(serves, /onClick=\{handleEdit\}/);
  });
});
