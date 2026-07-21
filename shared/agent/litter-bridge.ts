import { Schema } from "effect";

export const LITTER_BRIDGE_PROTOCOL_VERSION = 1 as const;
export const LITTER_BRIDGE_CAPABILITIES = [
  "stats.read",
  "models.control",
  "sessions.read",
  "sessions.write",
  "agent.turn",
] as const;

export const LitterBridgeParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const strict = <S extends Schema.Top>(schema: S): S["Rebuild"] =>
  Schema.annotate<S>({ parseOptions: LitterBridgeParseOptions })(schema);
const NonNegativeIntegerSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const PositiveIntegerSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)));
const NonNegativeNumberSchema = Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const PercentageSchema = Schema.Finite.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100)),
);
const IdentifierSchema = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isMaxLength(512)),
);
const ShortTextSchema = Schema.String.pipe(Schema.check(Schema.isMaxLength(4_096)));
const WireTextSchema = Schema.String.pipe(Schema.check(Schema.isMaxLength(4_000_000)));
const JsonTextSchema = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(1_000_000),
    Schema.makeFilter<string>((input) => {
      try {
        JSON.parse(input);
        return undefined;
      } catch {
        return "Expected bounded JSON text";
      }
    }),
  ),
);
const OpaqueTokenSchema = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isMaxLength(2_048)),
);
const TimestampSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/)),
);
const NonceSchema = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isLengthBetween(16, 512),
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
  ),
);
const SignatureSchema = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isLengthBetween(43, 512),
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
  ),
);
const Sha256Schema = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)));

export const LitterBridgeProtocolVersionSchema = Schema.Literal(LITTER_BRIDGE_PROTOCOL_VERSION);
export const LitterBridgeCapabilitySchema = Schema.Literals(LITTER_BRIDGE_CAPABILITIES);
export const LitterBridgeRevisionSchema = NonNegativeIntegerSchema;
export const LitterBridgeTimestampSchema = TimestampSchema;
export const LitterBridgeContentHashSchema = Sha256Schema;

export const LitterBridgeDeviceAuthSchema = Schema.Struct({
  deviceId: IdentifierSchema,
  keyId: IdentifierSchema,
  algorithm: Schema.Literal("ed25519"),
}).pipe(strict);

const RequestAuthFields = {
  device: LitterBridgeDeviceAuthSchema,
  requestId: IdentifierSchema,
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  nonce: NonceSchema,
  bodyHash: Sha256Schema,
  signature: SignatureSchema,
};

export const LitterBridgeRequestAuthSchema = Schema.Struct({
  ...RequestAuthFields,
  capability: LitterBridgeCapabilitySchema,
}).pipe(strict);

export const LitterBridgeMutationAuthSchema = Schema.Struct({
  ...RequestAuthFields,
  capability: LitterBridgeCapabilitySchema,
  idempotencyKey: IdentifierSchema,
}).pipe(strict);

const StatsReadAuthSchema = Schema.Struct({
  ...RequestAuthFields,
  capability: Schema.Literal("stats.read"),
}).pipe(strict);
const ModelsControlAuthSchema = Schema.Struct({
  ...RequestAuthFields,
  capability: Schema.Literal("models.control"),
  idempotencyKey: IdentifierSchema,
}).pipe(strict);
const SessionsReadAuthSchema = Schema.Struct({
  ...RequestAuthFields,
  capability: Schema.Literal("sessions.read"),
}).pipe(strict);
const SessionsWriteAuthSchema = Schema.Struct({
  ...RequestAuthFields,
  capability: Schema.Literal("sessions.write"),
  idempotencyKey: IdentifierSchema,
}).pipe(strict);
const AgentTurnAuthSchema = Schema.Struct({
  ...RequestAuthFields,
  capability: Schema.Literal("agent.turn"),
  idempotencyKey: IdentifierSchema,
}).pipe(strict);

export const LitterBridgeSectionNameSchema = Schema.Literals([
  "health",
  "status",
  "gpus",
  "metrics",
  "agent-runtime",
]);

