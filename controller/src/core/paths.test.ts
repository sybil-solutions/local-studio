import { describe, expect, test } from "bun:test";

import { modelBasename } from "./paths";

describe("modelBasename", () => {
  test("derives names from huggingface ids and posix paths", () => {
    expect(modelBasename("deepseek-ai/DeepSeek-V3")).toBe("DeepSeek-V3");
    expect(modelBasename("/models/llama-3")).toBe("llama-3");
  });

  test("derives names from windows paths", () => {
    if (process.platform !== "win32") return;
    expect(modelBasename("C:\\models\\llama-3")).toBe("llama-3");
  });

  test("returns null for empty and root-like inputs", () => {
    expect(modelBasename("")).toBeNull();
    expect(modelBasename(null)).toBeNull();
    expect(modelBasename(undefined)).toBeNull();
    expect(modelBasename("/")).toBeNull();
  });
});
