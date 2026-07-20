import { createHmac, randomBytes, randomUUID, timingSafeEqual, type BinaryLike } from "node:crypto";
import { Effect, Fiber, Schema } from "effect";
import {
  ConnectorArgumentsSchema,
  ConnectorConfigSchema,
  ConnectorRiskSchema,
  type ConnectorApprovalState,
  type ConnectorApprovalView,
  type ConnectorArguments,
  type ConnectorJson,
  type ConnectorRisk,
} from "./connector-contract";
import {
  canonicalConnectorJson,
  connectorAuthorizationConfiguration,
} from "./connector-configuration";
import { getGlobalSingleton } from "./instances";

const APPROVAL_DOMAIN = "local-studio.connector-approval.v2";
const DEFAULT_TTL_MS = 60_000;
const DEFAULT_RECORD_LIMIT = 128;
const DEFAULT_AUDIT_LIMIT = 256;
const DECISION_HANDSHAKE_TTL_MS = 5_000;
const SUMMARY_LIMIT = 48;
const PATH_LIMIT = 160;

const ApprovalInputSchema = Schema.Struct({
  sessionId: Schema.String,
  connectorId: Schema.String,
  connectorName: Schema.String,
  tool: Schema.String,
  risk: ConnectorRiskSchema,
  args: ConnectorArgumentsSchema,
  configuration: ConnectorConfigSchema,
});

type ConnectorApprovalInput = typeof ApprovalInputSchema.Type;

type ApprovalAuditEntry = {
  connectorId: string;
  tool: string;
  risk: ConnectorRisk;
  outcome: Exclude<ConnectorApprovalState, "pending" | "approved">;
  createdAt: string;
  decidedAt: string;
};

type ApprovalRecord = {
  approval: ConnectorApprovalView;
  digest: Buffer;
  settle: (state: ConnectorApprovalState) => void;
  timer: Fiber.Fiber<void, unknown>;
  removeAbortListener: () => void;
};

type PreparedDecisionRecord = {
  requestId?: string;
  decision?: "approve" | "deny";
  expiresAt: number;
  status: "prepared" | "armed" | "committed" | "cancelled";
};

type ApprovalBrokerOptions = {
  key?: BinaryLike;
  ttlMs?: number;
  recordLimit?: number;
  auditLimit?: number;
  now?: () => number;
};

type ApprovalHandle = {
  approval: ConnectorApprovalView;
  wait: Promise<ConnectorApprovalState>;
};

function isConnectorJsonArray(value: ConnectorJson): value is readonly ConnectorJson[] {
  return Array.isArray(value);
}

function jsonProperty(
  value: { readonly [key: string]: ConnectorJson },
  key: string,
): ConnectorJson {
  const property = value[key];
  if (property === undefined) throw new Error("Connector arguments contain unsupported JSON");
  return property;
}

function decodedApprovalInput(input: ConnectorApprovalInput): ConnectorApprovalInput {
  return Schema.decodeUnknownSync(ApprovalInputSchema)(input);
}

export function connectorApprovalDigest(key: BinaryLike, input: ConnectorApprovalInput): string {
  const decoded = decodedApprovalInput(input);
  const payload: ConnectorJson = {
    args: decoded.args,
    connector: decoded.connectorId,
    connector_name: decoded.connectorName,
    configuration: connectorAuthorizationConfiguration(decoded.configuration),
    risk: decoded.risk,
    session: decoded.sessionId,
    tool: decoded.tool,
    version: 2,
  };
  return createHmac("sha256", key)
    .update(APPROVAL_DOMAIN)
    .update("\0")
    .update(canonicalConnectorJson(payload))
    .digest("hex");
}

function summaryPath(parent: string, key: string): string {
  const path = parent ? `${parent}.${key}` : key;
  return path.length <= PATH_LIMIT ? path : `${path.slice(0, PATH_LIMIT - 1)}…`;
}

function argumentType(value: ConnectorJson): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function argumentDetail(value: ConnectorJson): string | undefined {
  if (typeof value === "string") return `${value.length} characters`;
  if (Array.isArray(value)) return `${value.length} items`;
  if (value !== null && typeof value === "object") return `${Object.keys(value).length} fields`;
  return undefined;
}