export const LitterBridgeErrorCodeSchema = Schema.Literals([
  "invalid_request",
  "unauthorized",
  "forbidden",
  "expired_request",
  "replay_detected",
  "unsupported_version",
  "capability_denied",
  "not_found",
  "revision_conflict",
  "rate_limited",
  "payload_too_large",
  "integrity_failed",
  "controller_unavailable",
  "section_unavailable",
  "agent_runtime_unavailable",
  "internal",
]);

export const LitterBridgeErrorDetailsSchema = Schema.Struct({
  field: Schema.NullOr(IdentifierSchema),
  section: Schema.NullOr(LitterBridgeSectionNameSchema),
  expectedRevision: Schema.NullOr(LitterBridgeRevisionSchema),
  currentRevision: Schema.NullOr(LitterBridgeRevisionSchema),
  retryAfterMs: Schema.NullOr(NonNegativeIntegerSchema),
  limitBytes: Schema.NullOr(NonNegativeIntegerSchema),
}).pipe(strict);

export const LitterBridgeErrorSchema = Schema.Struct({
  code: LitterBridgeErrorCodeSchema,
  message: ShortTextSchema,
  retriable: Schema.Boolean,
  requestId: Schema.NullOr(IdentifierSchema),
  details: Schema.NullOr(LitterBridgeErrorDetailsSchema),
}).pipe(strict);

