// CRITICAL
"use client";

import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import type { ModelOption } from "@/app/chat/types";
import { buildDisplayModelLabel, parseChatModelId } from "@/app/chat/types";

type UseAvailableModelsArgs = {
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;
  setAvailableModels: (models: ModelOption[]) => void;
  customChatModels: string[];
};

type RawCatalogModel = {
  id?: string;
  model?: string;
  name?: string;
  max_model_len?: number;
  active?: boolean;
};

const KNOWN_CONTEXT_LENGTHS: Record<string, number> = {
  "gpt-4": 8192,
  "gpt-4-32k": 32768,
  "gpt-4-turbo": 128000,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-3.5-turbo": 4096,
  "claude-3-opus": 200000,
  "claude-3-sonnet": 200000,
  "claude-3-haiku": 200000,
  "claude-3-5-sonnet": 200000,
  "gemini-pro": 32768,
  "gemini-1.5-pro": 1048576,
  "gemini-1.5-flash": 1048576,
  qwen: 32768,
  qwen2: 131072,
  llama: 8192,
  "llama-2": 4096,
  "llama-3": 8192,
  "llama-3.1": 131072,
  mistral: 32768,
  mixtral: 32768,
  phi: 2048,
  "phi-3": 131072,
  yi: 32768,
  glm: 32768,
  "glm-4": 131072,
  deepseek: 65536,
  "command-r": 128000,
  "command-r-plus": 128000,
};

type CatalogModel = {
  id: string;
  max_model_len?: number;
  active?: boolean;
};

const getContextLength = (id: string, apiMaxLen?: number): number => {
  if (apiMaxLen && apiMaxLen > 0) return apiMaxLen;
  const lowerId = id.toLowerCase();
  for (const [pattern, length] of Object.entries(KNOWN_CONTEXT_LENGTHS)) {
    if (lowerId.includes(pattern.toLowerCase())) {
      return length;
    }
  }
  return 32768;
};

const buildModelOptionFromSource = (
  modelId: string,
  maxModelLen?: number,
  active?: boolean,
): ModelOption => {
  const parsedModel = parseChatModelId(modelId);
  const displayId =
    parsedModel.provider === "openai" || !parsedModel.provider ? modelId : `${parsedModel.provider}/${parsedModel.id}`;
  return {
    id: displayId,
    provider: parsedModel.provider,
    name: buildDisplayModelLabel(parsedModel.id, parsedModel.provider),
    maxModelLen: getContextLength(parsedModel.id, maxModelLen),
    active: active === true,
  };
};

const normalizeModelId = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export function useAvailableModels({
  selectedModel,
  setSelectedModel,
  setAvailableModels,
  customChatModels,
}: UseAvailableModelsArgs): void {
  const modelsLoadedRef = useRef(false);
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);

  useEffect(() => {
    if (modelsLoadedRef.current) return;
    modelsLoadedRef.current = true;

    const loadModels = async () => {
      try {
        const [data, recipesResult] = await Promise.all([
          api.getOpenAIModels(),
          api.getRecipes().catch(() => ({ recipes: [] })),
        ]);

        const dataModels = (data as { data?: unknown[] }).data;
        const modelsField = (data as { models?: unknown[] }).models;
        const rawModels = Array.isArray(data)
          ? data
          : Array.isArray(dataModels)
            ? dataModels
            : Array.isArray(modelsField)
              ? modelsField
              : [];

        const recipeMaxById = new Map<string, number>();
        for (const recipe of recipesResult.recipes ?? []) {
          if (!recipe || typeof recipe !== "object") continue;
          const record = recipe as { id?: string; served_model_name?: string; max_model_len?: number };
          const maxLen = record.max_model_len ?? 0;
          if (!maxLen || maxLen <= 0) continue;
          if (record.id) recipeMaxById.set(record.id, maxLen);
          if (record.served_model_name) recipeMaxById.set(record.served_model_name, maxLen);
        }

        const mappedModels: CatalogModel[] = rawModels
          .flatMap((model) => {
            if (!model || typeof model !== "object") return [];
            const record = model as RawCatalogModel;
            const id = normalizeModelId(record.id ?? record.model ?? record.name);
            if (!id) return [];
            const recipeMaxLen = recipeMaxById.get(id);
            return [
              {
                id,
                max_model_len: getContextLength(id, record.max_model_len ?? recipeMaxLen),
                active: record.active === true,
              },
            ];
          })
          .sort((a, b) => a.id.localeCompare(b.id));

        setCatalogModels(mappedModels);
      } catch (err) {
        console.error("Failed to load models:", err);
        setCatalogModels([]);
      }
    };

    void loadModels();
  }, []);

  useEffect(() => {
    const normalizedCustomModels = Array.from(
      new Set(
        (customChatModels ?? [])
          .map((value) => normalizeModelId(value))
          .filter((value) => value.length > 0),
      ),
    );

    const modelMap = new Map<string, ModelOption>();
    for (const model of catalogModels) {
      const option = buildModelOptionFromSource(model.id, model.max_model_len, model.active);
      modelMap.set(option.id, option);
    }

    for (const modelId of normalizedCustomModels) {
      modelMap.set(modelId, buildModelOptionFromSource(modelId, undefined, false));
    }

    const selectedModelNormalized = normalizeModelId(selectedModel);
    if (selectedModelNormalized && !modelMap.has(selectedModelNormalized)) {
      modelMap.set(
        selectedModelNormalized,
        buildModelOptionFromSource(selectedModelNormalized, undefined, false),
      );
    }

    const mergedModels = Array.from(modelMap.values()).sort((a, b) => {
      const aLabel = buildDisplayModelLabel(a.id, a.provider);
      const bLabel = buildDisplayModelLabel(b.id, b.provider);
      return aLabel.localeCompare(bLabel);
    });
    setAvailableModels(mergedModels);

    const hasLastModel =
      selectedModelNormalized.length === 0
        ? false
        : modelMap.has(localStorage.getItem("vllm-studio-last-model") ?? "");

    if (!selectedModelNormalized && mergedModels.length > 0 && hasLastModel) {
      setSelectedModel(localStorage.getItem("vllm-studio-last-model") ?? "");
      return;
    }

    if (!selectedModelNormalized && mergedModels.length > 0) {
      const activeModel = mergedModels.find((model) => model.active)?.id;
      const fallback = activeModel ?? mergedModels[0].id;
      if (fallback && fallback !== selectedModelNormalized) {
        setSelectedModel(fallback);
      }
    }

    if (!selectedModelNormalized && mergedModels.length === 0) {
      setSelectedModel("");
    }
  }, [catalogModels, customChatModels, selectedModel, setAvailableModels, setSelectedModel]);
}
