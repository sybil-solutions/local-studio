import { createHmac, randomBytes, randomUUID, timingSafeEqual, type BinaryLike } from "node:crypto";
import { Effect, Fiber, Schema } from "effect";
import {
  ConnectorArgumentsSchema,
  type ConnectorArguments,
  type ConnectorApprovalBridge,
  type ConnectorApprovalView,
  type ConnectorConfig,
  type ConnectorJson,
  type ConnectorRisk,
} from "./connector-contract";
import { authorizedConnectorTool, callConnectorTool } from "./connector-pool";
import { connectorToolRisk } from "./connector-policy";
import { getGlobalSingleton } from "./instances";

type Scope = {
  sessionId: string;
  connector: ConnectorConfig;
  tool: string;
  args: ConnectorArguments;
};
type Outcome = "denied" | "expired" | "consumed" | "cancelled";
type Entry = {
  sessionId: string;
  connectorId: string;
  digest: Buffer;
  expiresAt: number;
  view: ConnectorApprovalView;
  detach: () => void;
  timeout: Fiber.Fiber<void, unknown> | null;
};
type BrokerOptions = { key?: BinaryLike; ttlMs?: number; now?: () => number };
const canonical = (value: ConnectorJson): string => {
  if (value === null || typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Readonly<Record<string, ConnectorJson>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key] as ConnectorJson)}`)
    .join(",")}}`;
};

export const connectorApprovalDigest = (key: BinaryLike, scope: Scope): Buffer =>
  createHmac("sha256", key)
    .update("local-studio.connector-approval.v1\0")
    .update(canonical(JSON.parse(JSON.stringify(scope)) as ConnectorJson))
    .digest();

const boundedLabel = (value: string, maximum = 96): string => {
  const visible = value.replace(/[\p{Cc}\p{Cf}]/gu, "�");
  return visible.length <= maximum ? visible : `${visible.slice(0, maximum - 1)}…`;
};

const summarize = (args: ConnectorArguments): string[] =>
  Object.keys(args)
    .sort()
    .slice(0, 48)
    .map((key) => {
      const value = args[key] as ConnectorJson;
      const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      const size =
        typeof value === "string"
          ? value.length
          : Array.isArray(value)
            ? value.length
            : value !== null && typeof value === "object"
              ? Object.keys(value).length
              : null;
      return `${boundedLabel(key)}: ${type}${size === null ? "" : ` (${size})`}`;
    });

class ConnectorApprovalBroker {
  private readonly key: BinaryLike;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();
  private readonly events: Array<{
    connector: string;
    tool: string;
    risk: ConnectorRisk;
    outcome: Outcome;
    at: string;
  }> = [];

  constructor(options: BrokerOptions = {}) {
    this.key = options.key ?? randomBytes(32);
    this.ttlMs = options.ttlMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  begin(scope: Scope, signal?: AbortSignal): ConnectorApprovalView {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= this.now()) this.finish(id, "expired");
    }
    if (this.entries.size >= 128) throw new Error("Connector approval queue is full");
    const id = randomUUID();
    const view = {
      id,
      connectorName: boundedLabel(scope.connector.name),
      tool: boundedLabel(scope.tool),
      risk: connectorToolRisk(scope.connector, scope.tool),
      argumentSummary: summarize(scope.args),
    };
    const cancel = () => this.finish(id, "cancelled");
    signal?.addEventListener("abort", cancel, { once: true });
    this.entries.set(id, {
      sessionId: scope.sessionId,
      connectorId: boundedLabel(scope.connector.id),
      digest: connectorApprovalDigest(this.key, scope),
      expiresAt: this.now() + this.ttlMs,
      view,
      detach: () => signal?.removeEventListener("abort", cancel),
      timeout: null,
    });
    const entry = this.entries.get(id);
    if (entry)
      entry.timeout = Effect.runFork(
        Effect.sleep(this.ttlMs).pipe(
          Effect.tap(() => Effect.sync(() => this.finish(id, "expired", false))),
        ),
      );
    if (signal?.aborted) cancel();
    return view;
  }

  consume(id: string, scope: Scope, approved: boolean): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) return this.finish(id, "expired") && false;
    if (!approved) return this.finish(id, "denied") && false;
    const matches = timingSafeEqual(connectorApprovalDigest(this.key, scope), entry.digest);
    this.finish(id, matches ? "consumed" : "denied");
    return matches;
  }

  cancelSession(sessionId: string): number {
    let count = 0;
    for (const [id, entry] of this.entries)
      if (entry.sessionId === sessionId && this.finish(id, "cancelled")) count += 1;
    return count;
  }

  audit() {
    return this.events.map((event) => ({ ...event }));
  }

  private finish(id: string, outcome: Outcome, interruptTimeout = true): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    entry.detach();
    if (interruptTimeout && entry.timeout) {
      void Effect.runPromise(Fiber.interrupt(entry.timeout));
    }
    this.events.push({
      connector: entry.connectorId,
      tool: entry.view.tool,
      risk: entry.view.risk,
      outcome,
      at: new Date(this.now()).toISOString(),
    });
    if (this.events.length > 256) this.events.splice(0, this.events.length - 256);
    return true;
  }
}

export const createConnectorApprovalBroker = (options: BrokerOptions = {}) =>
  new ConnectorApprovalBroker(options);
const broker = getGlobalSingleton("connectorApprovalBroker", createConnectorApprovalBroker);
export const cancelConnectorApprovals = (sessionId: string): number =>
  broker.cancelSession(sessionId);
export class ConnectorApprovalError extends Error {}

const scope = (
  sessionId: string,
  connector: ConnectorConfig,
  tool: string,
  args: ConnectorArguments,
): Scope => ({ sessionId, connector, tool, args });

export async function executeConnectorTool(input: {
  sessionId: string;
  connectorId: string;
  tool: string;
  args: unknown;
  signal?: AbortSignal;
  approve?: (view: ConnectorApprovalView) => Promise<boolean>;
}): Promise<unknown> {
  const args = Schema.decodeUnknownSync(ConnectorArgumentsSchema)(input.args);
  const connector = await authorizedConnectorTool(input.connectorId, input.tool);
  if (connectorToolRisk(connector, input.tool) === "read")
    return callConnectorTool(connector, input.tool, args, input.signal);
  if (!input.approve) throw new ConnectorApprovalError("Connector action requires approval");
  const approval = broker.begin(scope(input.sessionId, connector, input.tool, args), input.signal);
  try {
    const approved = await input.approve(approval).catch(() => false);
    const current = await authorizedConnectorTool(input.connectorId, input.tool);
    if (
      input.signal?.aborted ||
      !broker.consume(approval.id, scope(input.sessionId, current, input.tool, args), approved)
    )
      throw new ConnectorApprovalError("Connector action was not approved for this request");
    return callConnectorTool(current, input.tool, args, input.signal);
  } finally {
    broker.consume(approval.id, scope(input.sessionId, connector, input.tool, args), false);
  }
}

getGlobalSingleton<ConnectorApprovalBridge>("connectorApprovalBridge", () => ({
  execute: executeConnectorTool,
  cancel: cancelConnectorApprovals,
}));