function summarizeArguments(args: ConnectorArguments): ConnectorApprovalView["argument_summary"] {
  const summaries: ConnectorApprovalView["argument_summary"][number][] = [];
  const visit = (value: ConnectorJson, path: string): void => {
    if (summaries.length >= SUMMARY_LIMIT) return;
    const detail = argumentDetail(value);
    summaries.push({ path, type: argumentType(value), ...(detail ? { detail } : {}) });
    if (isConnectorJsonArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (value === null || typeof value !== "object") return;
    Object.keys(value)
      .sort()
      .forEach((key) => visit(jsonProperty(value, key), summaryPath(path, key)));
  };
  Object.keys(args)
    .sort()
    .forEach((key) => visit(jsonProperty(args, key), summaryPath("", key)));
  return summaries;
}

function safeDigestEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

class ConnectorApprovalBroker {
  private readonly key: BinaryLike;
  private readonly ttlMs: number;
  private readonly recordLimit: number;
  private readonly auditLimit: number;
  private readonly now: () => number;
  private readonly records = new Map<string, ApprovalRecord>();
  private readonly preparedDecisions = new Map<string, PreparedDecisionRecord>();
  private readonly auditEntries: ApprovalAuditEntry[] = [];

  constructor(options: ApprovalBrokerOptions = {}) {
    this.key = options.key ?? randomBytes(32);
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.recordLimit = options.recordLimit ?? DEFAULT_RECORD_LIMIT;
    this.auditLimit = options.auditLimit ?? DEFAULT_AUDIT_LIMIT;
    this.now = options.now ?? Date.now;
  }

  begin(input: ConnectorApprovalInput, signal?: AbortSignal): ApprovalHandle {
    const decoded = decodedApprovalInput(input);
    this.pruneRecords();
    if (this.records.size >= this.recordLimit) throw new Error("Connector approval queue is full");
    const id = randomUUID();
    const createdAt = this.now();
    const expiresAt = createdAt + this.ttlMs;
    const digest = Buffer.from(connectorApprovalDigest(this.key, decoded), "hex");
    let settle: (state: ConnectorApprovalState) => void = () => undefined;
    const wait = new Promise<ConnectorApprovalState>((resolve) => {
      settle = resolve;
    });
    const approval: ConnectorApprovalView = {
      id,
      session_id: decoded.sessionId,
      connector_id: decoded.connectorId,
      connector_name: decoded.connectorName,
      tool: decoded.tool,
      risk: decoded.risk,
      status: "pending",
      argument_summary: summarizeArguments(decoded.args),
      created_at: new Date(createdAt).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
    };
    const broker = this;
    const ttlMs = this.ttlMs;
    const timer = Effect.runFork(
      Effect.gen(function* () {
        yield* Effect.sleep(ttlMs);
        broker.expire(id);
      }),
    );
    const abort = () => this.cancel(id);
    signal?.addEventListener("abort", abort, { once: true });
    const record: ApprovalRecord = {
      approval,
      digest,
      settle,
      timer,
      removeAbortListener: () => signal?.removeEventListener("abort", abort),
    };
    this.records.set(id, record);
    if (signal?.aborted) this.cancel(id);
    return { approval, wait };
  }

  pending(): ConnectorApprovalView[] {
    this.expireDue();
    return [...this.records.values()]
      .filter(({ approval }) => approval.status === "pending")
      .map(({ approval }) => approval)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  decide(id: string, decision: "approve" | "deny"): boolean {
    const record = this.records.get(id);
    if (!record || record.approval.status !== "pending") return false;
    if (this.expireIfDue(record)) return false;
    return this.transition(record, decision === "approve" ? "approved" : "denied");
  }

  prepareDecision(transactionId: string, requestId: string, decision: "approve" | "deny"): boolean {
    this.prunePreparedDecisions();
    const prepared = this.preparedDecisions.get(transactionId);
    if (prepared) {
      return (
        prepared.status !== "cancelled" &&
        prepared.requestId === requestId &&
        prepared.decision === decision
      );
    }
    if (this.preparedDecisions.size >= this.recordLimit) return false;
    const approval = this.records.get(requestId);
    if (!approval || approval.approval.status !== "pending" || this.expireIfDue(approval)) {
      return false;
    }
    this.preparedDecisions.set(transactionId, {
      requestId,
      decision,
      expiresAt: Math.min(
        Date.parse(approval.approval.expires_at),
        this.now() + DECISION_HANDSHAKE_TTL_MS,
      ),
      status: "prepared",
    });
    return true;
  }

  armPreparedDecision(transactionId: string): boolean {
    this.prunePreparedDecisions();
    const prepared = this.preparedDecisions.get(transactionId);
    if (!prepared || prepared.status === "cancelled") return false;
    if (prepared.status === "committed") return true;
    prepared.status = "armed";
    return true;
  }

  commitPreparedDecision(transactionId: string): boolean {
    this.prunePreparedDecisions();
    const prepared = this.preparedDecisions.get(transactionId);
    if (!prepared || prepared.status === "cancelled" || prepared.status === "prepared")
      return false;
    if (prepared.status === "committed") return true;
    if (!prepared.requestId || !prepared.decision) return false;
    if (!this.decide(prepared.requestId, prepared.decision)) return false;
    prepared.status = "committed";
    return true;
  }

  cancelPreparedDecision(transactionId: string): boolean {
    this.prunePreparedDecisions();
    const prepared = this.preparedDecisions.get(transactionId);
    if (prepared?.status === "committed") return false;
    if (prepared) {
      prepared.status = "cancelled";
      return true;
    }
    if (this.preparedDecisions.size >= this.recordLimit) return false;
    this.preparedDecisions.set(transactionId, {
      expiresAt: this.now() + this.ttlMs,
      status: "cancelled",
    });
    return true;
  }

  consume(id: string, input: ConnectorApprovalInput): boolean {
    const record = this.records.get(id);
    if (!record || record.approval.status !== "approved") return false;
    if (this.expireIfDue(record)) return false;
    const digest = Buffer.from(connectorApprovalDigest(this.key, input), "hex");
    if (!safeDigestEqual(record.digest, digest)) {
      this.transition(record, "denied");
      return false;
    }
    return this.transition(record, "consumed");
  }

  cancel(id: string): boolean {
    const record = this.records.get(id);
    if (!record || !["pending", "approved"].includes(record.approval.status)) return false;
    return this.transition(record, "cancelled");
  }

  cancelSession(sessionId: string): number {
    return [...this.records.values()].reduce(
      (count, record) =>
        record.approval.session_id === sessionId && this.cancel(record.approval.id)
          ? count + 1
          : count,
      0,
    );
  }

  expireDue(): number {
    const now = this.now();
    return [...this.records.values()].reduce(
      (count, record) =>
        Date.parse(record.approval.expires_at) <= now && this.expire(record.approval.id)
          ? count + 1
          : count,
      0,
    );
  }

  audit(): ApprovalAuditEntry[] {
    return this.auditEntries.map((entry) => ({ ...entry }));
  }

  private expire(id: string): boolean {
    const record = this.records.get(id);
    if (!record || !["pending", "approved"].includes(record.approval.status)) return false;
    return this.transition(record, "expired");
  }

  private expireIfDue(record: ApprovalRecord): boolean {
    return Date.parse(record.approval.expires_at) <= this.now() && this.expire(record.approval.id);
  }

  private transition(record: ApprovalRecord, status: ConnectorApprovalState): boolean {
    const current = record.approval.status;
    const allowed =
      (current === "pending" && ["approved", "denied", "expired", "cancelled"].includes(status)) ||
      (current === "approved" && ["consumed", "denied", "expired", "cancelled"].includes(status));
    if (!allowed) return false;
    record.approval = { ...record.approval, status };
    record.settle(status);
    if (status === "approved") return true;
    record.removeAbortListener();
    void Effect.runPromise(Fiber.interrupt(record.timer));
    if (status !== "pending") this.recordAudit(record, status);
    return true;
  }

  private recordAudit(
    record: ApprovalRecord,
    outcome: Exclude<ConnectorApprovalState, "pending" | "approved">,
  ): void {
    this.auditEntries.push({
      connectorId: record.approval.connector_id,
      tool: record.approval.tool,
      risk: record.approval.risk,
      outcome,
      createdAt: record.approval.created_at,
      decidedAt: new Date(this.now()).toISOString(),
    });
    if (this.auditEntries.length > this.auditLimit) {
      this.auditEntries.splice(0, this.auditEntries.length - this.auditLimit);
    }
  }

  private pruneRecords(): void {
    for (const [id, record] of this.records) {
      if (this.records.size < this.recordLimit) return;
      if (!["pending", "approved"].includes(record.approval.status)) this.records.delete(id);
    }
  }

  private prunePreparedDecisions(): void {
    const now = this.now();
    for (const [id, prepared] of this.preparedDecisions) {
      if (prepared.expiresAt <= now) this.preparedDecisions.delete(id);
    }
    if (this.preparedDecisions.size < this.recordLimit) return;
    for (const [id, prepared] of this.preparedDecisions) {
      if (this.preparedDecisions.size < this.recordLimit) return;
      if (prepared.status === "committed" || prepared.status === "cancelled") {
        this.preparedDecisions.delete(id);
      }
    }
  }
}

export function createConnectorApprovalBroker(
  options: ApprovalBrokerOptions = {},
): ConnectorApprovalBroker {
  return new ConnectorApprovalBroker(options);
}

export const connectorApprovalBroker = getGlobalSingleton(
  "connectorApprovalBroker",
  createConnectorApprovalBroker,
);
