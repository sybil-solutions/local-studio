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
import { Effect } from "effect";
import type { AgentImageInput } from "../../../shared/agent/agent-image-input";
import {
  applyRuntimeEnvInjections,
  buildAgentSessionOptionsSync,
  runtimeOptionsFingerprint,
  resolveAgentCwdEffect,
  type RuntimeStartOptions,
} from "./pi-runtime-helpers";
import { refreshPiModels, resolvePiModelSelection } from "./pi-runtime-models";
import { getProviderHub } from "./provider-hub";
import { attachGoalDriver } from "./goal-driver";
import { findRuntimeSessionForLookup, piStatusFromEvents } from "./pi-runtime-state";
import { findSessionFile } from "./sessions-store";
import { getGlobalSingleton } from "./instances";
import { connectorsRevisionSync } from "./connectors-service";
import type {
  LoggedPiEvent,
  PiAgentSession,
  PiAgentStatus,
  PiContextUsage,
} from "./pi-runtime-types";

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
    options: runtimeOptionsFingerprint(options),
    connectors: connectorsRevisionSync(),
  });
}

export function shouldRestartAfterPromptError(error: unknown): boolean {
  return (
    error instanceof Error && /Cannot continue from message role: assistant/i.test(error.message)
  );
}

type PiResourceDiagnostic = {
  type: "info" | "warning" | "error";
  message: string;
  path?: string;
};

