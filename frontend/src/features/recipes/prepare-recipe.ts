import type { Recipe } from "@/lib/types";
import { stripForeignFlagKeys } from "@local-studio/contracts/engine-args";
import type { RecipeEditor } from "./recipe-editor";
import { EXTRA_ARG_FIELDS } from "./extra-arg-fields";
import {
  getCandidateKeys,
  getExtraArgValue,
  parseJsonObject,
  setExtraArgValue,
} from "./extra-args";

export const prepareRecipeForSave = (recipe: RecipeEditor): Recipe => {
  const payload: RecipeEditor = {
    ...recipe,
    extra_args: { ...(recipe.extra_args ?? {}) },
  };
  const extraArgs = payload.extra_args ?? {};

  if (payload.tensor_parallel_size === undefined && payload.tp !== undefined) {
    payload.tensor_parallel_size = payload.tp;
  }
  if (payload.pipeline_parallel_size === undefined && payload.pp !== undefined) {
    payload.pipeline_parallel_size = payload.pp;
  }

  for (const field of EXTRA_ARG_FIELDS) {
    const value = payload[field.field];
    if (value !== undefined) {
      setExtraArgValue(extraArgs, field, value);
    }
    Reflect.deleteProperty(payload, field.field);
  }

  const existingKwargs = parseJsonObject(
    getExtraArgValue(extraArgs, {
      key: "default-chat-template-kwargs",
      aliases: ["default_chat_template_kwargs"],
    }),
  );
  const updatedKwargs = { ...(existingKwargs ?? {}) };
  if (payload.thinking_budget !== undefined && payload.thinking_budget !== null) {
    updatedKwargs["thinking_budget"] = payload.thinking_budget;
  } else {
    delete updatedKwargs["thinking_budget"];
  }
  for (const key of getCandidateKeys({
    key: "default-chat-template-kwargs",
    aliases: ["default_chat_template_kwargs"],
  })) {
    delete extraArgs[key];
  }
  if (Object.keys(updatedKwargs).length > 0) {
    extraArgs["default_chat_template_kwargs"] = updatedKwargs;
  }

  if (payload.env_vars) {
    payload.env_vars = Object.fromEntries(
      Object.entries(payload.env_vars).map(([key, value]) => [key, String(value)]),
    );
  }

  for (const key of ["tp", "pp", "status", "crash_loop", "thinking_budget"]) {
    Reflect.deleteProperty(payload, key);
  }
  Reflect.deleteProperty(extraArgs, "status");
  Reflect.deleteProperty(extraArgs, "crash_loop");

  // Drop any vLLM-only flags that would otherwise leak into a non-vLLM engine
  // (e.g. after switching a recipe's backend). The active engine is the
  // authority for which extra args are valid.
  payload.extra_args = stripForeignFlagKeys(payload.backend ?? "vllm", extraArgs);
  return payload;
};
