import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const picks = source("./picks-shared.tsx");
const modelCard = source("../../../ui/huggingface-model-card.tsx");
const resourceDrawer = source("../../../ui/resource-drawer.tsx");
const skills = source("../../integrations/skills-section.tsx");

describe("model progressive disclosure", () => {
  test("renders picks as branded cards that open the shared drawer", () => {
    assert.match(picks, /lg:grid-cols-2/);
    assert.match(picks, /function PickDrawer/);
    assert.match(picks, /<ResourceDrawer/);
    assert.match(picks, /<ModelLogo/);
    assert.match(picks, /backgroundColor: `\$\{brand\.color\}0D`/);
    assert.doesNotMatch(picks, /<details/);
  });

  test("uses the same right rail for skills and Hugging Face models", () => {
    assert.match(skills, /function SkillDrawer[\s\S]*<ResourceDrawer/);
    assert.match(modelCard, /<ResourceDrawer/);
    assert.match(resourceDrawer, /width = 620/);
    assert.match(resourceDrawer, /calc\(100vw - 72px\)/);
  });

  test("renders Hugging Face model cards as one column", () => {
    assert.match(modelCard, /className="space-y-5"/);
    assert.doesNotMatch(modelCard, /xl:grid-cols/);
    assert.doesNotMatch(modelCard, /grid-cols-\[minmax\(0,1fr\)_240px\]/);
  });
});
