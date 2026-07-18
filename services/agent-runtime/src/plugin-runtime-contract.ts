import { Schema } from "effect";

const PluginToolStateSchema = Schema.Union([
  Schema.Literal("none"),
  Schema.Literal("available"),
  Schema.Literal("enabled"),
  Schema.Literal("disabled"),
  Schema.Literal("configuration_required"),
  Schema.Literal("invalid"),
]);

const PluginToolsViewSchema = Schema.Struct({
  state: PluginToolStateSchema,
  serverCount: Schema.Number,
  allowedToolCount: Schema.Number,
  mode: Schema.NullOr(Schema.Literal("observe")),
  reason: Schema.optional(Schema.String),
});

const PluginHostCapabilitySchema = Schema.Struct({
  adapter: Schema.Literal("local-studio-controller"),
  capability: Schema.Literal("speech"),
  actions: Schema.Array(Schema.Literal("synthesize")),
});

const PluginRuntimeViewSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  displayName: Schema.String,
  version: Schema.String,
  description: Schema.String,
  category: Schema.String,
  source: Schema.String,
  capabilities: Schema.Array(Schema.String),
  brandColor: Schema.optional(Schema.String),
  provides: Schema.Struct({
    skills: Schema.Boolean,
    mcpServers: Schema.Boolean,
    apps: Schema.Boolean,
  }),
  tools: PluginToolsViewSchema,
  hostCapability: Schema.optional(PluginHostCapabilitySchema),
  account: Schema.optional(
    Schema.Struct({
      provider: Schema.Literal("google"),
      id: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
      configured: Schema.Boolean,
      connected: Schema.Boolean,
      email: Schema.NullOr(Schema.String),
    }),
  ),
});

export const PluginRuntimeResponseSchema = Schema.Struct({
  plugins: Schema.Array(PluginRuntimeViewSchema),
});

export const PluginEnabledInputSchema = Schema.Struct({
  enabled: Schema.Boolean,
});
export const PluginActivationInputSchema = Schema.Struct({
  id: Schema.String,
  ...PluginEnabledInputSchema.fields,
});

export type PluginToolState = typeof PluginToolStateSchema.Type;
export type PluginToolsView = typeof PluginToolsViewSchema.Type;
export type PluginHostCapability = typeof PluginHostCapabilitySchema.Type;
export type PluginRuntimeView = typeof PluginRuntimeViewSchema.Type;
export type PluginRuntimeResponse = typeof PluginRuntimeResponseSchema.Type;
export type PluginEnabledInput = typeof PluginEnabledInputSchema.Type;
export type PluginActivationInput = typeof PluginActivationInputSchema.Type;
export type PluginActivationResult = {
  plugins: PluginRuntimeView[];
  connectorIds: string[];
};
