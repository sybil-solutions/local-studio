import { Effect } from "effect";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import { findPaneByPiSessionId, paneSessionId } from "@/features/agent/runtime/selectors";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import {
  markSessionActivitySeen,
  publishOpenSessions,
  type OpenAgentSession,
} from "@/features/agent/session-index";
import type { ToolSelection } from "@/features/agent/tools/types";
import type { ComposerSkillRef } from "@/features/agent/composer-context";
import type {
  AgentModel,
  PaneId,
  WorkspaceAction,
  WorkspaceState,
} from "@/features/agent/workspace/types";
import {
  sessionMetaForPersistence,
  setupWarningFromPiCheck,
  type WorkspaceStorage,
} from "@/features/agent/workspace/store";
import { writePaneState } from "@/features/agent/workspace/persistence";
import { writeSessionDrafts } from "@/features/agent/workspace/session-drafts";
import { writeTranscriptSnapshot } from "@/features/agent/workspace/transcript-cache";
import { readDefaultAgentModel } from "@/features/agent/workspace/model-preference";
import { SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";

const EMPTY_SELECTION: ToolSelection = {
  skills: [],
  promptTemplates: [],
};

type SetupCheck = { id: string; ok: boolean; guidance?: string };

export type WorkspaceApi = {
  loadSetupChecks?: () => Promise<{ checks?: SetupCheck[] }>;
  loadModels?: () => Promise<{ models?: AgentModel[]; error?: string } | AgentModel[]>;
};

export type WorkspaceWindow = {
  Event: typeof Event;
  dispatchEvent: (event: Event) => boolean;
  setTimeout?: (handler: () => void, timeout: number) => unknown;
};

export type WorkspaceDispatch = (action: WorkspaceAction) => void;

export type WorkspaceEffectDeps = {
  storage: WorkspaceStorage;
  window: WorkspaceWindow;
  api: WorkspaceApi;
  dispatch?: WorkspaceDispatch;
  queueReplay: (paneId: PaneId, piSessionId: string) => void;
  selectionFor?: (sessionId: SessionId) => ToolSelection;
};

const PANE_STATE_ACTIONS = new Set<WorkspaceAction["type"]>([
  "setSplitRatio",
  "openSessionPayloadInPane",
  "splitPaneWithPayload",
  "focusPane",
  "focusPaneSession",
  "renameTab",
  "splitTab",
  "closePane",
  "urlNavRequested",
]);

const SESSIONS_CHANGED_ACTIONS = new Set<WorkspaceAction["type"]>([
  "openSessionPayloadInPane",
  "splitPaneWithPayload",
  "renameTab",
  "splitTab",
  "closePane",
  "setPaneSession",
  "setDetachedSession",
  "removeDetachedSession",
  "patchSession",
  "patchActiveTab",
  "notifySessionsChanged",
  "urlNavRequested",
]);

const METADATA_PATCH_ACTIONS = new Set<WorkspaceAction["type"]>([
  "setPaneSession",
  "patchSession",
  "patchActiveTab",
]);

function dispatchEvent(deps: WorkspaceEffectDeps, type: string): void {
  deps.window.dispatchEvent(new deps.window.Event(type));
}

function scheduleSessionsRefresh(deps: WorkspaceEffectDeps): void {
  dispatchEvent(deps, SESSIONS_CHANGED_EVENT);
  deps.window.setTimeout?.(() => dispatchEvent(deps, SESSIONS_CHANGED_EVENT), 1_500);
}

function normalizeModelsPayload(
  payload: { models?: AgentModel[]; error?: string } | AgentModel[],
): { models: AgentModel[]; error?: string } {
  return Array.isArray(payload)
    ? { models: payload }
    : { models: payload.models ?? [], error: payload.error };
}

function runInitialApiEffects(state: WorkspaceState, deps: WorkspaceEffectDeps): void {
  const loadSetupChecksEffect = deps.api.loadSetupChecks
    ? Effect.tryPromise({
        try: () => deps.api.loadSetupChecks?.() ?? Promise.resolve(null),
        catch: () => null,
      }).pipe(Effect.catch(() => Effect.succeed(null)))
    : Effect.succeed(null);

  if (deps.api.loadModels) {
    // Retry quietly with backoff: transient controller/network failures should
    // resolve themselves without the user having to reload the page. The error
    // notice stays visible (dismissible) until an attempt succeeds.
    const attemptLoadModels = (attempt: number): void => {
      deps.dispatch?.({ type: "setModelsLoading", loading: true });
      if (attempt === 0) deps.dispatch?.({ type: "setError", error: "" });
      void Effect.runPromise(
        Effect.gen(function* () {
          const payload = yield* Effect.tryPromise({
            try: () => deps.api.loadModels?.() ?? Promise.resolve([]),
            catch: (error) => error,
          });
          const normalized = normalizeModelsPayload(payload);
          if (normalized.error) return yield* Effect.fail(new Error(normalized.error));
          deps.dispatch?.({ type: "setError", error: "" });
          deps.dispatch?.({
            type: "setModels",
            models: normalized.models,
            preferredModelId: readDefaultAgentModel(deps.storage),
          });
          if (normalized.models.length > 0) {
            deps.dispatch?.({ type: "setSetupWarning", warning: "" });
          } else {
            const setupPayload = yield* loadSetupChecksEffect;
            const pi = setupPayload?.checks?.find((check) => check.id === "pi");
            deps.dispatch?.({
              type: "setSetupWarning",
              warning: setupWarningFromPiCheck(pi, false),
            });
          }
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              deps.dispatch?.({
                type: "setError",
                error: error instanceof Error ? error.message : "Failed to load models",
              });
              deps.dispatch?.({ type: "setModelsLoading", loading: false });
              const delay = Math.min(5_000 * 2 ** attempt, 60_000);
              deps.window.setTimeout?.(() => attemptLoadModels(attempt + 1), delay);
            }),
          ),
        ),
      );
    };
    attemptLoadModels(0);
  } else if (deps.api.loadSetupChecks) {
    void Effect.runPromise(
      loadSetupChecksEffect.pipe(
        Effect.map((payload) => {
          const pi = payload?.checks?.find((check) => check.id === "pi");
          deps.dispatch?.({
            type: "setSetupWarning",
            warning: setupWarningFromPiCheck(pi, state.models.length > 0),
          });
        }),
      ),
    );
  }
}

