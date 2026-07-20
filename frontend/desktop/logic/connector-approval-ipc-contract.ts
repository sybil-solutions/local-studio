import { Schema } from "effect";

const RequestChannelSchema = Schema.Literal("local-studio:desktop-private:request");
const ResponseChannelSchema = Schema.Literal("local-studio:desktop-private:response");
const DecisionSchema = Schema.Union([Schema.Literal("approve"), Schema.Literal("deny")]);
const ResponseOperationSchema = Schema.Union([
  Schema.Literal("list-approvals"),
  Schema.Literal("prepare-approval"),
  Schema.Literal("arm-approval"),
  Schema.Literal("list-connectors"),
  Schema.Literal("save-connector"),
  Schema.Literal("remove-connector"),
  Schema.Literal("probe-connector"),
  Schema.Literal("list-plugins"),
  Schema.Literal("set-plugin-enabled"),
  Schema.Literal("github-artifact-status"),
  Schema.Literal("install-github-artifact"),
  Schema.Literal("get-google-account"),
  Schema.Literal("save-google-client"),
  Schema.Literal("disconnect-google-account"),
  Schema.Literal("begin-google-authorization"),
  Schema.Literal("cancel-google-authorization"),
]);

export const ConnectorApprovalListBridgeInputSchema = Schema.Literal("list");

export const ConnectorApprovalDecisionBridgeInputSchema = Schema.Struct({
  request_id: Schema.String,
  decision: DecisionSchema,
});

export const ConnectorListBridgeInputSchema = Schema.Literal("list");
export const ConnectorSaveBridgeInputSchema = Schema.String;
export const ConnectorRemoveBridgeInputSchema = Schema.Struct({ id: Schema.String });
export const ConnectorProbeBridgeInputSchema = Schema.Struct({ id: Schema.String });
export const PluginListBridgeInputSchema = Schema.Literal("list");
export const PluginSetEnabledBridgeInputSchema = Schema.Struct({
  id: Schema.String,
  enabled: Schema.Boolean,
});
export const GitHubArtifactStatusBridgeInputSchema = Schema.Literal("status");
export const GitHubArtifactInstallBridgeInputSchema = Schema.Literal("install");
export const GoogleAccountGetBridgeInputSchema = Schema.Literal("get");
export const GoogleClientSaveBridgeInputSchema = Schema.String;
export const GoogleAccountOperationBridgeInputSchema = Schema.Struct({
  account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
});

export const ConnectorApprovalProcessRequestSchema = Schema.Union([
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("list-approvals"),
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("prepare-approval"),
    transaction_id: Schema.String,
    input: ConnectorApprovalDecisionBridgeInputSchema,
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("arm-approval"),
    transaction_id: Schema.String,
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("commit-approval"),
    transaction_id: Schema.String,
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("cancel-approval"),
    transaction_id: Schema.String,
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("list-connectors"),
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("save-connector"),
    payload: Schema.String,
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("remove-connector"),
    connector_id: Schema.String,
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("probe-connector"),
    connector_id: Schema.String,
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("list-plugins"),
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("set-plugin-enabled"),
    plugin_id: Schema.String,
    enabled: Schema.Boolean,
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("github-artifact-status"),
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("install-github-artifact"),
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("get-google-account"),
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("save-google-client"),
    payload: Schema.String,
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("disconnect-google-account"),
    account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("begin-google-authorization"),
    account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
  }),
  Schema.Struct({
    channel: RequestChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("cancel-google-authorization"),
    account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
  }),
]);

