import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const css = readFileSync(new URL("../../../app/styles/globals/chat.css", import.meta.url), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, "g");
  let declarations: string | null = null;
  for (const match of css.matchAll(pattern)) declarations = match[1];
  assert.ok(declarations, `Missing CSS rule for ${selector}`);
  return declarations;
}

describe("chat markdown reading layout", () => {
  test("uses the dedicated transcript width independently of the composer", () => {
    const declarations = rule(".agent-thread-shell");
    assert.match(declarations, /max-width:\s*var\(--thread-w\)/);
    assert.doesNotMatch(declarations, /--composer-w/);
  });

  test("reserves enough space for multi-digit ordered-list markers", () => {
    assert.match(rule(".chat-markdown ol"), /padding-left:\s*2em/);
  });

  test("renders tables as readable document content", () => {
    const table = rule(".chat-markdown table");
    const heading = rule(".chat-markdown th");
    assert.match(table, /font-size:\s*inherit/);
    assert.match(table, /border:\s*0/);
    assert.match(heading, /font-size:\s*inherit/);
    assert.match(heading, /text-transform:\s*none/);
  });
});
