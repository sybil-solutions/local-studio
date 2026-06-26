import { EventEmitter } from "node:events";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  SessionManager,
  shouldCompact,
  type AgentSessionEvent,
  type AgentSessionRuntime,
} from "@earendil-works/pi-coding-agent";
import type { AgentImageInput } from "@/features/agent/contracts";
import {
  applyRuntimeEnvInjections,
  buildAgentSessionOptions,
  pluginFingerprint,
  resolveAgentCwd,
  type RuntimeStartOptions,
} from "@/features/agent/pi-runtime-helpers";
import { refreshPiModels, resolvePiModelSelection } from "@/features/agent/pi-runtime-models";
import { findRuntimeSessionForLookup, piStatusFromEvents } from "@/features/agent/pi-runtime-state";
import {
  compactionTokensBefore,
  contextUsageAwaitingFreshCompactionUsage,
  normalizeSdkMessageTimestampsForCompactionBoundary,
  piEventIsSuccessfulCompaction,
  postCompactionUsageIsFresh,
} from "@/features/agent/pi-runtime-compaction";
import { findSessionFile } from "@/features/agent/sessions-store";
import type {
  LoggedPiEvent,
  PiAgentSession,
  PiAgentStatus,
  PiContextUsage,
} from "@/features/agent/pi-runtime-types";

type PiEvent = LoggedPiEvent["event"];

function runtimeFingerprint(
  modelId: string,
  cwd: string,
  piSessionId: string | null,
  options: RuntimeStartOptions,
) {
  return JSON.stringify({
    modelId,
    cwd,
    piSessionId: piSessionId ?? "",
    options: pluginFingerprint(options),
  });
}

/** Resource diagnostics gathered at session-creation time. Stored at module
 * scope so the setup-checks API route can surface extension load failures
 * without holding a runtime handle. */
type PiResourceDiagnostic = {
  type: "info" | "warning" | "error";
  message: string;
  /** Extension/skill path the diagnostic relates to, when available. */
  path?: string;
};

// Pinned on globalThis so Next.js dev — which can re-evaluate this module
// independently for the turn route, the setup-checks route, and the cached
// session manager — shares a single map. Resolve via globalThis on every read
// to defeat closure-bound copies left behind by HMR.
type DiagnosticsGlobal = typeof globalThis & {
  __localStudioPiResourceDiagnostics?: Map<string, PiResourceDiagnostic[]>;
};
function diagnosticsMap(): Map<string, PiResourceDiagnostic[]> {
  const g = globalThis as DiagnosticsGlobal;
  if (!g.__localStudioPiResourceDiagnostics) {
    g.__localStudioPiResourceDiagnostics = new Map();
  }
  return g.__localStudioPiResourceDiagnostics;
}

export function piResourceDiagnostics(agentDir?: string): PiResourceDiagnostic[] {
  const map = diagnosticsMap();
  if (agentDir) return map.get(agentDir) ?? [];
  return [...map.values()].flat();
}

class PiSdkSession extends EventEmitter implements PiAgentSession {
  private runtime: AgentSessionRuntime | null = null;
  private unsubscribe: (() => void) | null = null;
  private eventSeq = 0;
  private eventLog: LoggedPiEvent[] = [];
  private activePromptCount = 0;
  private awaitingPostCompactionUsage = false;
  private postCompactionTokensBefore: number | null = null;
  private warnedCompactionBoundaryShape = false;
  private lastError: string | null = null;
  private currentFingerprint = "";
  private currentPiSessionId: string | null = null;
  private currentCwd = "";
  private currentModelId = "";
  private agentDir = "";

