import { isAgentEndEvent } from "@/lib/agent/pi-events";
import {
  type ChatMessageAttachment,
  newId,
  nowLabel,
  piSessionIdFromEvent,
  sessionTitleFromPrompt,
  type AgentTurnSsePayload,
} from "@/lib/agent/session";
import {
  activeComposerPlugins,
  type ComposerPluginRef,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/lib/agent/composer-context";
import type { AgentImageInput } from "@/lib/agent/contracts/turn";
import type { BrowserBackend, ToolSelection } from "@/lib/agent/tools/types";
import { traceAgentReasoning } from "@/lib/agent/trace-reasoning";
import * as api from "./api";
import { runtimeIsActiveForPiSession } from "./engine-helpers";
import { drainQueuedTurnAfterAgentEnd } from "./queue-drain";
import { claimRuntimePromptStream, releaseRuntimePromptStream } from "./stream-ownership";
import type { Session, SessionId, SessionStatus } from "./types";

const EMPTY_PLUGINS: ComposerPluginRef[] = [];
const EMPTY_SKILLS: ComposerSkillRef[] = [];
const EMPTY_PROMPT_TEMPLATES: ComposerPromptTemplateRef[] = [];

type MutableRef<T> = { current: T };
type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;

export type SubmitArgs = {
  text: string;
  /** Pre-resolved prompt text (with attachments / context already merged). */
  prompt: string;
  displayText: string;
  userText: string;
  images?: AgentImageInput[];
  attachments?: ChatMessageAttachment[];
  browserToolEnabled?: boolean;
  plugins?: ComposerPluginRef[];
  skills?: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
  targetSessionId?: SessionId;
};

export type PromptStreamDeps = {
  activeTabId: SessionId;
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
  canvasEnabled: boolean;
  cwd: string;
  enqueuePiEvent: (
    sessionId: SessionId,
    assistantId: string,
    event: Record<string, unknown>,
    options?: { flushNow?: boolean },
  ) => void;
  flushPiEventBatch: (sessionId: SessionId) => void;
  liveAssistantIdsRef: MutableRef<Map<SessionId, string>>;
  modelId: string;
  onPiSessionIdChange?: (piSessionId: string) => void;
  promptStreamControllersRef: MutableRef<Map<string, AbortController>>;
  runtimeSessionId: string;
  selectionFor: (sessionId: SessionId) => ToolSelection;
  shouldApplyRuntimeSeq: (sessionId: SessionId, seq?: number) => boolean;
  submitPromptRef: MutableRef<(args: SubmitArgs) => Promise<void>>;
  tabsRef: MutableRef<Session[]>;
  updateSession: UpdateSession;
};

type PromptTurnContext = {
  assistantId: string;
  browserEnabledForTurn: boolean;
  plugins: ComposerPluginRef[];
  promptTemplates: ComposerPromptTemplateRef[];
  runtime: string;
  selected: Session;
  sessionId: SessionId;
  skills: ComposerSkillRef[];
  userId: string;
};

type PromptTurnState = {
  agentEnded: boolean;
  streamError: string;
};

export async function submitPromptTurn(deps: PromptStreamDeps, args: SubmitArgs): Promise<void> {
  const context = createPromptTurnContext(deps, args);
  if (!context) return;

  appendOptimisticPrompt(deps, context, args);
  const state = await streamPromptTurn(deps, context, args);
  if (state.agentEnded) {
    drainQueuedTurnAfterAgentEnd(deps, context.sessionId);
  }
}

function createPromptTurnContext(
  deps: PromptStreamDeps,
  args: SubmitArgs,
): PromptTurnContext | null {
  const sessionId = args.targetSessionId ?? deps.activeTabId;
  const selected = deps.tabsRef.current.find((tab) => tab.id === sessionId);
  if (!selected || !deps.modelId) return null;

  const selection = deps.selectionFor(sessionId);
  const plugins = args.plugins ?? activeComposerPlugins(selection.plugins ?? EMPTY_PLUGINS);
  const skills = args.skills ?? selection.skills ?? EMPTY_SKILLS;
  const promptTemplates =
    args.promptTemplates ?? selection.promptTemplates ?? EMPTY_PROMPT_TEMPLATES;

  return {
    assistantId: newId("assistant"),
    browserEnabledForTurn: args.browserToolEnabled ?? deps.browserToolEnabled,
    plugins,
    promptTemplates,
    runtime: selected.runtimeSessionId || deps.runtimeSessionId,
    selected,
    sessionId,
    skills,
    userId: newId("user"),
  };
}

function appendOptimisticPrompt(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  args: SubmitArgs,
): void {
  deps.updateSession(context.sessionId, (session) => ({
    ...session,
    cwd: session.cwd || deps.cwd,
    modelId: session.modelId || deps.modelId,
    startedAt: session.startedAt ?? new Date().toISOString(),
    input: "",
    error: "",
    status: "starting",
    usedSkills: mergeSkills(session.usedSkills, context.skills),
    activeAssistantId: context.assistantId,
    title:
      session.messages.filter((message) => message.role === "user").length === 0
        ? sessionTitleFromPrompt(args.userText)
        : session.title,
    messages: [
      ...session.messages,
      {
        id: context.userId,
        role: "user",
        text: args.displayText,
        attachments: args.attachments,
        skills: context.skills,
        timestamp: nowLabel(),
      },
      { id: context.assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
    ],
  }));
}

async function streamPromptTurn(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  args: SubmitArgs,
): Promise<PromptTurnState> {
  const state: PromptTurnState = { agentEnded: false, streamError: "" };
  const controller = new AbortController();
  const streamOwnerId = `${context.sessionId}:${context.assistantId}`;
  deps.liveAssistantIdsRef.current.set(context.sessionId, context.assistantId);
  deps.promptStreamControllersRef.current.set(context.runtime, controller);
  claimRuntimePromptStream(context.runtime, streamOwnerId, controller);

  try {
    await api.submitTurnStream(
      promptTurnRequest(deps, context, args),
      (payload) => applyPromptPayload(deps, context, state, controller, payload),
      { signal: controller.signal },
    );
  } catch (error) {
    if (!controller.signal.aborted) {
      state.streamError = error instanceof Error ? error.message : "Agent request failed";
    }
  } finally {
    await finalizePromptTurn(deps, context, state, streamOwnerId);
  }

  return state;
}

function promptTurnRequest(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  args: SubmitArgs,
): api.SubmitTurnArgs {
  return {
    sessionId: context.runtime,
    modelId: deps.modelId,
    message: args.prompt,
    images: args.images,
    cwd: deps.cwd.trim() || undefined,
    piSessionId:
      deps.tabsRef.current.find((tab) => tab.id === context.sessionId)?.piSessionId ??
      context.selected.piSessionId,
    browserToolEnabled: context.browserEnabledForTurn,
    browserSessionId: context.runtime,
    browserBackend: deps.browserBackend,
    canvasEnabled: deps.canvasEnabled,
    plugins: context.plugins,
    skills: context.skills,
    promptTemplates: context.promptTemplates,
  };
}

function applyPromptPayload(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  state: PromptTurnState,
  controller: AbortController,
  payload: AgentTurnSsePayload,
): void {
  if (controller.signal.aborted) return;
  if (payload.type === "status") {
    applyPromptStatusPayload(deps, context, payload);
  } else if (payload.type === "error") {
    applyPromptErrorPayload(deps, context, state, payload.error);
  } else {
    applyPromptPiPayload(deps, context, state, payload);
  }
}

function applyPromptStatusPayload(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  payload: Extract<AgentTurnSsePayload, { type: "status" }>,
): void {
  const phase = payload.phase;
  deps.updateSession(context.sessionId, (session) => ({
    ...session,
    piSessionId: payload.piSessionId || session.piSessionId,
    contextUsage: api.runtimeContextUsage(payload.session, session.contextUsage),
    status: (phase === "done" ? "idle" : phase) as SessionStatus,
    activeAssistantId: phase === "done" ? undefined : session.activeAssistantId,
  }));
  if (payload.piSessionId) deps.onPiSessionIdChange?.(payload.piSessionId);
}

function applyPromptErrorPayload(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  state: PromptTurnState,
  error: string,
): void {
  state.streamError = error;
  deps.flushPiEventBatch(context.sessionId);
  deps.updateSession(context.sessionId, (session) => ({
    ...session,
    error,
    status: "idle",
  }));
}

function applyPromptPiPayload(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  state: PromptTurnState,
  payload: Extract<AgentTurnSsePayload, { type: "pi" }>,
): void {
  if (!deps.shouldApplyRuntimeSeq(context.sessionId, payload.seq)) return;
  const piEvent = payload.event;
  traceAgentReasoning("engine.pi", {
    sessionId: context.sessionId,
    assistantId: context.assistantId,
    seq: payload.seq,
    event: piEvent,
  });
  const eventId = piSessionIdFromEvent(piEvent);
  if (eventId) {
    deps.updateSession(context.sessionId, (session) => ({ ...session, piSessionId: eventId }));
    deps.onPiSessionIdChange?.(eventId);
  }
  if (isAgentEndEvent(piEvent)) {
    state.agentEnded = true;
    deps.onPiSessionIdChange?.(latestPiSessionId(deps, context, eventId));
  }
  deps.enqueuePiEvent(context.sessionId, context.assistantId, piEvent, {
    flushNow: state.agentEnded,
  });
}

function latestPiSessionId(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  eventId: string | null,
): string {
  return (
    eventId ??
    deps.tabsRef.current.find((tab) => tab.id === context.sessionId)?.piSessionId ??
    context.selected.piSessionId ??
    ""
  );
}

async function finalizePromptTurn(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  state: PromptTurnState,
  streamOwnerId: string,
): Promise<void> {
  deps.flushPiEventBatch(context.sessionId);
  deps.promptStreamControllersRef.current.delete(context.runtime);
  releaseRuntimePromptStream(context.runtime, streamOwnerId);
  deps.liveAssistantIdsRef.current.delete(context.sessionId);
  const currentPiSessionId =
    deps.tabsRef.current.find((tab) => tab.id === context.sessionId)?.piSessionId ??
    context.selected.piSessionId ??
    null;
  const runtimeStatus = await api.loadRuntimeStatus(context.runtime, currentPiSessionId);
  const runtimeStillActive =
    !state.agentEnded && runtimeIsActiveForPiSession(runtimeStatus, currentPiSessionId);
  deps.updateSession(context.sessionId, (session) => ({
    ...session,
    status: runtimeStillActive ? "running" : "idle",
    activeAssistantId: runtimeStillActive ? context.assistantId : undefined,
    error: state.streamError && !runtimeStillActive ? state.streamError : session.error,
    contextUsage: api.runtimeContextUsage(runtimeStatus, session.contextUsage),
  }));
}

function mergeSkills(
  existing: ComposerSkillRef[] | undefined,
  next: ComposerSkillRef[],
): ComposerSkillRef[] | undefined {
  if (!existing?.length && next.length === 0) return existing;
  const byId = new Map<string, ComposerSkillRef>();
  for (const skill of existing ?? []) byId.set(skill.id || skill.path || skill.name, skill);
  for (const skill of next) byId.set(skill.id || skill.path || skill.name, skill);
  return [...byId.values()];
}
