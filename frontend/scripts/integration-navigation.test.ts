import assert from "node:assert/strict";
import test from "node:test";
import {
  integrationSectionFromHash,
  legacyIntegrationHref,
} from "../src/features/integrations/integration-navigation";

test("integration navigation defaults unknown sections to connectors", () => {
  assert.equal(integrationSectionFromHash(""), "connectors");
  assert.equal(integrationSectionFromHash("#unknown"), "connectors");
});

test("integration navigation selects skills from a hash", () => {
  assert.equal(integrationSectionFromHash("#skills"), "skills");
});

test("integration navigation forwards legacy settings hashes", () => {
  assert.equal(legacyIntegrationHref("#connectors"), "/integrations#connectors");
  assert.equal(legacyIntegrationHref("#skills"), "/integrations#skills");
  assert.equal(legacyIntegrationHref("#system"), null);
});
