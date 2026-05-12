import { describe, expect, it } from "bun:test";
import { asRecipeId } from "../../../types/brand";
import type { Recipe } from "../../models/types";
import {
  getDefaultReasoningParser,
  getDefaultToolCallParser,
  shouldEnableExpertParallel,
} from "./model-runtime-defaults";

const recipeFor = (modelId: string, tensorParallelSize = 1): Recipe => ({
  id: asRecipeId("runtime-default-test"),
  name: "runtime default test",
  model_path: modelId,
  backend: "vllm",
  env_vars: null,
  tensor_parallel_size: tensorParallelSize,
  pipeline_parallel_size: 1,
  max_model_len: 32768,
  gpu_memory_utilization: 0.9,
  kv_cache_dtype: "auto",
  max_num_seqs: 256,
  trust_remote_code: true,
  tool_call_parser: null,
  reasoning_parser: null,
  enable_auto_tool_choice: false,
  quantization: null,
  dtype: null,
  host: "0.0.0.0",
  port: 8000,
  served_model_name: null,
  python_path: null,
  extra_args: {},
  max_thinking_tokens: null,
  thinking_mode: "conservative",
});

describe("model runtime defaults", () => {
  it("keeps GLM reasoning and tool parser lines distinct", () => {
    expect(getDefaultReasoningParser(recipeFor("zai-org/GLM-4.6"))).toBe("glm45");
    expect(getDefaultToolCallParser(recipeFor("zai-org/GLM-4.6"))).toBe("glm45");
    expect(getDefaultReasoningParser(recipeFor("zai-org/GLM-5.1"))).toBe("glm45");
    expect(getDefaultToolCallParser(recipeFor("zai-org/GLM-5.1"))).toBe("glm47");
  });

  it("captures model-specific reasoning parser exceptions", () => {
    expect(getDefaultReasoningParser(recipeFor("MiniMaxAI/MiniMax-M2"))).toBe(
      "minimax_m2_append_think"
    );
    expect(getDefaultReasoningParser(recipeFor("Intellect-3/model"))).toBe("deepseek_r1");
    expect(getDefaultReasoningParser(recipeFor("Qwen/Qwen3-Thinking"))).toBe("deepseek_r1");
    expect(getDefaultReasoningParser(recipeFor("Qwen/Qwen3-Coder"))).toBe("qwen3");
  });

  it("enables expert parallelism only for explicit or multi-tp MoE recipes", () => {
    expect(shouldEnableExpertParallel(recipeFor("Qwen/Qwen3.5-235B-A22B", 2), undefined)).toBe(
      true
    );
    expect(shouldEnableExpertParallel(recipeFor("Qwen/Qwen3.5-235B-A22B", 1), undefined)).toBe(
      false
    );
    expect(shouldEnableExpertParallel(recipeFor("plain/model", 1), true)).toBe(true);
    expect(shouldEnableExpertParallel(recipeFor("MiniMaxAI/MiniMax-M2", 8), false)).toBe(false);
  });
});