  async ensureStarted(
    modelId: string,
    cwd?: string,
    piSessionId?: string | null,
    options: RuntimeStartOptions = {},
  ): Promise<void> {
    const resolvedCwd = await resolveAgentCwd(cwd);
    const desiredSessionId = piSessionId ?? null;
    const fingerprint = runtimeFingerprint(modelId, resolvedCwd, desiredSessionId, options);
    if (this.runtime && this.currentFingerprint === fingerprint) return;

    await this.stop();
    this.eventSeq = 0;
    this.eventLog = [];
    this.activePromptCount = 0;
    this.awaitingPostCompactionUsage = false;
    this.postCompactionTokensBefore = null;
    this.warnedCompactionBoundaryShape = false;
    this.lastError = null;

    const { models, agentDir } = await refreshPiModels();
    const selectedModel = models.find(
      (model) => model.id === modelId || model.rawId === modelId || model.name === modelId,
    );
    if (!selectedModel) {
      throw new Error(`Model '${modelId}' is not available from /v1/models.`);
    }
    const resolvedSelection = resolvePiModelSelection(selectedModel.id);
    const providerId = selectedModel.providerId ?? resolvedSelection.providerId;
    const backendModelId = selectedModel.rawId ?? resolvedSelection.modelId;

    const sessionOptions = await buildAgentSessionOptions({ options });
    applyRuntimeEnvInjections(sessionOptions.envInjections);
    // SessionManager.create() returns the most-recent session for the cwd. When
    // the caller wants to resume a specific Pi session id, locate its JSONL on
    // disk and rebind the SessionManager before the SDK constructs the agent.
    const sessionManager = SessionManager.create(resolvedCwd);
    const resumeFile = desiredSessionId ? findSessionFile(resolvedCwd, desiredSessionId) : null;
    if (resumeFile) sessionManager.setSessionFile(resumeFile);
    const resuming = Boolean(resumeFile);
    const runtime = await createAgentSessionRuntime(
      async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
        const services = await createAgentSessionServices({
          cwd,
          agentDir,
          resourceLoaderOptions: {
            // Do not load user-installed Pi package/drop-in extensions from
            // settings.json or auto-discovery. Local Studio only allows the
            // first-party extension paths assembled below plus selected MCP
            // servers through mcp-plugin.ts.
            noExtensions: true,
            additionalSkillPaths: sessionOptions.skills,
            // Hand the SDK absolute paths so its jiti-based loader handles
            // .ts/.js resolution. We avoid pre-importing via `import(variable)`
            // because Next/webpack's static analyser refuses dynamic specifiers.
            additionalExtensionPaths: sessionOptions.extensionPaths,
            additionalPromptTemplatePaths: sessionOptions.promptTemplatePaths,
          },
        });
        const model = services.modelRegistry.find(providerId, backendModelId);
        if (!model) {
          throw new Error(
            `Model '${providerId}/${backendModelId}' is not available to the SDK runtime.`,
          );
        }
        const created = await createAgentSessionFromServices({
          services,
          sessionManager,
          sessionStartEvent,
          model,
          thinkingLevel: selectedModel.reasoning ? "high" : undefined,
        });
        // Capture extension-load failures so the setup-checks endpoint can
        // surface broken drop-in extensions without the user tailing logs.
        const extensionErrors = services.resourceLoader
          .getExtensions()
          .errors.map(({ path, error }) => ({
            type: "error" as const,
            message: `Failed to load extension "${path}": ${error}`,
            path,
          }));
        const diagnostics = [...services.diagnostics, ...extensionErrors];
        diagnosticsMap().set(
          agentDir,
          diagnostics.map((d) => ({
            type: d.type as PiResourceDiagnostic["type"],
            message: d.message,
            path: "path" in d ? (d as { path?: string }).path : undefined,
          })),
        );
        return {
          ...created,
          services,
          diagnostics,
        };
      },
      {
        cwd: resolvedCwd,
        agentDir,
        sessionManager,
        sessionStartEvent: { type: "session_start", reason: resuming ? "resume" : "startup" },
      },
    );

