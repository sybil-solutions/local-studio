import type { Recipe } from "../../models/types";

type ParserName = string | undefined;

const GLM_4_REASONING_TAGS = ["4.5", "4.6", "4.7", "4-5", "4-6", "4-7"];
const GLM_5_REASONING_TAGS = ["5.0", "5.1", "5-0", "5-1"];
const MINIMAX_M2_TAGS = ["m2", "m-2"];
const QWEN_MOE_TAGS = ["qwen3.5", "qwen3-3.5", "qwen3-235b", "qwen3_235b"];

const modelIdForRecipe = (recipe: Recipe): string => {
  return (recipe.served_model_name || recipe.model_path || "").toLowerCase();
};

const includesAny = (value: string, tags: string[]): boolean =>
  tags.some((tag) => value.includes(tag));

const isMiniMaxM2 = (modelId: string): boolean => {
  return modelId.includes("minimax") && includesAny(modelId, MINIMAX_M2_TAGS);
};

const isGlm4Line = (modelId: string): boolean => {
  return modelId.includes("glm") && includesAny(modelId, GLM_4_REASONING_TAGS);
};

const isGlm5Line = (modelId: string): boolean => {
  return modelId.includes("glm") && includesAny(modelId, GLM_5_REASONING_TAGS);
};

const isIntellect3 = (modelId: string): boolean => {
  return modelId.includes("intellect") && modelId.includes("3");
};

const isQwenMoe = (modelId: string): boolean => {
  return (
    includesAny(modelId, QWEN_MOE_TAGS) || (modelId.includes("qwen") && modelId.includes("262"))
  );
};

export const getDefaultReasoningParser = (recipe: Recipe): ParserName => {
  const modelId = modelIdForRecipe(recipe);

  if (isMiniMaxM2(modelId)) {
    return "minimax_m2_append_think";
  }
  if (isIntellect3(modelId) || modelId.includes("mirothinker")) {
    return "deepseek_r1";
  }
  if (isGlm4Line(modelId) || isGlm5Line(modelId)) {
    return "glm45";
  }
  if (modelId.includes("qwen3") && modelId.includes("thinking")) {
    return "deepseek_r1";
  }
  if (modelId.includes("qwen3")) {
    return "qwen3";
  }
  return undefined;
};

export const getDefaultToolCallParser = (recipe: Recipe): ParserName => {
  const modelId = modelIdForRecipe(recipe);

  if (modelId.includes("mirothinker")) {
    return undefined;
  }
  if (isMiniMaxM2(modelId)) {
    return "minimax-m2";
  }
  if (isGlm4Line(modelId)) {
    return "glm45";
  }
  if (isGlm5Line(modelId)) {
    return "glm47";
  }
  if (isIntellect3(modelId)) {
    return "qwen3_xml";
  }
  return undefined;
};

export const shouldEnableExpertParallel = (recipe: Recipe, explicitOverride: unknown): boolean => {
  if (explicitOverride === true) {
    return true;
  }
  if (explicitOverride === false || recipe.tensor_parallel_size <= 1) {
    return false;
  }
  const modelId = modelIdForRecipe(recipe);
  return isMiniMaxM2(modelId) || isQwenMoe(modelId);
};
