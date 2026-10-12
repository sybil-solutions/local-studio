import { Schema } from "effect";

/** `*` grants every model, which is what enabling a connector means by default. */
export const EVERY_MODEL = "*";

const GrantedToolsSchema = Schema.Union([Schema.Literal("all"), Schema.Array(Schema.String)]);

export const ConnectorGrantSchema = Schema.Struct({
  modelId: Schema.String,
  connectorId: Schema.String,
  tools: GrantedToolsSchema,
  createdAt: Schema.String,
});

export const ConnectorGrantsFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  /**
   * Connectors that have already been given their opening grant. Kept apart
   * from `grants` so that revoking every model's access to a connector sticks
   * instead of being re-seeded on the next read.
   */
  seeded: Schema.Array(Schema.String),
  grants: Schema.Array(ConnectorGrantSchema),
});

export const ConnectorGrantTargetSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tools: Schema.Array(Schema.String),
});

export const ConnectorGrantsResponseSchema = Schema.Struct({
  grants: Schema.Array(ConnectorGrantSchema),
  connectors: Schema.Array(ConnectorGrantTargetSchema),
});

export const ConnectorGrantInputSchema = Schema.Struct({
  modelId: Schema.String,
  connectorId: Schema.String,
  tools: GrantedToolsSchema,
});

export const ConnectorGrantRemovalSchema = Schema.Struct({
  modelId: Schema.String,
  connectorId: Schema.String,
});

export type ConnectorGrant = typeof ConnectorGrantSchema.Type;
export type ConnectorGrantTarget = typeof ConnectorGrantTargetSchema.Type;
export type ConnectorGrantInput = typeof ConnectorGrantInputSchema.Type;
