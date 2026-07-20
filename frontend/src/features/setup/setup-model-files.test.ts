import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ggufFileOptions, manualDownloadPreset } from "./setup-model-files";

describe("manual GGUF selection", () => {
  test("lists primary GGUF weights and excludes projectors", () => {
    const options = ggufFileOptions({
      modelId: "org/model",
      url: "https://huggingface.co/org/model",
      siblings: [
        { rfilename: "model-Q1.gguf", size: 1024 ** 3 },
        { rfilename: "model-F16.gguf", size: 8 * 1024 ** 3 },
        { rfilename: "mmproj-model.gguf", size: 100 },
      ],
    });
    assert.deepEqual(
      options.map((option) => option.value),
      ["model-F16.gguf", "model-Q1.gguf"],
    );
    assert.match(options[1]?.label ?? "", /1\.0 GB/);
  });

  test("creates a llama.cpp preset pinned to the exact file", () => {
    const preset = manualDownloadPreset("org/model", {
      value: "model-Q1.gguf",
      label: "model-Q1.gguf",
    });
    assert.equal(preset?.backend, "llamacpp");
    assert.deepEqual(preset?.allow_patterns, ["model-Q1.gguf"]);
  });
});
