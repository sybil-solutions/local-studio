import { Schema } from "effect";

const StringRecordSchema = Schema.Record(Schema.String, Schema.String);

export const ConnectorRiskSchema = Schema.Union([
  Schema.Literal("read"),
  Schema.Literal("mutating"),
  Schema.Literal("critical"),
]);

export const ConnectorApprovalStateSchema = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("approved"),
  Schema.Literal("denied"),
  Schema.Literal("expired"),
  Schema.Literal("consumed"),
  Schema.Literal("cancelled"),
]);

const ConnectorExecutableFileSchema = Schema.Struct({
  index: Schema.Number,
  source: Schema.String,
  path: Schema.String,
  snapshotArgument: Schema.String,
  snapshotPath: Schema.String,
  digest: Schema.String,
  mode: Schema.Number,
});

const ConnectorExecutableBindingSchema = Schema.Struct({
  format: Schema.Literal("local-studio-executable-v1"),
  command: Schema.String,
  resolvedCommand: Schema.String,
  snapshotCommand: Schema.String,
  commandDigest: Schema.String,
  commandMode: Schema.Number,
  runtimeDigest: Schema.optional(Schema.String),
  sourceRoot: Schema.String,
  sourceCwd: Schema.String,
  snapshotRoot: Schema.String,
  snapshotCwd: Schema.String,
  artifactDigest: Schema.String,
  artifactContentDigest: Schema.String,
  snapshotDigest: Schema.String,
  digest: Schema.String,
  files: Schema.Array(ConnectorExecutableFileSchema),
});

const ConnectorOriginSchema = Schema.Struct({
  kind: Schema.String,
  id: Schema.String,
  version: Schema.optional(Schema.String),
  binding: Schema.optional(Schema.String),
  artifactDigest: Schema.optional(Schema.String),
  inventoryDigest: Schema.optional(Schema.String),
  executable: Schema.optional(ConnectorExecutableBindingSchema),
});

const ConnectorAuthReferenceSchema = Schema.Struct({
  type: Schema.Literal("oauth"),
  provider: Schema.String,
  account: Schema.String,
});

const StoredConnectorFields = {
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
  permissionReviewed: Schema.optional(Schema.Boolean),
  origin: Schema.optional(ConnectorOriginSchema),
  enabled: Schema.Boolean,
};

const ConnectorFields = {
  ...StoredConnectorFields,
  allowTools: Schema.Array(Schema.String),
  permissionReviewed: Schema.Boolean,
};

export const StoredConnectorConfigSchema = Schema.Struct(StoredConnectorFields);
export const ConnectorConfigSchema = Schema.Struct(ConnectorFields);
export const ConnectorViewSchema = Schema.Struct({
  ...ConnectorFields,
  secret_keys: Schema.Array(Schema.String),
});
export const ConnectorsFileSchema = Schema.Struct({
  connectors: Schema.optional(Schema.Array(StoredConnectorConfigSchema)),
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
const ConnectorGrantInputFields = {
  id: Schema.String,
  name: Schema.optional(Schema.String),
  env: Schema.optional(StringRecordSchema),
  allowTools: Schema.optional(Schema.Array(Schema.String)),
  permissionReviewed: Schema.optional(Schema.Boolean),
  enabled: Schema.optional(Schema.Boolean),
};

const CatalogConnectorUpsertInputSchema = Schema.Struct({
  ...ConnectorGrantInputFields,
  catalogId: Schema.Union([
    Schema.Literal("github"),
    Schema.Literal("x"),
    Schema.Literal("computer"),
  ]),
});

const CustomConnectorUpsertInputSchema = Schema.Struct({
  ...ConnectorGrantInputFields,
  transport: Schema.Union([Schema.Literal("stdio"), Schema.Literal("http")]),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  cwd: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(StringRecordSchema),
  reviewedArtifactDigest: Schema.optional(Schema.String),
  reviewedInventoryDigest: Schema.optional(Schema.String),
});

export const ConnectorUpsertInputSchema = Schema.Union([
  CatalogConnectorUpsertInputSchema,
  CustomConnectorUpsertInputSchema,
]);

export const ConnectorToolPermissionSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  risk: ConnectorRiskSchema,
  granted: Schema.Boolean,
  default_granted: Schema.Boolean,
});