function diagnosticsMap(): Map<string, PiResourceDiagnostic[]> {
  return getGlobalSingleton(
    "piResourceDiagnostics",
    () => new Map<string, PiResourceDiagnostic[]>(),
  );
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
  private lastError: string | null = null;
  private currentFingerprint = "";
  private currentPiSessionId: string | null = null;
  private currentCwd = "";
  private currentModelId = "";
  private currentStartOptions: RuntimeStartOptions = {};
  private agentDir = "";

  ensureStarted(
    modelId: string,
    cwd?: string,
    piSessionId?: string | null,
    options: RuntimeStartOptions = {},
  ): Promise<void> {
    return Effect.runPromise(this.ensureStartedEffect(modelId, cwd, piSessionId, options));
  }

  private ensureStartedEffect(
    modelId: string,
    cwd: string | undefined,
    piSessionId: string | null | undefined,
    options: RuntimeStartOptions,
  ): Effect.Effect<void, unknown> {
    return Effect.gen(
      function* (this: PiSdkSession) {
        const resolvedCwd = yield* resolveAgentCwdEffect(cwd);
        const desiredSessionId = piSessionId ?? null;
        const fingerprint = runtimeFingerprint(modelId, resolvedCwd, desiredSessionId, options);
        if (this.runtime && this.currentFingerprint === fingerprint) return;

        yield* this.stopEffect();
        this.eventSeq = 0;
        this.eventLog = [];
        this.activePromptCount = 0;
        this.lastError = null;

        const { models, agentDir } = yield* Effect.tryPromise({
          try: () => refreshPiModels(),
          catch: (error) => error,
        });
        const selectedModel = models.find(
          (model) => model.id === modelId || model.rawId === modelId || model.name === modelId,
        );
        if (!selectedModel) {
          return yield* Effect.fail(
            new Error(`Model '${modelId}' is not available from /v1/models.`),
          );
        }
        const resolvedSelection = resolvePiModelSelection(selectedModel.id);
        const providerId = selectedModel.providerId ?? resolvedSelection.providerId;
        const backendModelId = selectedModel.rawId ?? resolvedSelection.modelId;

        // One shared ModelRuntime across sessions and the provider hub: a
        // sign-in completed in settings is live for the next turn, and
        // hub-registered providers (including the e2e seam) resolve here.
        const sharedModelRuntime = yield* Effect.tryPromise({
          try: () => getProviderHub(),
          catch: (error) => error,
        });

        const sessionOptions = buildAgentSessionOptionsSync({ options });
        applyRuntimeEnvInjections(sessionOptions.envInjections);
        const sessionManager = SessionManager.create(resolvedCwd);
        const resumeFile = desiredSessionId ? findSessionFile(resolvedCwd, desiredSessionId) : null;
        if (resumeFile) sessionManager.setSessionFile(resumeFile);
        const resuming = Boolean(resumeFile);
        const runtime = yield* Effect.tryPromise({
          try: () =>
            createAgentSessionRuntime(
              ({ cwd, agentDir, sessionManager, sessionStartEvent }) =>
                Effect.runPromise(
                  Effect.gen(function* () {
                    const services = yield* Effect.tryPromise({
                      try: () =>
                        createAgentSessionServices({
                          cwd,
                          agentDir,
                          modelRuntime: sharedModelRuntime,
                          resourceLoaderOptions: {
                            noExtensions: true,
                            additionalSkillPaths: sessionOptions.skills,
                            additionalExtensionPaths: sessionOptions.extensionPaths,
                            additionalPromptTemplatePaths: sessionOptions.promptTemplatePaths,
                          },
                        }),
                      catch: (error) => error,
                    });
                    const model = services.modelRuntime.getModel(providerId, backendModelId);
                    if (!model) {
                      return yield* Effect.fail(
                        new Error(
                          `Model '${providerId}/${backendModelId}' is not available to the SDK runtime.`,
                        ),
                      );
                    }
                    const created = yield* Effect.tryPromise({
                      try: () =>
                        createAgentSessionFromServices({
                          services,
                          sessionManager,
                          sessionStartEvent,
                          model,
                          thinkingLevel: selectedModel.reasoning ? "high" : undefined,
                        }),
                      catch: (error) => error,
                    });
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
                  }),
                ),
              {
                cwd: resolvedCwd,
                agentDir,
                sessionManager,
                sessionStartEvent: {
                  type: "session_start",
                  reason: resuming ? "resume" : "startup",
                },
              },
            ),
          catch: (error) => error,
        });

        this.runtime = runtime;
        this.agentDir = agentDir;
        this.currentModelId = modelId;
        this.currentCwd = resolvedCwd;
        this.currentPiSessionId = runtime.session.sessionId || desiredSessionId;
        this.currentFingerprint = fingerprint;
        this.currentStartOptions = options;
        this.unsubscribe = runtime.session.subscribe((event) => this.recordEvent(event));
      }.bind(this),
    );
  }

  prompt(
    message: string,
    onEvent: (event: PiEvent, seq: number) => void,
    options: { streamingBehavior?: "steer" | "followUp"; images?: AgentImageInput[] } = {},
  ): Promise<void> {
    return Effect.runPromise(this.promptEffect(message, onEvent, options));
  }

  private promptEffect(
    message: string,
    onEvent: (event: PiEvent, seq: number) => void,
    options: { streamingBehavior?: "steer" | "followUp"; images?: AgentImageInput[] },
  ): Effect.Effect<void, unknown> {
    const listener = (logged: LoggedPiEvent) => onEvent(logged.event, logged.seq);
    this.on("loggedEvent", listener);
    this.activePromptCount += 1;
    this.lastError = null;
    return Effect.tryPromise({
      try: () => this.promptSession(message, options),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        shouldRestartAfterPromptError(error)
          ? this.restartPromptEffect(message, options)
          : Effect.fail(error),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          this.lastError = error instanceof Error ? error.message : String(error);
        }).pipe(Effect.andThen(Effect.fail(error))),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          this.activePromptCount = Math.max(0, this.activePromptCount - 1);
          this.off("loggedEvent", listener);
        }),
      ),
    );
  }

  private promptSession(
    message: string,
    options: { streamingBehavior?: "steer" | "followUp"; images?: AgentImageInput[] },
  ): Promise<void> {
    return this.requireSession().prompt(message, {
      streamingBehavior: options.streamingBehavior,
      images: options.images,
    });
  }

  private restartPromptEffect(
    message: string,
    options: { streamingBehavior?: "steer" | "followUp"; images?: AgentImageInput[] },
  ): Effect.Effect<void, unknown> {
    return this.ensureStartedEffect(
      this.currentModelId,
      this.currentCwd,
      null,
      this.currentStartOptions,
    ).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => this.promptSession(message, options),
          catch: (error) => error,
        }),
      ),
    );
  }

  steer(message: string, images: AgentImageInput[] = []): Promise<void> {
    return Effect.runPromise(
      Effect.tryPromise({
        try: () => this.requireSession().steer(message, images),
        catch: (error) => error,
      }),
    );
  }

  followUp(message: string, images: AgentImageInput[] = []): Promise<void> {
    return Effect.runPromise(
      Effect.tryPromise({
        try: () => this.requireSession().followUp(message, images),
        catch: (error) => error,
      }),
    );
  }

  adoptPiSessionId(piSessionId: string | null | undefined): void {
    const next = piSessionId?.trim();
    if (next && !this.currentPiSessionId) this.currentPiSessionId = next;
  }

  compact(customInstructions?: string): Promise<unknown> {
    return Effect.runPromise(this.compactEffect(customInstructions));
  }

  private compactEffect(customInstructions?: string): Effect.Effect<unknown, unknown> {
    if (this.activePromptCount > 0) {
      return Effect.fail(new Error("Cannot compact while the agent is running."));
    }
    return Effect.tryPromise({
      try: () => this.requireSession().compact(customInstructions),
      catch: (error) => error,
    });
  }

  abort(): Promise<void> {
    return Effect.runPromise(
      Effect.tryPromise({
        try: () => this.runtime?.session.abort() ?? Promise.resolve(),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.void)),
    );
  }

  stop(): Promise<void> {
    return Effect.runPromise(this.stopEffect());
  }

  private stopEffect(): Effect.Effect<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const runtime = this.runtime;
    this.runtime = null;
    if (!runtime) return Effect.void;
    return Effect.tryPromise({
      try: () => runtime.dispose(),
      catch: () => undefined,
    }).pipe(Effect.catch(() => Effect.void));
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
    attachGoalDriver(created);
    this.sessions.set(sessionId, created);
    return created;
  }

  getSessionForLookup(
    sessionId = DEFAULT_SESSION_ID,
    piSessionId?: string | null,
  ): { sessionId: string; session: PiAgentSession } {
    const resolved = this.findSessionForLookup(sessionId, piSessionId);
    if (resolved) return resolved;
    const target = piSessionId?.trim();
    const exactPiSessionId = this.sessions.get(sessionId)?.status.piSessionId;
    const runtimeSessionId =
      target && exactPiSessionId && exactPiSessionId !== target
        ? `${sessionId}:${target}`
        : sessionId;
    return { sessionId: runtimeSessionId, session: this.getSession(runtimeSessionId) };
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

export const piRuntimeManager = getGlobalSingleton(
  "piRuntimeManager",
  () => new PiRuntimeManager(),
);
