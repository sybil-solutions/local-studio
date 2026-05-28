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
import type { AgentImageInput } from "@/lib/agent/contracts/turn";
import {
  applyRuntimeEnvInjections,
  buildAgentSessionOptions,
  pluginFingerprint,
  resolveAgentCwd,
  type RuntimeStartOptions,
} from "./pi-runtime-helpers";
import { refreshPiModels, resolvePiModelSelection } from "./pi-runtime-models";
import { piEventsAfter, piStatusFromEvents } from "./pi-runtime-state";
import { readEnabledOverrides } from "./pi-packages-store";
import { findSessionFile } from "./sessions-store";
import type { LoggedPiEvent, PiAgentSession } from "./pi-runtime-types";

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
export type PiResourceDiagnostic = {
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
  __vllmStudioPiResourceDiagnostics?: Map<string, PiResourceDiagnostic[]>;
};
function diagnosticsMap(): Map<string, PiResourceDiagnostic[]> {
  const g = globalThis as DiagnosticsGlobal;
  if (!g.__vllmStudioPiResourceDiagnostics) {
    g.__vllmStudioPiResourceDiagnostics = new Map();
  }
  return g.__vllmStudioPiResourceDiagnostics;
}

export function piResourceDiagnostics(agentDir?: string): PiResourceDiagnostic[] {
  const map = diagnosticsMap();
  if (agentDir) return map.get(agentDir) ?? [];
  return [...map.values()].flat();
}

export class PiSdkSession extends EventEmitter implements PiAgentSession {
  private runtime: AgentSessionRuntime | null = null;
  private unsubscribe: (() => void) | null = null;
  private eventSeq = 0;
  private eventLog: LoggedPiEvent[] = [];
  private activePromptCount = 0;
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
        // Per-extension disable overrides written by the plugins panel,
        // overlaid with any per-turn `/plugins` overrides from the composer.
        // The turn-level entries win because they're the user's most recent
        // explicit intent. We filter the SDK's loaded extension list AFTER
        // the loader has already executed each module; this preserves
        // load-error diagnostics while preventing disabled extensions from
        // contributing tools or handlers to the active session.
        const persistedOverrides = readEnabledOverrides();
        const turnOverrides = sessionOptions.extensionOverrides;
        const isEnabled = (extPath: string, source: string | undefined) => {
          // Turn-level override wins if either the path or the source is keyed.
          if (extPath in turnOverrides) return turnOverrides[extPath];
          if (source && source in turnOverrides) return turnOverrides[source];
          if (persistedOverrides[extPath] === false) return false;
          if (source && persistedOverrides[source] === false) return false;
          return true;
        };
        const services = await createAgentSessionServices({
          cwd,
          agentDir,
          resourceLoaderOptions: {
            additionalSkillPaths: sessionOptions.skills,
            // Hand the SDK absolute paths so its jiti-based loader handles
            // .ts/.js resolution. We avoid pre-importing via `import(variable)`
            // because Next/webpack's static analyser refuses dynamic specifiers.
            additionalExtensionPaths: sessionOptions.extensionPaths,
            additionalPromptTemplatePaths: sessionOptions.promptTemplatePaths,
            extensionsOverride: (base) => ({
              ...base,
              extensions: base.extensions.filter((ext) =>
                isEnabled(ext.path, ext.sourceInfo?.source),
              ),
            }),
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
  }

  async prompt(
    message: string,
    onEvent: (event: PiEvent, seq: number) => void,
    options: { streamingBehavior?: "steer" | "followUp"; images?: AgentImageInput[] } = {},
  ): Promise<void> {
    const session = this.requireSession();
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
    return this.requireSession().compact(customInstructions);
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
    return piStatusFromEvents({
      running: Boolean(this.runtime),
      activePromptCount: this.activePromptCount,
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
    return {
      tokens,
      contextWindow: usage.contextWindow,
      percent: typeof usage.percent === "number" ? usage.percent : null,
      shouldCompact:
        tokens !== null && usage.contextWindow > 0
          ? shouldCompact(tokens, usage.contextWindow, settings)
          : false,
    };
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
}