export const ConnectorTestInputSchema = Schema.Struct({ id: Schema.String });
export const ConnectorTestResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  tool_count: Schema.Number,
  tool_names: Schema.Array(Schema.String),
  tools: Schema.Array(ConnectorToolPermissionSchema),
  artifact_digest: Schema.optional(Schema.String),
  inventory_digest: Schema.String,
  error: Schema.optional(Schema.String),
});
export const ConnectorSshPathResponseSchema = Schema.Struct({
  path: Schema.NullOr(Schema.String),
});

export type ConnectorJson =
  | null
  | boolean
  | number
  | string
  | readonly ConnectorJson[]
  | { readonly [key: string]: ConnectorJson };

export const ConnectorJsonSchema: Schema.Codec<ConnectorJson> = Schema.suspend(
  (): Schema.Codec<ConnectorJson> =>
    Schema.Union([
      Schema.Null,
      Schema.Boolean,
      Schema.Finite,
      Schema.String,
      Schema.Array(ConnectorJsonSchema),
      Schema.Record(Schema.String, ConnectorJsonSchema),
    ]),
);

export const ConnectorArgumentsSchema = Schema.Record(Schema.String, ConnectorJsonSchema);

const ConnectorInventoryToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  inputSchema: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  risk: ConnectorRiskSchema,
});

const ConnectorInventoryEntrySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tools: Schema.Array(ConnectorInventoryToolSchema),
  error: Schema.optional(Schema.String),
});

export const ConnectorInventoryResponseSchema = Schema.Struct({
  connectors: Schema.Array(ConnectorInventoryEntrySchema),
});

export const ConnectorToolCallSchema = Schema.Struct({
  session_id: Schema.String,
  connector_id: Schema.String,
  tool: Schema.String,
  args: Schema.optional(ConnectorArgumentsSchema),
});

export const ConnectorToolCallResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
});

export const ConnectorApprovalArgumentSummarySchema = Schema.Struct({
  path: Schema.String,
  type: Schema.String,
  detail: Schema.optional(Schema.String),
});

export const ConnectorApprovalViewSchema = Schema.Struct({
  id: Schema.String,
  session_id: Schema.String,
  connector_id: Schema.String,
  connector_name: Schema.String,
  tool: Schema.String,
  risk: ConnectorRiskSchema,
  status: ConnectorApprovalStateSchema,
  argument_summary: Schema.Array(ConnectorApprovalArgumentSummarySchema),
  created_at: Schema.String,
  expires_at: Schema.String,
});

export const ConnectorApprovalsResponseSchema = Schema.Struct({
  approvals: Schema.Array(ConnectorApprovalViewSchema),
});

export const ConnectorApprovalDecisionSchema = Schema.Struct({
  request_id: Schema.String,
  decision: Schema.Union([Schema.Literal("approve"), Schema.Literal("deny")]),
});

export type ConnectorOrigin = typeof ConnectorOriginSchema.Type;
export type ConnectorExecutableBinding = typeof ConnectorExecutableBindingSchema.Type;
export type ConnectorAuthReference = typeof ConnectorAuthReferenceSchema.Type;
export type StoredConnectorConfig = typeof StoredConnectorConfigSchema.Type;
export type ConnectorConfig = typeof ConnectorConfigSchema.Type;
export type ConnectorView = typeof ConnectorViewSchema.Type;
export type GitHubConnectorArtifactStatus = typeof GitHubConnectorArtifactStatusSchema.Type;
export type ConnectorRisk = typeof ConnectorRiskSchema.Type;
export type ConnectorApprovalState = typeof ConnectorApprovalStateSchema.Type;
export type ConnectorArguments = typeof ConnectorArgumentsSchema.Type;
export type ConnectorToolPermission = typeof ConnectorToolPermissionSchema.Type;
export type ConnectorTestResponse = typeof ConnectorTestResponseSchema.Type;
export type ConnectorApprovalView = typeof ConnectorApprovalViewSchema.Type;
