import { Schema } from "effect";
export { default as bundledModelIndexSource } from "./model-index.json";

export const ModelIndexVariantSchema = Schema.Struct({
  format: Schema.Literals(["bf16", "fp8", "nvfp4", "q4"]),
  repo: Schema.String,
  official: Schema.Boolean,
  source: Schema.optional(Schema.String),
  allow_patterns: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  size_gb: Schema.NullOr(Schema.Number),
  caveat: Schema.NullOr(Schema.String),
});

export const ModelIndexModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.NullOr(Schema.Literals(["fast", "smart"])),
  description: Schema.String,
  params: Schema.String,
  active_params_b: Schema.NullOr(Schema.Number),
  context_tokens: Schema.Number,
  license: Schema.String,
  multimodal: Schema.Boolean,
  notes: Schema.Array(Schema.String),
  variants: Schema.Array(ModelIndexVariantSchema),
});

export const ModelIndexTierSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  blurb: Schema.String,
  models: Schema.Array(ModelIndexModelSchema),
});

export const ModelIndexSchema = Schema.Struct({
  version: Schema.Number,
  updated: Schema.String,
  tiers: Schema.Array(ModelIndexTierSchema),
});

export type ModelIndexVariant = Schema.Schema.Type<typeof ModelIndexVariantSchema>;
export type ModelIndexModel = Schema.Schema.Type<typeof ModelIndexModelSchema>;
export type ModelIndexTier = Schema.Schema.Type<typeof ModelIndexTierSchema>;
export type ModelIndexResponse = Schema.Schema.Type<typeof ModelIndexSchema>;
export type ModelIndexVariantFormat = ModelIndexVariant["format"];
