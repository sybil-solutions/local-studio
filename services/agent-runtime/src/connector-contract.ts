import { Schema } from "effect";

const StringRecordSchema = Schema.Record(Schema.String, Schema.String);

export const ConnectorRiskSchema = Schema.Union([
  Schema.Literal("read"),
  Schema.Literal("mutating"),
  Schema.Literal("critical"),
]);

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
  cwd: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(StringRecordSchema),
  auth: Schema.optional(ConnectorAuthReferenceSchema),
  allowTools: Schema.optional(Schema.Array(Schema.String)),
  permissionReviewed: Schema.optional(Schema.Boolean),
  origin: Schema.optional(ConnectorOriginSchema),
  enabled: Schema.Boolean,
};

const ConnectorConfigSchema = Schema.Struct(ConnectorFields);
export const ConnectorViewSchema = Schema.Struct({
  ...ConnectorFields,
  allowTools: Schema.Array(Schema.String),
  permissionReviewed: Schema.Boolean,
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
  cwd: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(StringRecordSchema),
  allowTools: Schema.optional(Schema.Array(Schema.String)),
  permissionReviewed: Schema.optional(Schema.Boolean),
  catalogId: Schema.optional(
    Schema.Union([Schema.Literal("github"), Schema.Literal("x"), Schema.Literal("computer")]),
  ),
  enabled: Schema.optional(Schema.Boolean),
});
export const ConnectorToolPermissionSchema = Schema.Struct({
  name: Schema.String,
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
  error: Schema.optional(Schema.String),
});
export const ConnectorSshPathResponseSchema = Schema.Struct({
  path: Schema.NullOr(Schema.String),
});

export type ConnectorJson = Schema.Json;
export const ConnectorArgumentsSchema = Schema.Record(Schema.String, Schema.Json);
export const ConnectorToolCallSchema = Schema.Struct({
  session_id: Schema.String,
  connector_id: Schema.String,
  tool: Schema.String,
  args: Schema.optional(ConnectorArgumentsSchema),
});

export type ConnectorOrigin = typeof ConnectorOriginSchema.Type;
export type ConnectorAuthReference = typeof ConnectorAuthReferenceSchema.Type;
export type ConnectorConfig = typeof ConnectorConfigSchema.Type;
export type ConnectorView = typeof ConnectorViewSchema.Type;
export type ConnectorRisk = typeof ConnectorRiskSchema.Type;
export type ConnectorArguments = typeof ConnectorArgumentsSchema.Type;
export type ConnectorToolPermission = typeof ConnectorToolPermissionSchema.Type;
export type ConnectorApprovalView = {
  id: string;
  connectorName: string;
  tool: string;
  risk: ConnectorRisk;
  argumentSummary: string[];
};
export type ConnectorApprovalBridge = {
  execute(input: {
    sessionId: string;
    connectorId: string;
    tool: string;
    args: unknown;
    signal?: AbortSignal;
    approve?: (view: ConnectorApprovalView) => Promise<boolean>;
  }): Promise<unknown>;
  cancel(sessionId: string): number;
};
