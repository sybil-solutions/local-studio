// CRITICAL
import { getModel } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_PROVIDER = "openai";

export const createOpenAiCompatibleModel = (
  modelId: string,
  baseUrl: string,
  provider = DEFAULT_OPENAI_PROVIDER,
): Model<"openai-completions"> => {
  const base = getModel("openai", DEFAULT_OPENAI_MODEL);
  const normalizedProvider = typeof provider === "string" && provider.trim().length > 0 ? provider.trim() : DEFAULT_OPENAI_PROVIDER;
  return {
    ...base,
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: normalizedProvider,
    baseUrl,
  };
};