export const ConnectorApprovalProcessResponseSchema = Schema.Union([
  Schema.Struct({
    channel: ResponseChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("list-approvals"),
    ok: Schema.Literal(true),
    result: Schema.Unknown,
  }),
  Schema.Struct({
    channel: ResponseChannelSchema,
    id: Schema.String,
    operation: Schema.Union([
      Schema.Literal("probe-connector"),
      Schema.Literal("list-plugins"),
      Schema.Literal("set-plugin-enabled"),
      Schema.Literal("github-artifact-status"),
      Schema.Literal("install-github-artifact"),
      Schema.Literal("get-google-account"),
      Schema.Literal("save-google-client"),
      Schema.Literal("disconnect-google-account"),
      Schema.Literal("begin-google-authorization"),
      Schema.Literal("cancel-google-authorization"),
    ]),
    ok: Schema.Literal(true),
    result: Schema.String,
  }),
  Schema.Struct({
    channel: ResponseChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("prepare-approval"),
    ok: Schema.Literal(true),
    result: Schema.Struct({ prepared: Schema.Literal(true) }),
  }),
  Schema.Struct({
    channel: ResponseChannelSchema,
    id: Schema.String,
    operation: Schema.Literal("arm-approval"),
    ok: Schema.Literal(true),
    result: Schema.Struct({ armed: Schema.Literal(true) }),
  }),
  Schema.Struct({
    channel: ResponseChannelSchema,
    id: Schema.String,
    operation: Schema.Union([
      Schema.Literal("list-connectors"),
      Schema.Literal("save-connector"),
      Schema.Literal("remove-connector"),
    ]),
    ok: Schema.Literal(true),
    result: Schema.Unknown,
  }),
  Schema.Struct({
    channel: ResponseChannelSchema,
    id: Schema.String,
    operation: ResponseOperationSchema,
    ok: Schema.Literal(false),
    error: Schema.String,
  }),
]);

export const ConnectorApprovalProcessResponseTagSchema = Schema.Struct({
  channel: ResponseChannelSchema,
});

export const ConnectorApprovalProcessRequestTagSchema = Schema.Struct({
  channel: RequestChannelSchema,
});

const exact = { onExcessProperty: "error" } as const;
const preserve = { onExcessProperty: "preserve" } as const;

export const decodeConnectorApprovalListBridgeInput = Schema.decodeUnknownSync(
  ConnectorApprovalListBridgeInputSchema,
  exact,
);

export const decodeConnectorApprovalDecisionBridgeInput = Schema.decodeUnknownSync(
  ConnectorApprovalDecisionBridgeInputSchema,
  exact,
);

export const decodeConnectorListBridgeInput = Schema.decodeUnknownSync(
  ConnectorListBridgeInputSchema,
  exact,
);

export const decodeConnectorSaveBridgeInput = Schema.decodeUnknownSync(
  ConnectorSaveBridgeInputSchema,
  exact,
);

export const decodeConnectorRemoveBridgeInput = Schema.decodeUnknownSync(
  ConnectorRemoveBridgeInputSchema,
  exact,
);

export const decodeConnectorProbeBridgeInput = Schema.decodeUnknownSync(
  ConnectorProbeBridgeInputSchema,
  exact,
);

export const decodePluginListBridgeInput = Schema.decodeUnknownSync(
  PluginListBridgeInputSchema,
  exact,
);

export const decodePluginSetEnabledBridgeInput = Schema.decodeUnknownSync(
  PluginSetEnabledBridgeInputSchema,
  exact,
);

export const decodeGitHubArtifactStatusBridgeInput = Schema.decodeUnknownSync(
  GitHubArtifactStatusBridgeInputSchema,
  exact,
);

export const decodeGitHubArtifactInstallBridgeInput = Schema.decodeUnknownSync(
  GitHubArtifactInstallBridgeInputSchema,
  exact,
);

export const decodeGoogleAccountGetBridgeInput = Schema.decodeUnknownSync(
  GoogleAccountGetBridgeInputSchema,
  exact,
);

export const decodeGoogleClientSaveBridgeInput = Schema.decodeUnknownSync(
  GoogleClientSaveBridgeInputSchema,
  exact,
);

export const decodeGoogleAccountOperationBridgeInput = Schema.decodeUnknownSync(
  GoogleAccountOperationBridgeInputSchema,
  exact,
);

export const decodeConnectorApprovalProcessRequest = Schema.decodeUnknownSync(
  ConnectorApprovalProcessRequestSchema,
  exact,
);

export const decodeConnectorApprovalProcessResponse = Schema.decodeUnknownSync(
  ConnectorApprovalProcessResponseSchema,
  exact,
);

export const decodeConnectorApprovalProcessResponseTag = Schema.decodeUnknownOption(
  ConnectorApprovalProcessResponseTagSchema,
  preserve,
);

export const decodeConnectorApprovalProcessRequestTag = Schema.decodeUnknownOption(
  ConnectorApprovalProcessRequestTagSchema,
  preserve,
);

export type ConnectorApprovalProcessRequest = typeof ConnectorApprovalProcessRequestSchema.Type;
export type ConnectorApprovalProcessResponse = typeof ConnectorApprovalProcessResponseSchema.Type;
