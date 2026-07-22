import { Effect } from "effect";
import {
  type ChatMessageAttachment,
  newId,
  nowLabel,
  runtimeStatusLooksActive,
  sessionTitleFromPrompt,
} from "@/features/agent/messages";
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import type {
  AgentImageInput,
  AgentThinkingLevel,
  AgentToolAccess,
} from "@/features/agent/contracts";
import type { BrowserBackend, ToolSelection } from "@/features/agent/tools/types";
import * as api from "@/features/agent/runtime/api";
import type { RuntimeStatus } from "@/features/agent/runtime/api";
import { sessionRuntimeController } from "@/features/agent/runtime/session-runtime-controller";
import type { Session, SessionId, UpdateSession } from "@/features/agent/runtime/types";
import { settleTurn } from "@/features/agent/runtime/session-status";

const EMPTY_SKILLS: ComposerSkillRef[] = [];
const EMPTY_PROMPT_TEMPLATES: ComposerPromptTemplateRef[] = [];

type MutableRef<T> = { current: T };

export type SubmitArgs = {
  text: string;
  /** Pre-resolved prompt text (with attachments / context already merged). */
  prompt: string;
  displayText: string;
  userText: string;
  images?: AgentImageInput[];
  attachments?: ChatMessageAttachment[];
  browserToolEnabled?: boolean;
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
  modelId: string;
  thinkingLevel: AgentThinkingLevel;
  toolAccess: AgentToolAccess;
  onPiSessionIdChange?: (piSessionId: string) => void;
  selectionFor: (sessionId: SessionId) => ToolSelection;
  tabsRef: MutableRef<Session[]>;
  updateSession: UpdateSession;
};

type PromptTurnContext = {
  assistantId: string;
  browserEnabledForTurn: boolean;
  promptTemplates: ComposerPromptTemplateRef[];
  runtime: string;
  selected: Session;
  sessionId: SessionId;
  skills: ComposerSkillRef[];
  userId: string;
};

export type SessionSubmitGuard = Set<SessionId>;

export function beginSessionSubmit(
  guard: SessionSubmitGuard,
  sessionId: SessionId | null | undefined,
): boolean {
  if (!sessionId || guard.has(sessionId)) return false;
  guard.add(sessionId);
  return true;
}

export function endSessionSubmit(
  guard: SessionSubmitGuard,
  sessionId: SessionId | null | undefined,
): void {
  if (!sessionId) return;
  guard.delete(sessionId);
}

export function submitPromptTurn(deps: PromptStreamDeps, args: SubmitArgs): Promise<void> {
  const context = createPromptTurnContext(deps, args);
  if (!context) return Promise.resolve();

  appendOptimisticPrompt(deps, context, args);
  return startPromptCommand(deps, context, args);
}

function createPromptTurnContext(
  deps: PromptStreamDeps,
  args: SubmitArgs,
): PromptTurnContext | null {
  const sessionId = args.targetSessionId ?? deps.activeTabId;
  const selected = deps.tabsRef.current.find((tab) => tab.id === sessionId);
  if (!selected || !deps.modelId) return null;

  const selection = deps.selectionFor(sessionId);
  const skills = args.skills ?? selection.skills ?? EMPTY_SKILLS;
  const promptTemplates =
    args.promptTemplates ?? selection.promptTemplates ?? EMPTY_PROMPT_TEMPLATES;

  return {
    assistantId: newId("assistant"),
    browserEnabledForTurn: args.browserToolEnabled ?? deps.browserToolEnabled,
    promptTemplates,
    // The session id is the opaque runtime key the server addresses this
    // session by.
    runtime: selected.id,
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

function startPromptCommand(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  args: SubmitArgs,
): Promise<void> {
  const program = Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => api.submitTurnCommand(promptTurnRequest(deps, context, args)),
      catch: (error) => ({ _tag: "SubmitFailed" as const, error }),
    });
    deps.updateSession(context.sessionId, (session) => ({
      ...session,
      piSessionId: result.piSessionId || session.piSessionId,
      contextUsage: api.runtimeContextUsage(result.status, session.contextUsage),
      status: "running",
      activeAssistantId: session.activeAssistantId ?? context.assistantId,
    }));
    sessionRuntimeController().noteTurnAccepted(
      context.sessionId,
      context.assistantId,
      result.status?.eventSeq,
    );
    if (result.piSessionId) deps.onPiSessionIdChange?.(result.piSessionId);
  }).pipe(
    Effect.catch(({ error }) =>
      Effect.gen(function* () {
        const currentPiSessionId = latestPiSessionId(deps, context, null);
        const status = yield* Effect.tryPromise({
          try: () => api.loadRuntimeStatus(context.runtime, currentPiSessionId),
          catch: () => null,
        });
        if (runtimeIsActiveForPiSession(status, currentPiSessionId)) {
          deps.updateSession(context.sessionId, (session) => ({
            ...session,
            piSessionId: status?.piSessionId || session.piSessionId,
            contextUsage: api.runtimeContextUsage(status, session.contextUsage),
            status: "running",
            activeAssistantId: session.activeAssistantId ?? context.assistantId,
          }));
          sessionRuntimeController().noteTurnAccepted(
            context.sessionId,
            context.assistantId,
            status?.eventSeq,
          );
          if (status?.piSessionId) deps.onPiSessionIdChange?.(status?.piSessionId);
          return;
        }
        const message = error instanceof Error ? error.message : "Agent request failed";
        deps.updateSession(context.sessionId, (session) =>
          settleFailedTurn(session, context.assistantId, message),
        );
      }),
    ),
  );
  return Effect.runPromise(program);
}

/**
 * Settle a turn whose submit failed and whose runtime probe confirmed it never
 * took. A second prompt may have superseded this turn while the failed POST and
 * the liveness probe were in flight (both are awaited), giving the session a new
 * `activeAssistantId` and `starting`/`running` status. Only surface the error and
 * idle the session when it is STILL on this turn's bubble; otherwise the newer
 * turn owns the intent state and clobbering it would strand the in-flight turn
 * with no live-target bubble. Mirrors the success path's non-clobbering guard.
 */
export function settleFailedTurn(session: Session, assistantId: string, message: string): Session {
  if (session.activeAssistantId && session.activeAssistantId !== assistantId) return session;
  return { ...settleTurn(session), error: message };
}

function promptTurnRequest(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  args: SubmitArgs,
): api.SubmitTurnArgs {
  return {
    sessionId: context.runtime,
    modelId: deps.modelId,
    thinkingLevel: deps.thinkingLevel,
    toolAccess: deps.toolAccess,
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
    skills: context.skills,
    promptTemplates: context.promptTemplates,
  };
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

export function runtimeIsActiveForPiSession(
  runtimeStatus: RuntimeStatus | null | undefined,
  piSessionId: string | null | undefined,
): boolean {
  return Boolean(
    runtimeStatus &&
    runtimeStatusLooksActive(runtimeStatus) &&
    (!runtimeStatus.piSessionId || !piSessionId || runtimeStatus.piSessionId === piSessionId),
  );
}

export function runtimeCanHydrateCanonicalSession(
  runtimeStatus: RuntimeStatus | null | undefined,
  piSessionId: string,
): boolean {
  return Boolean(
    runtimeStatus?.active === true &&
    (!runtimeStatus.piSessionId || runtimeStatus.piSessionId === piSessionId),
  );
}