export const LitterBridgeErrorResultSchema = Schema.Struct({
  type: Schema.Literal("error"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  requestId: IdentifierSchema,
  error: LitterBridgeErrorSchema,
}).pipe(strict);

export const LitterBridgeFreshnessSchema = Schema.Struct({
  observedAt: Schema.NullOr(TimestampSchema),
  ageMs: Schema.NullOr(NonNegativeIntegerSchema),
  maxAgeMs: NonNegativeIntegerSchema,
  stale: Schema.Boolean,
  sourceRevision: Schema.NullOr(LitterBridgeRevisionSchema),
}).pipe(strict);

const sectionSchema = <S extends Schema.Constraint>(value: S) =>
  Schema.Struct({
    value: Schema.NullOr(value),
    error: Schema.NullOr(LitterBridgeErrorSchema),
    freshness: LitterBridgeFreshnessSchema,
  }).pipe(strict);

export const LitterBridgeControllerHealthSchema = Schema.Struct({
  state: Schema.Literals(["ok", "degraded", "unavailable"]),
  reachable: Schema.Boolean,
  checkedAt: TimestampSchema,
  latencyMs: Schema.NullOr(NonNegativeNumberSchema),
  controllerVersion: Schema.NullOr(IdentifierSchema),
}).pipe(strict);

export const LitterBridgeControllerStatusSchema = Schema.Struct({
  running: Schema.Boolean,
  inferencePort: Schema.NullOr(PositiveIntegerSchema),
  launchingRecipeId: Schema.NullOr(IdentifierSchema),
  activeLaunchId: Schema.NullOr(IdentifierSchema),
  activeModelIds: Schema.Array(IdentifierSchema),
}).pipe(strict);

export const LitterBridgeGpuDeviceSchema = Schema.Struct({
  id: IdentifierSchema,
  index: NonNegativeIntegerSchema,
  name: IdentifierSchema,
  memoryTotalBytes: NonNegativeIntegerSchema,
  memoryUsedBytes: Schema.NullOr(NonNegativeIntegerSchema),
  memoryFreeBytes: Schema.NullOr(NonNegativeIntegerSchema),
  utilizationPercent: Schema.NullOr(PercentageSchema),
  temperatureCelsius: Schema.NullOr(Schema.Finite),
  powerWatts: Schema.NullOr(NonNegativeNumberSchema),
}).pipe(strict);

export const LitterBridgeGpuSnapshotSchema = Schema.Struct({
  count: NonNegativeIntegerSchema,
  devices: Schema.Array(LitterBridgeGpuDeviceSchema),
}).pipe(strict);

export const LitterBridgeMetricsSchema = Schema.Struct({
  requestsActive: Schema.NullOr(NonNegativeIntegerSchema),
  requestsQueued: Schema.NullOr(NonNegativeIntegerSchema),
  promptTokensPerSecond: Schema.NullOr(NonNegativeNumberSchema),
  generationTokensPerSecond: Schema.NullOr(NonNegativeNumberSchema),
  timeToFirstTokenMs: Schema.NullOr(NonNegativeNumberSchema),
  cacheUsagePercent: Schema.NullOr(PercentageSchema),
}).pipe(strict);

export const LitterBridgeAgentRuntimeStatsSchema = Schema.Struct({
  state: Schema.Literals(["ok", "degraded", "unavailable"]),
  reachable: Schema.Boolean,
  runningSessionCount: NonNegativeIntegerSchema,
  activeTurnCount: NonNegativeIntegerSchema,
  persistedSessionCount: Schema.NullOr(NonNegativeIntegerSchema),
  eventSequence: Schema.NullOr(NonNegativeIntegerSchema),
}).pipe(strict);

export const LitterBridgeControllerSnapshotSchema = Schema.Struct({
  type: Schema.Literal("controller_snapshot"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  snapshotId: IdentifierSchema,
  controllerId: IdentifierSchema,
  displayName: IdentifierSchema,
  generatedAt: TimestampSchema,
  revision: LitterBridgeRevisionSchema,
  state: Schema.Literals(["healthy", "degraded", "unavailable"]),
  capabilities: Schema.Array(LitterBridgeCapabilitySchema).pipe(Schema.check(Schema.isUnique())),
  sections: Schema.Struct({
    health: sectionSchema(LitterBridgeControllerHealthSchema),
    status: sectionSchema(LitterBridgeControllerStatusSchema),
    gpus: sectionSchema(LitterBridgeGpuSnapshotSchema),
    metrics: sectionSchema(LitterBridgeMetricsSchema),
    agentRuntime: sectionSchema(LitterBridgeAgentRuntimeStatsSchema),
  }).pipe(strict),
}).pipe(strict);

export const LitterBridgeCapabilitiesManifestSchema = Schema.Struct({
  type: Schema.Literal("capabilities"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  bridgeId: IdentifierSchema,
  controllerId: IdentifierSchema,
  issuedAt: TimestampSchema,
  capabilities: Schema.Array(LitterBridgeCapabilitySchema).pipe(Schema.check(Schema.isUnique())),
}).pipe(strict);

export const LitterBridgeControllerSnapshotRequestSchema = Schema.Struct({
  type: Schema.Literal("controller_snapshot_request"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  auth: StatsReadAuthSchema,
  controllerId: IdentifierSchema,
}).pipe(strict);

export const LitterBridgeControllerActionSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("start_recipe"),
    recipeId: IdentifierSchema,
  }).pipe(strict),
  Schema.Struct({
    type: Schema.Literal("cancel_launch"),
    launchId: IdentifierSchema,
  }).pipe(strict),
  Schema.Struct({
    type: Schema.Literal("evict_model"),
    modelId: IdentifierSchema,
  }).pipe(strict),
]).pipe(strict);

export const LitterBridgeControllerActionRequestSchema = Schema.Struct({
  type: Schema.Literal("controller_action_request"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  auth: ModelsControlAuthSchema,
  controllerId: IdentifierSchema,
  expectedRevision: LitterBridgeRevisionSchema,
  action: LitterBridgeControllerActionSchema,
}).pipe(strict);

export const LitterBridgeControllerResourceSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("recipe_launch"),
    recipeId: IdentifierSchema,
    launchId: IdentifierSchema,
  }).pipe(strict),
  Schema.Struct({
    type: Schema.Literal("launch"),
    launchId: IdentifierSchema,
  }).pipe(strict),
  Schema.Struct({
    type: Schema.Literal("model"),
    modelId: IdentifierSchema,
  }).pipe(strict),
]).pipe(strict);

