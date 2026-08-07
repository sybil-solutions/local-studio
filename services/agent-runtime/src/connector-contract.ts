import { Schema } from "effect";

export const CONNECTOR_MASK_TOKEN = "••••••••";

const MaskableStringRecordSchema = Schema.Record(Schema.String, Schema.String);
const ConnectorSecretSchema = Schema.String.check(
  Schema.makeFilter((value) => value !== CONNECTOR_MASK_TOKEN, {
    expected: "a raw connector secret",
  }),
);
const RawSecretRecordSchema = Schema.Record(Schema.String, ConnectorSecretSchema);

function connectorUrlAuthority(value: string): string | null {
  return /^[A-Za-z][A-Za-z\d+.-]*:\/\/([^/?#]*)/.exec(value)?.[1] ?? null;
}

function isConnectorHttpUrl(value: string): boolean {
  const authority = connectorUrlAuthority(value);
  if (!authority || authority.includes("@")) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

export const ConnectorHttpUrlSchema = Schema.String.check(
  Schema.makeFilter(isConnectorHttpUrl, {
    expected: "an HTTP(S) connector URL without credentials",
  }),
);

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
  env: Schema.optional(RawSecretRecordSchema),
  cwd: Schema.optional(Schema.String),
  url: Schema.optional(ConnectorHttpUrlSchema),
  headers: Schema.optional(RawSecretRecordSchema),
  auth: Schema.optional(ConnectorAuthReferenceSchema),
  allowTools: Schema.optional(Schema.Array(Schema.String)),
  origin: Schema.optional(ConnectorOriginSchema),
  enabled: Schema.Boolean,
};

export const ConnectorConfigSchema = Schema.Struct(ConnectorFields);
export const ConnectorViewSchema = Schema.Struct({
  ...ConnectorFields,
  env: Schema.optional(MaskableStringRecordSchema),
  headers: Schema.optional(MaskableStringRecordSchema),
  secret_keys: Schema.Struct({
    env: Schema.Array(Schema.String),
    headers: Schema.Array(Schema.String),
  }),
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
  env: Schema.optional(MaskableStringRecordSchema),
  cwd: Schema.optional(Schema.String),
  url: Schema.optional(ConnectorHttpUrlSchema),
  headers: Schema.optional(MaskableStringRecordSchema),
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
export type ConnectorUpsertInput = typeof ConnectorUpsertInputSchema.Type;
export type ConnectorView = typeof ConnectorViewSchema.Type;
