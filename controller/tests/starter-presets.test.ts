import { describe, expect, test } from "bun:test";
import { STUDIO_STARTER_PRESETS } from "../src/modules/studio/configs";

describe("studio starter presets", () => {
  test("includes Atlas Cloud as an OpenAI-compatible remote endpoint", () => {
    const preset = STUDIO_STARTER_PRESETS.find(
      (candidate) => candidate.id === "atlascloud-qwen35-flash",
    );

    expect(preset).toBeDefined();
    expect(preset?.kind).toBe("remote");
    expect(preset?.remote).toEqual({
      base_url: "https://api.atlascloud.ai/v1",
      model: "qwen/qwen3.5-flash",
    });
    expect(preset?.tags).toContain("openai-compatible");
    expect(preset?.size_gb).toBeNull();
    expect(preset?.min_vram_gb).toBeNull();
  });
});