export const LitterBridgeControllerActionAckSchema = Schema.Struct({
  type: Schema.Literal("controller_action_ack"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  requestId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  revision: LitterBridgeRevisionSchema,
  acceptedAt: TimestampSchema,
  resource: LitterBridgeControllerResourceSchema,
}).pipe(strict);

export const LitterBridgeSessionAuthoritySchema = Schema.Literals(["local-studio", "litter"]);

export const LitterBridgeExternalSessionIdentitySchema = Schema.Struct({
  kind: Schema.Literal("external_session"),
  authority: LitterBridgeSessionAuthoritySchema,
  installationId: IdentifierSchema,
  sessionId: IdentifierSchema,
}).pipe(strict);

export const LitterBridgeSessionOriginSchema = Schema.Struct({
  application: LitterBridgeSessionAuthoritySchema,
  installationId: IdentifierSchema,
  deviceId: Schema.NullOr(IdentifierSchema),
  exportedAt: TimestampSchema,
}).pipe(strict);

export const LitterBridgeSessionMetadataSchema = Schema.Struct({
  title: Schema.NullOr(ShortTextSchema),
  cwd: Schema.NullOr(IdentifierSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  modelId: Schema.NullOr(IdentifierSchema),
  providerId: Schema.NullOr(IdentifierSchema),
}).pipe(strict);

export const LitterBridgeSessionListCursorSchema = Schema.Struct({
  type: Schema.Literal("session_list_cursor"),
  token: OpaqueTokenSchema,
  revision: LitterBridgeRevisionSchema,
  hasMore: Schema.Boolean,
}).pipe(strict);

export const LitterBridgeSessionDescriptorSchema = Schema.Struct({
  session: LitterBridgeExternalSessionIdentitySchema,
  metadata: LitterBridgeSessionMetadataSchema,
  revision: LitterBridgeRevisionSchema,
  archived: Schema.Boolean,
  active: Schema.Boolean,
}).pipe(strict);

export const LitterBridgeMessageRoleSchema = Schema.Literals([
  "system",
  "user",
  "assistant",
  "tool",
]);

export const LitterBridgeMessagePartSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    text: WireTextSchema,
  }).pipe(strict),
  Schema.Struct({
    type: Schema.Literal("reasoning"),
    text: WireTextSchema,
  }).pipe(strict),
  Schema.Struct({
    type: Schema.Literal("tool_ref"),
    toolCallId: IdentifierSchema,
  }).pipe(strict),
  Schema.Struct({
    type: Schema.Literal("attachment_ref"),
    attachmentId: IdentifierSchema,
  }).pipe(strict),
]).pipe(strict);

export const LitterBridgeMessageDescriptorSchema = Schema.Struct({
  messageId: IdentifierSchema,
  parentMessageId: Schema.NullOr(IdentifierSchema),
  sequence: NonNegativeIntegerSchema,
  role: LitterBridgeMessageRoleSchema,
  createdAt: TimestampSchema,
  editedAt: Schema.NullOr(TimestampSchema),
  parts: Schema.Array(LitterBridgeMessagePartSchema),
  contentHash: Sha256Schema,
}).pipe(strict);

export const LitterBridgeToolDescriptorSchema = Schema.Struct({
  toolCallId: IdentifierSchema,
  messageId: IdentifierSchema,
  name: IdentifierSchema,
  state: Schema.Literals(["requested", "running", "completed", "failed", "cancelled"]),
  argumentsJson: JsonTextSchema,
  argumentsHash: Sha256Schema,
  resultJson: Schema.NullOr(JsonTextSchema),
  resultHash: Schema.NullOr(Sha256Schema),
  startedAt: Schema.NullOr(TimestampSchema),
  completedAt: Schema.NullOr(TimestampSchema),
}).pipe(strict);

