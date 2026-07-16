import assert from "node:assert/strict";
import test from "node:test";
import {
  integrationSectionFromHash,
  legacyIntegrationHref,
} from "../src/features/integrations/integration-navigation";

test("integration navigation defaults unknown sections to plugins", () => {
  assert.equal(integrationSectionFromHash(""), "plugins");
  assert.equal(integrationSectionFromHash("#unknown"), "plugins");
});

test("integration navigation selects skills from a hash", () => {
  assert.equal(integrationSectionFromHash("#skills"), "skills");
});

test("integration navigation forwards legacy settings hashes", () => {
  assert.equal(
    legacyIntegrationHref("#connectors"),
    "/configure?integration=connectors#integrations",
  );
  assert.equal(legacyIntegrationHref("#skills"), "/configure?integration=skills#integrations");
  assert.equal(legacyIntegrationHref("#system"), null);
});