    this.runtime = runtime;
    this.agentDir = agentDir;
    this.currentModelId = modelId;
    this.currentCwd = resolvedCwd;
    this.currentPiSessionId = runtime.session.sessionId || desiredSessionId;
    this.currentFingerprint = fingerprint;
    this.unsubscribe = runtime.session.subscribe((event) => this.recordEvent(event));
    this.normalizeCompactionBoundary(runtime.session);
  }

  async prompt(
    message: string,
    onEvent: (event: PiEvent, seq: number) => void,
    options: { streamingBehavior?: "steer" | "followUp"; images?: AgentImageInput[] } = {},
  ): Promise<void> {
    const session = this.requireSession();
    this.normalizeCompactionBoundary(session);
    const listener = (logged: LoggedPiEvent) => onEvent(logged.event, logged.seq);
    this.on("loggedEvent", listener);
    this.activePromptCount += 1;
    this.lastError = null;
    try {
      await session.prompt(message, {
        streamingBehavior: options.streamingBehavior,
        images: options.images,
      });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.activePromptCount = Math.max(0, this.activePromptCount - 1);
      this.off("loggedEvent", listener);
    }
  }

  async steer(message: string, images: AgentImageInput[] = []): Promise<void> {
    await this.requireSession().steer(message, images);
  }

  async followUp(message: string, images: AgentImageInput[] = []): Promise<void> {
    await this.requireSession().followUp(message, images);
  }

  adoptPiSessionId(piSessionId: string | null | undefined): void {
    const next = piSessionId?.trim();
    if (next && !this.currentPiSessionId) this.currentPiSessionId = next;
  }

  async compact(customInstructions?: string): Promise<unknown> {
    if (this.activePromptCount > 0) {
      throw new Error("Cannot compact while the agent is running.");
    }
    const result = await this.requireSession().compact(customInstructions);
    this.markCompactionAcknowledged(result);
    return result;
  }

  async abort(): Promise<void> {
    await this.runtime?.session.abort().catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const runtime = this.runtime;
    this.runtime = null;
    await runtime?.dispose().catch(() => undefined);
  }

  get status() {
    const sdkSession = this.runtime?.session;
    return piStatusFromEvents({
      running: Boolean(this.runtime),
      activePromptCount: this.activePromptCount,
      sdkActive:
        Boolean(sdkSession?.isStreaming) ||
        Boolean(sdkSession?.isCompacting) ||
        (sdkSession?.pendingMessageCount ?? 0) > 0,
      modelId: this.currentModelId,
      cwd: this.currentCwd,
      piSessionId: this.currentPiSessionId,
      agentDir: this.agentDir,
      eventSeq: this.eventSeq,
      lastError: this.lastError,
      eventLog: this.eventLog,
      contextUsage: this.computeContextUsage(),
    });
  }

  /**
   * Snapshot the SDK-computed context usage for the active session. Returns
   * `null` when the runtime isn't started yet or the SDK has no usage data
   * (e.g. before the first assistant message).
   */
  private computeContextUsage() {
    const session = this.runtime?.session;
    if (!session) return null;
    const usage = session.getContextUsage();
    if (!usage) return null;
    const settings = session.settingsManager.getCompactionSettings();
    const tokens = typeof usage.tokens === "number" ? usage.tokens : null;
    const normalized = {
      tokens,
      contextWindow: usage.contextWindow,
      percent: typeof usage.percent === "number" ? usage.percent : null,
      shouldCompact:
        tokens !== null && usage.contextWindow > 0
          ? shouldCompact(tokens, usage.contextWindow, settings)
          : false,
    };
    if (this.awaitingPostCompactionUsage) {
      if (postCompactionUsageIsFresh(normalized, this.postCompactionTokensBefore)) {
        this.awaitingPostCompactionUsage = false;
        this.postCompactionTokensBefore = null;
        return normalized;
      }
      return contextUsageAwaitingFreshCompactionUsage(usage);
    }
    return normalized;
  }

  getEventsAfter(seq: number): LoggedPiEvent[] {
    return piEventsAfter(this.eventLog, seq);
  }

  onLoggedEvent(listener: (event: LoggedPiEvent) => void) {
    this.on("loggedEvent", listener);
    return () => this.off("loggedEvent", listener);
  }

  private requireSession() {
    const session = this.runtime?.session;
    if (!session) throw new Error("pi sdk session is not running");
    return session;
  }

  private recordEvent(event: AgentSessionEvent) {
    if (event.type === "session_info_changed" && this.runtime?.session.sessionId) {
      this.currentPiSessionId = this.runtime.session.sessionId;
    }
    if (piEventIsSuccessfulCompaction(event as Record<string, unknown>)) {
      this.markCompactionAcknowledged(event);
    }
    const logged: LoggedPiEvent = {
      seq: ++this.eventSeq,
      event: event as PiEvent,
      timestamp: new Date().toISOString(),
    };
    this.eventLog.push(logged);
    if (this.eventLog.length > 2_000) this.eventLog.splice(0, this.eventLog.length - 2_000);
    this.emit("loggedEvent", logged);
    this.emit("event", event);
  }

  private markCompactionAcknowledged(source?: unknown): void {
    this.awaitingPostCompactionUsage = true;
    this.postCompactionTokensBefore =
      compactionTokensBefore(source) ?? this.postCompactionTokensBefore;
    this.normalizeCompactionBoundary(this.runtime?.session);
  }

  private normalizeCompactionBoundary(session: unknown): void {
    const normalized = normalizeSdkMessageTimestampsForCompactionBoundary(session);
    if (!normalized && !this.warnedCompactionBoundaryShape) {
      this.warnedCompactionBoundaryShape = true;
      console.warn(
        "[Local Studio] Pi SDK compaction boundary guard could not inspect session messages; stale post-compaction usage may reappear after an SDK shape change.",
      );
    }
  }
}

function piEventsAfter(eventLog: LoggedPiEvent[], seq: number): LoggedPiEvent[] {
  const floor = Number.isFinite(seq) ? Math.max(0, Math.trunc(seq)) : 0;
  return eventLog.filter((entry) => entry.seq > floor);
}

const DEFAULT_SESSION_ID = "default";

class PiRuntimeManager {
  private sessions = new Map<string, PiAgentSession>();

  getSession(sessionId = DEFAULT_SESSION_ID): PiAgentSession {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const created = new PiSdkSession();
    this.sessions.set(sessionId, created);
    return created;
  }

  getSessionForLookup(
    sessionId = DEFAULT_SESSION_ID,
    piSessionId?: string | null,
  ): { sessionId: string; session: PiAgentSession } {
    return (
      this.findSessionForLookup(sessionId, piSessionId) ?? {
        sessionId,
        session: this.getSession(sessionId),
      }
    );
  }

  findSessionForLookup(
    sessionId = DEFAULT_SESSION_ID,
    piSessionId?: string | null,
  ): { sessionId: string; session: PiAgentSession } | null {
    return findRuntimeSessionForLookup(this.listSessions(), sessionId, piSessionId);
  }

  listSessions(): Array<{ sessionId: string; session: PiAgentSession }> {
    return [...this.sessions.entries()].map(([sessionId, session]) => ({ sessionId, session }));
  }
}

const globalForPi = globalThis as typeof globalThis & {
  __localStudioPiRuntimeManager?: PiRuntimeManager;
};

export const piRuntimeManager = globalForPi.__localStudioPiRuntimeManager ?? new PiRuntimeManager();

globalForPi.__localStudioPiRuntimeManager = piRuntimeManager;
