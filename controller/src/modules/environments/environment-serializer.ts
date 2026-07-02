import { Schema } from "effect";
import type { Environment } from "./types";

const nullableStringSchema = Schema.Union([Schema.Null, Schema.String]);

/** Effect v4 schema for validated environment input. */
export const environmentSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  recipeId: Schema.String,
  engineId: Schema.Literals(["vllm", "sglang", "llamacpp"]),
  version: Schema.String,
  variant: nullableStringSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const parseEnvironment = (raw: unknown): Environment => {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid environment payload");
  }
  const data = raw as Record<string, unknown>;
  const now = new Date().toISOString();
  const parsed = Schema.decodeUnknownSync(environmentSchema)({
    ...data,
    variant: data["variant"] ?? null,
    createdAt: data["createdAt"] ?? now,
    updatedAt: data["updatedAt"] ?? now,
  });
  return parsed;
};