export const LitterBridgeAttachmentDescriptorSchema = Schema.Struct({
  attachmentId: IdentifierSchema,
  messageId: IdentifierSchema,
  fileName: IdentifierSchema,
  mediaType: IdentifierSchema,
  byteLength: NonNegativeIntegerSchema,
  contentHash: Sha256Schema,
  blobId: Schema.NullOr(IdentifierSchema),
  availability: Schema.Literals(["metadata_only", "available"]),
}).pipe(strict);

export const LitterBridgeHashReferenceSchema = Schema.Struct({
  id: IdentifierSchema,
  sha256: Sha256Schema,
}).pipe(strict);

export const LitterBridgeContentHashesSchema = Schema.Struct({
  algorithm: Schema.Literal("sha256"),
  session: Sha256Schema,
  messages: Schema.Array(LitterBridgeHashReferenceSchema),
  tools: Schema.Array(LitterBridgeHashReferenceSchema),
  attachments: Schema.Array(LitterBridgeHashReferenceSchema),
}).pipe(strict);

export const LitterBridgeTransferCursorSchema = Schema.Struct({
  type: Schema.Literal("session_transfer_cursor"),
  token: OpaqueTokenSchema,
  revision: LitterBridgeRevisionSchema,
  afterSequence: NonNegativeIntegerSchema,
  hasMore: Schema.Boolean,
}).pipe(strict);

