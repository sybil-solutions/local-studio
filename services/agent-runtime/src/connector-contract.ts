import { Schema } from "effect";

const StringRecordSchema = Schema.Record(Schema.String, Schema.String);

/**
 * Explicit secretness, keyed by env/header name: `true` masks the value in
 * every read surface, `false` never masks it. A key absent from the record —
 * including every entry written before this field existed — falls back to the
 * name heuristic the store used historically, so old files keep their meaning.
 */
const SecretFlagsSchema = Schema.Record(Schema.String, Schema.Boolean);

const ConnectorOriginSchema = Schema.Struct({
  kind: Schema.String,
  id: Schema.String,
  version: Schema.optional(Schema.String),
  binding: Schema.optional(Schema.String),
});

const ConnectorAuthReferenceSchema = Schema.Struct({
  type: Schema.Literal("oauth"),
  provider: Schema.String,
  account: Schema.String,
});

const ConnectorFields = {
  id: Schema.String,
  name: Schema.String,
  transport: Schema.Union([Schema.Literal("stdio"), Schema.Literal("http")]),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(StringRecordSchema),
  envSecret: Schema.optional(SecretFlagsSchema),
  cwd: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(StringRecordSchema),
  headerSecret: Schema.optional(SecretFlagsSchema),
  auth: Schema.optional(ConnectorAuthReferenceSchema),
  allowTools: Schema.optional(Schema.Array(Schema.String)),
  origin: Schema.optional(ConnectorOriginSchema),
  enabled: Schema.Boolean,
};

const ConnectorConfigSchema = Schema.Struct(ConnectorFields);
export const ConnectorViewSchema = Schema.Struct({
  ...ConnectorFields,
  secret_keys: Schema.Array(Schema.String),
});
export const ConnectorsFileSchema = Schema.Struct({
  connectors: Schema.optional(Schema.Array(ConnectorConfigSchema)),
});
export const ConnectorsResponseSchema = Schema.Struct({
  connectors: Schema.Array(ConnectorViewSchema),
});
export const ConnectorUpsertInputSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  transport: Schema.Union([Schema.Literal("stdio"), Schema.Literal("http")]),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(StringRecordSchema),
  envSecret: Schema.optional(SecretFlagsSchema),
  cwd: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(StringRecordSchema),
  headerSecret: Schema.optional(SecretFlagsSchema),
  allowTools: Schema.optional(Schema.Array(Schema.String)),
  enabled: Schema.optional(Schema.Boolean),
});
export const ConnectorTestInputSchema = Schema.Struct({ id: Schema.String });
export const ConnectorTestResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  tool_count: Schema.Number,
  tool_names: Schema.Array(Schema.String),
  error: Schema.optional(Schema.String),
});
export const ConnectorSshPathResponseSchema = Schema.Struct({
  path: Schema.NullOr(Schema.String),
});

export type ConnectorOrigin = typeof ConnectorOriginSchema.Type;
export type ConnectorAuthReference = typeof ConnectorAuthReferenceSchema.Type;
export type ConnectorConfig = typeof ConnectorConfigSchema.Type;
export type ConnectorView = typeof ConnectorViewSchema.Type;