function openSessionSnapshot(
  state: WorkspaceState,
  tab: Session,
  selectionFor: (id: SessionId) => ToolSelection,
  paneId: string,
  focused: boolean,
): OpenAgentSession {
  const selection = selectionFor(tab.id);
  const usedSkills = usedSkillsForSession(tab);
  return {
    id: tab.id,
    threadId: tab.piSessionId,
    projectId: tab.projectId ?? "",
    cwd: tab.cwd ?? "",
    paneId,
    modelId: tab.modelId ?? state.selectedModel,
    title: cleanSessionTitle(tab.title) || (paneId ? "Current session" : "Background session"),
    status: tab.status,
    focused,
    startedAt: tab.startedAt,
    updatedAt: tab.startedAt ?? "",
    skills: selection.skills.length > 0 ? selection.skills : undefined,
    usedSkills: usedSkills.length > 0 ? usedSkills : undefined,
  };
}

function openSessionsFromWorkspace(
  state: WorkspaceState,
  selectionFor: (id: SessionId) => ToolSelection,
): OpenAgentSession[] | null {
  if (!state.hydrated) return null;
  const out: OpenAgentSession[] = [];
  const inPane = new Set<SessionId>();
  for (const [paneId, pane] of state.panesById.entries()) {
    const sessionId = paneSessionId(pane);
    const tab = sessionId ? state.sessions.get(sessionId) : undefined;
    if (!tab) continue;
    inPane.add(tab.id);
    if (!(Boolean(tab.piSessionId) || tab.messages.length > 0) || tab.status === "loading")
      continue;
    out.push(openSessionSnapshot(state, tab, selectionFor, paneId, paneId === state.focusedPaneId));
  }
  for (const tab of state.sessions.values()) {
    if (inPane.has(tab.id)) continue;
    if (tab.status !== "running" && tab.status !== "starting") continue;
    out.push(openSessionSnapshot(state, tab, selectionFor, "", false));
  }
  return out;
}

function usedSkillsForSession(tab: Pick<Session, "messages" | "usedSkills">): ComposerSkillRef[] {
  const byId = new Map<string, ComposerSkillRef>();
  for (const skill of tab.usedSkills ?? []) byId.set(skill.id || skill.path || skill.name, skill);
  for (const message of tab.messages) {
    for (const skill of message.skills ?? []) byId.set(skill.id || skill.path || skill.name, skill);
  }
  return [...byId.values()];
}