export const LitterBridgeSessionTransferEnvelopeSchema = Schema.Struct({
  type: Schema.Literal("session_transfer"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  transferId: IdentifierSchema,
  auth: SessionsWriteAuthSchema,
  direction: Schema.Literals(["litter_to_local_studio", "local_studio_to_litter"]),
  mode: Schema.Literals(["snapshot", "delta"]),
  session: LitterBridgeExternalSessionIdentitySchema,
  origin: LitterBridgeSessionOriginSchema,
  metadata: LitterBridgeSessionMetadataSchema,
  revision: LitterBridgeRevisionSchema,
  baseRevision: Schema.NullOr(LitterBridgeRevisionSchema),
  expectedRevision: Schema.NullOr(LitterBridgeRevisionSchema),
  messages: Schema.Array(LitterBridgeMessageDescriptorSchema),
  tools: Schema.Array(LitterBridgeToolDescriptorSchema),
  attachments: Schema.Array(LitterBridgeAttachmentDescriptorSchema),
  contentHashes: LitterBridgeContentHashesSchema,
  cursor: Schema.NullOr(LitterBridgeTransferCursorSchema),
  conflictPolicy: Schema.Literals(["reject", "fork"]),
}).pipe(strict);

export const LitterBridgeSessionReadRequestSchema = Schema.Struct({
  type: Schema.Literal("session_read_request"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  auth: SessionsReadAuthSchema,
  session: Schema.NullOr(LitterBridgeExternalSessionIdentitySchema),
  cursor: Schema.NullOr(LitterBridgeTransferCursorSchema),
  limit: PositiveIntegerSchema.pipe(Schema.check(Schema.isLessThanOrEqualTo(200))),
}).pipe(
  Schema.check(
    Schema.makeFilter((input) =>
      (input.session === null) !== (input.cursor === null)
        ? undefined
        : "Provide a session for the first page or a cursor for continuation",
    ),
  ),
  strict,
);

export const LitterBridgeSessionListRequestSchema = Schema.Struct({
  type: Schema.Literal("session_list_request"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  auth: SessionsReadAuthSchema,
  cursor: Schema.NullOr(LitterBridgeSessionListCursorSchema),
  limit: PositiveIntegerSchema.pipe(Schema.check(Schema.isLessThanOrEqualTo(200))),
}).pipe(
  Schema.check(
    Schema.makeFilter((input) =>
      input.cursor === null || input.cursor.hasMore
        ? undefined
        : "Session list cursor must have more results",
    ),
  ),
  strict,
);

export const LitterBridgeSessionListPageSchema = Schema.Struct({
  type: Schema.Literal("session_list_page"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  requestId: IdentifierSchema,
  controllerId: IdentifierSchema,
  revision: LitterBridgeRevisionSchema,
  sessions: Schema.Array(LitterBridgeSessionDescriptorSchema),
  cursor: Schema.NullOr(LitterBridgeSessionListCursorSchema),
}).pipe(
  Schema.check(
    Schema.makeFilter((input) =>
      input.cursor === null || (input.cursor.hasMore && input.cursor.revision === input.revision)
        ? undefined
        : "Session list cursor must match the page revision",
    ),
  ),
  strict,
);

export const LitterBridgeSessionPageSchema = Schema.Struct({
  type: Schema.Literal("session_page"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  requestId: IdentifierSchema,
  pageId: IdentifierSchema,
  canonicalSession: LitterBridgeExternalSessionIdentitySchema,
  origin: LitterBridgeSessionOriginSchema,
  metadata: LitterBridgeSessionMetadataSchema,
  revision: LitterBridgeRevisionSchema,
  messages: Schema.Array(LitterBridgeMessageDescriptorSchema),
  tools: Schema.Array(LitterBridgeToolDescriptorSchema),
  attachments: Schema.Array(LitterBridgeAttachmentDescriptorSchema),
  contentHashes: LitterBridgeContentHashesSchema,
  cursor: Schema.NullOr(LitterBridgeTransferCursorSchema),
}).pipe(strict);

export const LitterBridgeAgentTurnRequestSchema = Schema.Struct({
  type: Schema.Literal("agent_turn_request"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  auth: AgentTurnAuthSchema,
  session: LitterBridgeExternalSessionIdentitySchema,
  expectedRevision: LitterBridgeRevisionSchema,
  messageId: IdentifierSchema,
  modelId: Schema.NullOr(IdentifierSchema),
  content: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(4_000_000))),
  contentHash: Sha256Schema,
}).pipe(strict);

export const LitterBridgeAgentTurnAckSchema = Schema.Struct({
  type: Schema.Literal("agent_turn_ack"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  requestId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  dispatchId: IdentifierSchema,
  canonicalSession: LitterBridgeExternalSessionIdentitySchema,
  messageId: IdentifierSchema,
  contentHash: Sha256Schema,
  baseRevision: LitterBridgeRevisionSchema,
  runtimeSessionId: IdentifierSchema,
  piSessionId: IdentifierSchema,
  modelId: IdentifierSchema,
  outcome: Schema.Literal("accepted"),
  acceptedAt: TimestampSchema,
}).pipe(strict);

export const LitterBridgeTransferAckSchema = Schema.Struct({
  type: Schema.Literal("ack"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  requestId: IdentifierSchema,
  transferId: IdentifierSchema,
  canonicalSession: LitterBridgeExternalSessionIdentitySchema,
  acceptedRevision: LitterBridgeRevisionSchema,
  appliedMessages: NonNegativeIntegerSchema,
  appliedTools: NonNegativeIntegerSchema,
  appliedAttachments: NonNegativeIntegerSchema,
  contentHash: Sha256Schema,
  cursor: Schema.NullOr(LitterBridgeTransferCursorSchema),
  acknowledgedAt: TimestampSchema,
}).pipe(strict);

export const LitterBridgeConflictResultSchema = Schema.Struct({
  type: Schema.Literal("conflict"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  requestId: IdentifierSchema,
  operation: Schema.Literals(["controller_action", "session_transfer", "agent_turn"]),
  expectedRevision: LitterBridgeRevisionSchema,
  currentRevision: LitterBridgeRevisionSchema,
  resolution: Schema.Literals(["retry", "fork_required", "manual"]),
  canonicalSession: Schema.NullOr(LitterBridgeExternalSessionIdentitySchema),
  cursor: Schema.NullOr(LitterBridgeTransferCursorSchema),
  error: LitterBridgeErrorSchema,
}).pipe(strict);

export const LitterBridgeForkResultSchema = Schema.Struct({
  type: Schema.Literal("fork"),
  protocolVersion: LitterBridgeProtocolVersionSchema,
  requestId: IdentifierSchema,
  transferId: IdentifierSchema,
  sourceSession: LitterBridgeExternalSessionIdentitySchema,
  canonicalSession: LitterBridgeExternalSessionIdentitySchema,
  sourceRevision: LitterBridgeRevisionSchema,
  acceptedRevision: LitterBridgeRevisionSchema,
  reason: Schema.Literals(["revision_conflict", "identity_collision", "explicit"]),
  cursor: Schema.NullOr(LitterBridgeTransferCursorSchema),
  acknowledgedAt: TimestampSchema,
}).pipe(strict);

export const LitterBridgeSessionTransferResultSchema = Schema.Union([
  LitterBridgeTransferAckSchema,
  LitterBridgeConflictResultSchema,
  LitterBridgeForkResultSchema,
  LitterBridgeErrorResultSchema,
]).pipe(strict);

export const LitterBridgeAgentTurnResultSchema = Schema.Union([
  LitterBridgeAgentTurnAckSchema,
  LitterBridgeConflictResultSchema,
  LitterBridgeErrorResultSchema,
]).pipe(strict);

export const LitterBridgeControllerActionResultSchema = Schema.Union([
  LitterBridgeControllerActionAckSchema,
  LitterBridgeConflictResultSchema,
  LitterBridgeErrorResultSchema,
]).pipe(strict);

export const LitterBridgeRequestSchema = Schema.Union([
  LitterBridgeControllerSnapshotRequestSchema,
  LitterBridgeControllerActionRequestSchema,
  LitterBridgeSessionListRequestSchema,
  LitterBridgeSessionReadRequestSchema,
  LitterBridgeSessionTransferEnvelopeSchema,
  LitterBridgeAgentTurnRequestSchema,
]).pipe(strict);

export const LitterBridgeResponseSchema = Schema.Union([
  LitterBridgeCapabilitiesManifestSchema,
  LitterBridgeControllerSnapshotSchema,
  LitterBridgeControllerActionResultSchema,
  LitterBridgeSessionListPageSchema,
  LitterBridgeSessionPageSchema,
  LitterBridgeSessionTransferResultSchema,
  LitterBridgeAgentTurnResultSchema,
  LitterBridgeErrorResultSchema,
]).pipe(strict);

export type LitterBridgeProtocolVersion = typeof LitterBridgeProtocolVersionSchema.Type;
export type LitterBridgeCapability = typeof LitterBridgeCapabilitySchema.Type;
export type LitterBridgeRevision = typeof LitterBridgeRevisionSchema.Type;
export type LitterBridgeDeviceAuth = typeof LitterBridgeDeviceAuthSchema.Type;
export type LitterBridgeRequestAuth = typeof LitterBridgeRequestAuthSchema.Type;
export type LitterBridgeMutationAuth = typeof LitterBridgeMutationAuthSchema.Type;
export type LitterBridgeSectionName = typeof LitterBridgeSectionNameSchema.Type;
export type LitterBridgeErrorCode = typeof LitterBridgeErrorCodeSchema.Type;
export type LitterBridgeErrorDetails = typeof LitterBridgeErrorDetailsSchema.Type;
export type LitterBridgeError = typeof LitterBridgeErrorSchema.Type;
export type LitterBridgeErrorResult = typeof LitterBridgeErrorResultSchema.Type;
export type LitterBridgeFreshness = typeof LitterBridgeFreshnessSchema.Type;
export type LitterBridgeControllerHealth = typeof LitterBridgeControllerHealthSchema.Type;
export type LitterBridgeControllerStatus = typeof LitterBridgeControllerStatusSchema.Type;
export type LitterBridgeGpuDevice = typeof LitterBridgeGpuDeviceSchema.Type;
export type LitterBridgeGpuSnapshot = typeof LitterBridgeGpuSnapshotSchema.Type;
export type LitterBridgeMetrics = typeof LitterBridgeMetricsSchema.Type;
export type LitterBridgeAgentRuntimeStats = typeof LitterBridgeAgentRuntimeStatsSchema.Type;
export type LitterBridgeControllerSnapshot = typeof LitterBridgeControllerSnapshotSchema.Type;
export type LitterBridgeCapabilitiesManifest = typeof LitterBridgeCapabilitiesManifestSchema.Type;
export type LitterBridgeControllerSnapshotRequest =
  typeof LitterBridgeControllerSnapshotRequestSchema.Type;
export type LitterBridgeControllerAction = typeof LitterBridgeControllerActionSchema.Type;
export type LitterBridgeControllerActionRequest =
  typeof LitterBridgeControllerActionRequestSchema.Type;
export type LitterBridgeControllerResource = typeof LitterBridgeControllerResourceSchema.Type;
export type LitterBridgeControllerActionAck = typeof LitterBridgeControllerActionAckSchema.Type;
export type LitterBridgeSessionAuthority = typeof LitterBridgeSessionAuthoritySchema.Type;
export type LitterBridgeExternalSessionIdentity =
  typeof LitterBridgeExternalSessionIdentitySchema.Type;
export type LitterBridgeSessionOrigin = typeof LitterBridgeSessionOriginSchema.Type;
export type LitterBridgeSessionMetadata = typeof LitterBridgeSessionMetadataSchema.Type;
export type LitterBridgeSessionListCursor = typeof LitterBridgeSessionListCursorSchema.Type;
export type LitterBridgeSessionDescriptor = typeof LitterBridgeSessionDescriptorSchema.Type;
export type LitterBridgeMessageRole = typeof LitterBridgeMessageRoleSchema.Type;
export type LitterBridgeMessagePart = typeof LitterBridgeMessagePartSchema.Type;
export type LitterBridgeMessageDescriptor = typeof LitterBridgeMessageDescriptorSchema.Type;
export type LitterBridgeToolDescriptor = typeof LitterBridgeToolDescriptorSchema.Type;
export type LitterBridgeAttachmentDescriptor = typeof LitterBridgeAttachmentDescriptorSchema.Type;
export type LitterBridgeHashReference = typeof LitterBridgeHashReferenceSchema.Type;
export type LitterBridgeContentHashes = typeof LitterBridgeContentHashesSchema.Type;
export type LitterBridgeTransferCursor = typeof LitterBridgeTransferCursorSchema.Type;
export type LitterBridgeSessionTransferEnvelope =
  typeof LitterBridgeSessionTransferEnvelopeSchema.Type;
export type LitterBridgeSessionReadRequest = typeof LitterBridgeSessionReadRequestSchema.Type;
export type LitterBridgeSessionListRequest = typeof LitterBridgeSessionListRequestSchema.Type;
export type LitterBridgeSessionListPage = typeof LitterBridgeSessionListPageSchema.Type;
export type LitterBridgeSessionPage = typeof LitterBridgeSessionPageSchema.Type;
export type LitterBridgeAgentTurnRequest = typeof LitterBridgeAgentTurnRequestSchema.Type;
export type LitterBridgeAgentTurnAck = typeof LitterBridgeAgentTurnAckSchema.Type;
export type LitterBridgeTransferAck = typeof LitterBridgeTransferAckSchema.Type;
export type LitterBridgeConflictResult = typeof LitterBridgeConflictResultSchema.Type;
export type LitterBridgeForkResult = typeof LitterBridgeForkResultSchema.Type;
export type LitterBridgeSessionTransferResult = typeof LitterBridgeSessionTransferResultSchema.Type;
export type LitterBridgeAgentTurnResult = typeof LitterBridgeAgentTurnResultSchema.Type;
export type LitterBridgeControllerActionResult =
  typeof LitterBridgeControllerActionResultSchema.Type;
export type LitterBridgeRequest = typeof LitterBridgeRequestSchema.Type;
export type LitterBridgeResponse = typeof LitterBridgeResponseSchema.Type;
