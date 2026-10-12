import type { EngineArgValues } from "@local-studio/contracts/engine-args";
import type { Recipe } from "@/lib/types";

export type RecipeEditor = Recipe &
  EngineArgValues & {
    api_key?: string;
    tokenizer_mode?: "auto" | "slow" | "mistral";
    tp?: number;
    pp?: number;
    scheduling_policy?: "fcfs" | "priority";
    spec_decoding_acceptance_method?: "rejection_sampler" | "typical_acceptance_sampler";
    enable_thinking?: boolean;
    thinking_budget?: number;
    chat_template_content_format?: "auto" | "string" | "openai";
  };