function storedSessionsKey(state: WorkspaceState): string {
  const entries: Array<{ id: string; title: string; cwd?: string }> = [];
  for (const tab of state.sessions.values()) {
    if (!tab.piSessionId) continue;
    entries.push({ id: tab.piSessionId, title: cleanSessionTitle(tab.title), cwd: tab.cwd });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(entries);
}

function openSessionsSignature(state: WorkspaceState): string {
  if (!state.hydrated) return "\u0000unhydrated";
  const parts: string[] = [`m:${state.selectedModel ?? ""}`, `f:${state.focusedPaneId ?? ""}`];
  for (const [paneId, pane] of state.panesById.entries())
    parts.push(`P:${paneId}>${pane.sessionId}`);
  for (const tab of state.sessions.values()) {
    parts.push(
      `S:${tab.id}|${tab.status}|${tab.piSessionId ?? ""}|` +
        `${tab.projectId ?? ""}|${tab.cwd ?? ""}|${tab.modelId ?? ""}|${tab.startedAt ?? ""}|` +
        `${tab.title ?? ""}|${tab.messages.length}|${tab.usedSkills?.length ?? 0}`,
    );
  }
  return parts.join("\n");
}

function publishWorkspaceSessions(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  if (openSessionsSignature(prevState) === openSessionsSignature(nextState)) return;
  const selectionFor = deps.selectionFor ?? (() => EMPTY_SELECTION);
  const next = openSessionsFromWorkspace(nextState, selectionFor);
  if (!next) return;
  publishOpenSessions(next);
  for (const session of next) {
    if (session.focused) markSessionActivitySeen(session.id, session.threadId);
  }
}

function queueLocatedReplay(
  piSessionId: string | null | undefined,
  state: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  if (!piSessionId) return;
  const located = findPaneByPiSessionId(state, piSessionId);
  if (located) deps.queueReplay(located.paneId, piSessionId);
}

function queueReplayEffects(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  switch (action.type) {
    case "openSessionPayloadInPane":
    case "splitPaneWithPayload":
      if (
        action.payload.piSessionId &&
        !findPaneByPiSessionId(prevState, action.payload.piSessionId)
      ) {
        queueLocatedReplay(action.payload.piSessionId, nextState, deps);
      }
      return;
    case "urlNavRequested":
      if (action.sessionId && !findPaneByPiSessionId(prevState, action.sessionId)) {
        queueLocatedReplay(action.sessionId, nextState, deps);
      }
      return;
    default:
      return;
  }
}

function persistActionEffects(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  if (prevState.sessionDrafts !== nextState.sessionDrafts) {
    writeSessionDrafts(deps.storage, nextState.sessionDrafts);
  }
  if (PANE_STATE_ACTIONS.has(action.type)) {
    writePaneState(deps.storage, nextState, deps.selectionFor);
    return;
  }
  if (
    METADATA_PATCH_ACTIONS.has(action.type) &&
    paneMetadataKey(prevState, deps.selectionFor) !== paneMetadataKey(nextState, deps.selectionFor)
  ) {
    writePaneState(deps.storage, nextState, deps.selectionFor);
  }
}

function paneMetadataKey(
  state: WorkspaceState,
  selectionFor: ((sessionId: SessionId) => ToolSelection | null) | undefined,
): string {
  const panes: Record<string, unknown> = {};
  for (const [paneId, pane] of state.panesById.entries()) {
    const sessionId = paneSessionId(pane);
    const session = sessionId ? state.sessions.get(sessionId) : undefined;
    panes[paneId] = {
      sessionId: pane.sessionId,
      tab: session
        ? sessionMetaForPersistence(session, selectionFor?.(pane.sessionId) ?? undefined)
        : null,
    };
  }
  return JSON.stringify({
    layout: state.layout,
    focusedPaneId: state.focusedPaneId,
    panes,
  });
}

function isSettledStatus(status: string): boolean {
  return status === "idle" || status === "done";
}

function transcriptSignature(session: Session): string {
  const last = session.messages[session.messages.length - 1];
  return [
    session.piSessionId ?? "",
    session.status,
    session.messages.length,
    last?.id ?? "",
    last?.text.length ?? 0,
    last?.blocks?.length ?? 0,
  ].join("|");
}

function persistSettledTranscripts(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  for (const [id, session] of nextState.sessions) {
    if (!session.piSessionId || session.messages.length === 0) continue;
    if (!isSettledStatus(session.status)) continue;
    const before = prevState.sessions.get(id);
    if (before && transcriptSignature(before) === transcriptSignature(session)) continue;
    writeTranscriptSnapshot(
      session.piSessionId,
      session.messages,
      cleanSessionTitle(session.title),
      deps.storage,
    );
  }
}

function persistTurnStartTranscripts(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  for (const [id, session] of nextState.sessions) {
    if (!session.piSessionId || session.messages.length === 0) continue;
    if (session.status !== "running" && session.status !== "starting") continue;
    const before = prevState.sessions.get(id);
    if (!before || before.status === session.status) continue;
    writeTranscriptSnapshot(
      session.piSessionId,
      session.messages,
      cleanSessionTitle(session.title),
      deps.storage,
    );
  }
}

function persistExitedTranscripts(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  for (const [id, session] of prevState.sessions) {
    if (!session.piSessionId || session.messages.length === 0) continue;
    if (nextState.sessions.has(id)) continue;
    writeTranscriptSnapshot(
      session.piSessionId,
      session.messages,
      cleanSessionTitle(session.title),
      deps.storage,
    );
  }
}

export function runWorkspaceEffect(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  persistActionEffects(action, prevState, nextState, deps);
  queueReplayEffects(action, prevState, nextState, deps);

  if (action.type === "hydrate") {
    runInitialApiEffects(nextState, deps);
  }

  publishWorkspaceSessions(prevState, nextState, deps);
  if (SESSIONS_CHANGED_ACTIONS.has(action.type)) {
    persistSettledTranscripts(prevState, nextState, deps);
    persistTurnStartTranscripts(prevState, nextState, deps);
    persistExitedTranscripts(prevState, nextState, deps);
  }
  if (
    SESSIONS_CHANGED_ACTIONS.has(action.type) &&
    storedSessionsKey(prevState) !== storedSessionsKey(nextState)
  ) {
    scheduleSessionsRefresh(deps);
  }
}
