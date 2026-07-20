import { describe, expect, test } from "bun:test";
import { buildHuggingFaceFileList, type HuggingFaceModelInfo } from "./huggingface-api";

const modelInfo = (files: string[]): HuggingFaceModelInfo => ({
  siblings: files.map((rfilename, index) => ({ rfilename, size: 100 + index })),
});

describe("buildHuggingFaceFileList", () => {
  test("rejects an unqualified repository with multiple GGUF variants", () => {
    expect(() =>
      buildHuggingFaceFileList(
        modelInfo(["model-Q1.gguf", "model-Q4.gguf", "mmproj-model.gguf"]),
        [],
        [],
      ),
    ).toThrow("Choose one file");
  });

  test("selects only the requested GGUF variant", () => {
    const files = buildHuggingFaceFileList(
      modelInfo(["model-Q1.gguf", "model-Q4.gguf", "README.md"]),
      ["model-Q1.gguf"],
      [],
    );
    expect(files.map((file) => file.path)).toEqual(["model-Q1.gguf"]);
  });

  test("accepts all shards from one split GGUF family", () => {
    const files = buildHuggingFaceFileList(
      modelInfo(["model-Q1-00001-of-00002.gguf", "model-Q1-00002-of-00002.gguf"]),
      [],
      [],
    );
    expect(files).toHaveLength(2);
  });
});
