import { describe, expect, it } from "vitest";
import { normalizeOpenAIModels, modelsToPiModels } from "./models";

describe("agent model normalization", () => {
  it("maps OpenAI /v1/models rows into Pi-ready models", () => {
    const models = normalizeOpenAIModels({
      data: [
        { id: "deepseek-v4-flash", context_window: 1_000_000, max_tokens: 262_144 },
        { id: "tiny", max_model_len: 4096, metadata: { max_tokens: 512, reasoning: false } },
        { id: "deepseek-v4-flash" },
      ],
    });

    expect(models).toHaveLength(2);
    expect(models.find((m) => m.id === "deepseek-v4-flash")).toMatchObject({
      provider: "vllm-studio",
      contextWindow: 1_000_000,
      maxTokens: 262_144,
      reasoning: true,
      vision: false,
    });

    const piModels = modelsToPiModels(models);
    expect(piModels.find((m) => m.id === "tiny")?.input).toEqual(["text"]);
    expect(piModels.find((m) => m.id === "tiny")?.compat).toMatchObject({
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    });
  });

  it("does not clamp local reasoning models to a small default output limit", () => {
    const [model] = normalizeOpenAIModels({
      data: [{ id: "MiMo-V2.5", max_model_len: 262_144 }],
    });

    expect(model).toMatchObject({
      reasoning: true,
      vision: true,
      contextWindow: 262_144,
      maxTokens: 65_536,
    });

    expect(modelsToPiModels([model])[0]?.input).toEqual(["text", "image"]);
  });

  it("honors explicit vision metadata from model recipes", () => {
    const models = normalizeOpenAIModels({
      data: [
        { id: "local-vlm", metadata: { modalities: ["text", "image"] } },
        { id: "MiMo-V2.5", metadata: { vision: false } },
      ],
    });

    const visionModel = models.find((model) => model.id === "local-vlm");
    const textModel = models.find((model) => model.id === "MiMo-V2.5");

    expect(visionModel?.vision).toBe(true);
    expect(textModel?.vision).toBe(false);
  });
});
