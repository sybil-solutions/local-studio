import { Schema } from "effect";

export const GITHUB_CONNECTOR_TOKEN_KEY = "GITHUB_PERSONAL_ACCESS_TOKEN";

const StringRecordSchema = Schema.Record(Schema.String, Schema.String);

const ConnectorOriginSchema = Schema.Struct({
  kind: Schema.String,
  id: Schema.String,
  version: Schema.optional(Schema.String),
  binding: Schema.optional(Schema.String),
  artifactDigest: Schema.optional(Schema.String),
  configurationDigest: Schema.optional(Schema.String),
  snapshotDigest: Schema.optional(Schema.String),
  runtimeDigest: Schema.optional(Schema.String),
  sourceDigest: Schema.optional(Schema.String),
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
  cwd: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(StringRecordSchema),
  auth: Schema.optional(ConnectorAuthReferenceSchema),
  allowTools: Schema.optional(Schema.Array(Schema.String)),
  origin: Schema.optional(ConnectorOriginSchema),
  enabled: Schema.Boolean,
};

const ConnectorConfigSchema = Schema.Struct(ConnectorFields);
const ConnectorOriginViewSchema = Schema.Struct({
  kind: Schema.String,
  id: Schema.String,
  version: Schema.optional(Schema.String),
  binding: Schema.optional(Schema.String),
});
export const ConnectorViewSchema = Schema.Struct({
  ...ConnectorFields,
  origin: Schema.optional(ConnectorOriginViewSchema),
  secret_keys: Schema.Array(Schema.String),
});
export const ConnectorsFileSchema = Schema.Struct({
  connectors: Schema.optional(Schema.Array(ConnectorConfigSchema)),
});
export const ConnectorsResponseSchema = Schema.Struct({
  connectors: Schema.Array(ConnectorViewSchema),
});
export const GitHubConnectorArtifactStatusSchema = Schema.Struct({
  version: Schema.String,
  target: Schema.String,
  state: Schema.Union([
    Schema.Literal("installed"),
    Schema.Literal("not-installed"),
    Schema.Literal("invalid"),
    Schema.Literal("unsupported"),
  ]),
});
const CatalogConnectorUpsertInputSchema = Schema.Struct({
  id: Schema.Literal("github"),
  catalogId: Schema.Literal("github"),
  env: Schema.optional(StringRecordSchema),
  enabled: Schema.optional(Schema.Boolean),
});
const CustomConnectorUpsertInputSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  transport: Schema.Union([Schema.Literal("stdio"), Schema.Literal("http")]),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(StringRecordSchema),
  cwd: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(StringRecordSchema),
  allowTools: Schema.optional(Schema.Array(Schema.String)),
  enabled: Schema.optional(Schema.Boolean),
});
export const ConnectorUpsertInputSchema = Schema.Union([
  CatalogConnectorUpsertInputSchema,
  CustomConnectorUpsertInputSchema,
]);
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
export type GitHubConnectorArtifactStatus = typeof GitHubConnectorArtifactStatusSchema.Type;
