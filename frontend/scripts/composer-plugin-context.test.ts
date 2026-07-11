import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeComposerPlugins,
  selectedContextInstructions,
  selectedContextPrompt,
} from "../../shared/agent/composer-refs";

test("selected plugins add a capability contract without external data", () => {
  const plugins = sanitizeComposerPlugins([
    {
      id: "gmail",
      name: "Gmail",
      description: "Search and read mail",
      capabilities: ["search", "read"],
    },
  ]);
  const prompt = selectedContextPrompt("Find the receipt", [], plugins);
  assert.match(prompt, /Selected plugins:/);
  assert.match(prompt, /#Gmail: Search and read mail\. Available capabilities: search, read\./);
  assert.match(prompt, /User prompt:\n\nFind the receipt/);
  assert.equal(prompt.includes("@gmail.com"), false);
  assert.match(selectedContextInstructions([], plugins) ?? "", /#Gmail/);
});

test("invalid plugin context is discarded", () => {
  assert.deepEqual(sanitizeComposerPlugins([null, 1, {}]), []);
});
