import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createAgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import {
  controlTargetHasActiveTurn,
  isAgentThinkingLevel,
  parseAgentTurnRequest,
  type AgentThinkingLevel,
  type AgentTurnCommandResult,
  type AgentTurnRequest,
} from "../../../../shared/agent/agent-turn";
import type { AgentImageInput } from "../../../../shared/agent/agent-image-input";
import {
  AGENT_TURN_BODY_LIMIT_BYTES,
  readJsonRequestWithinLimit,
} from "../../../../shared/agent/agent-turn-body";
import {
  sanitizeComposerPromptTemplates,
  sanitizeComposerSkills,
  selectedContextInstructions,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "../../../../shared/agent/composer-refs";
import { piResourceDiagnostics, piRuntimeManager } from "../pi-runtime";
import { isAgentSettledEvent } from "../pi-runtime-state";
import type { LoggedPiEvent, PiAgentSession, PiAgentStatus } from "../pi-runtime-types";
import { listSessions } from "../sessions-store";
import { errorMessage, jsonError } from "./helpers";
import {
  initialRuntimeStatusPhase,
  replayAfterCursor,
  shouldSendTrailingIdleStatus,
} from "./stream-order";

// ─── POST /api/agent/turn ─────────────────────────────────────────────────

function adoptRuntimePiSessionId(session: unknown, piSessionId: string | null | undefined) {
  const next = piSessionId?.trim();
  if (!next || !session || typeof session !== "object") return;
  const runtime = session as {
    adoptPiSessionId?: (value: string) => void;
    currentPiSessionId?: string | null;
  };
  if (typeof runtime.adoptPiSessionId === "function") {
    runtime.adoptPiSessionId(next);
  } else if (!runtime.currentPiSessionId) {
    runtime.currentPiSessionId = next;
  }
}

type ResolvedTurnSession = {
  effectivePiSessionId: string | null;
  effectiveStreamingBehavior: AgentTurnRequest["streamingBehavior"];
  controlTargetActive: boolean;
  session: PiAgentSession;
  sessionId: string;
};

function resolveTurnSession(turn: AgentTurnRequest): ResolvedTurnSession | null {
  const resolved =
    turn.mode === "prompt"
      ? piRuntimeManager.getSessionForLookup(turn.sessionId, turn.piSessionId)
      : piRuntimeManager.findSessionForLookup(turn.sessionId, turn.piSessionId);
  if (!resolved) return null;
  const status = resolved.session.status;
  const controlTargetActive = controlTargetHasActiveTurn(status);
  return {
    effectivePiSessionId: effectivePiSessionId(turn, status, controlTargetActive),
    effectiveStreamingBehavior: effectiveStreamingBehavior(turn, status),
    controlTargetActive,
    session: resolved.session,
    sessionId: resolved.sessionId,
  };
}

function effectivePiSessionId(
  turn: AgentTurnRequest,
  status: PiAgentStatus,
  controlTargetActive: boolean,
) {
  if (turn.mode === "prompt") return turn.piSessionId;
  return controlTargetActive ? (status.piSessionId ?? turn.piSessionId) : turn.piSessionId;
}

function effectiveStreamingBehavior(turn: AgentTurnRequest, status: PiAgentStatus) {
  if (turn.mode === "prompt" && status.active === true) return turn.streamingBehavior ?? "steer";
  return turn.streamingBehavior;
}

function ensurePromptRuntimeEffect(
  turn: AgentTurnRequest,
  resolved: ResolvedTurnSession,
): Effect.Effect<void, unknown> {
  return Effect.tryPromise({
    try: () =>
      resolved.session.ensureStarted(turn.modelId, turn.cwd, resolved.effectivePiSessionId, {
        thinkingLevel: turn.thinkingLevel,
        toolAccess: turn.toolAccess,
        browserToolEnabled: turn.browserToolEnabled,
        browserSessionId: turn.browserSessionId,
        browserBackend: turn.browserBackend,
        planSessionId: resolved.sessionId,
        canvasEnabled: turn.canvasEnabled,
        skills: turn.skills,
        promptTemplates: turn.promptTemplates,
      }),
    catch: (error) => error,
  });
}

function launchPrompt(
  turn: AgentTurnRequest,
  resolved: ResolvedTurnSession,
  commandImages: AgentImageInput[] | undefined,
) {
  void Effect.runPromise(
    Effect.tryPromise({
      try: () =>
        resolved.session.prompt(turn.message, () => undefined, {
          streamingBehavior: resolved.effectiveStreamingBehavior,
          ...(commandImages ? { images: commandImages } : {}),
        }),
      catch: (error) => error,
    }).pipe(Effect.catch(() => Effect.void)),
  );
}

function dispatchControlEffect(
  turn: AgentTurnRequest,
  resolved: ResolvedTurnSession,
  commandImages: AgentImageInput[] | undefined,
): Effect.Effect<"queued" | "rejected", unknown> {
  if (!resolved.controlTargetActive) return Effect.succeed("rejected");
  if (turn.mode === "steer") {
    return Effect.tryPromise({
      try: () => resolved.session.steer(turn.message, commandImages),
      catch: (error) => error,
    }).pipe(Effect.map(() => "queued" as const));
  }
  if (turn.mode === "follow_up") {
    return Effect.tryPromise({
      try: () => resolved.session.followUp(turn.message, commandImages),
      catch: (error) => error,
    }).pipe(Effect.map(() => "queued" as const));
  }
  return Effect.succeed("rejected");
}

function resolvePiSessionIdEffect(
  session: PiAgentSession,
  since: Date,
): Effect.Effect<string | null, unknown> {
  const status = session.status;
  if (status.piSessionId || !status.cwd) return Effect.succeed(status.piSessionId);
  return Effect.tryPromise({
    try: () => listSessions(status.cwd, { since }),
    catch: (error) => error,
  }).pipe(Effect.map((recent) => recent[0]?.id ?? null));
}

function commandResult(
  outcome: AgentTurnCommandResult["outcome"],
  resolved: ResolvedTurnSession,
  options: { error?: string; piSessionId?: string | null } = {},
): AgentTurnCommandResult {
  const status = resolved.session.status;
  return {
    type: "command",
    outcome,
    runtimeSessionId: resolved.sessionId,
    piSessionId: options.piSessionId ?? status.piSessionId,
    active: status.active,
    status,
    ...(options.error ? { error: options.error } : {}),
  };
}

export function handleAgentTurn(request: Request): Promise<Response> {
  return Effect.runPromise(turnRouteEffect(request));
}

function turnRouteEffect(request: Request): Effect.Effect<Response, unknown> {
  return Effect.gen(function* () {
    const body = yield* Effect.promise(() =>
      readJsonRequestWithinLimit(request, AGENT_TURN_BODY_LIMIT_BYTES),
    );
    if (!body.ok) return jsonError(body.error, body.status);
    const parsed = parseAgentTurnRequest(body.value);
    if (!parsed.ok) return jsonError(parsed.error);
    const turn = parsed.value;
    const commandImages = turn.images.length ? turn.images : undefined;

    return yield* Effect.gen(function* () {
      const turnStartedAt = new Date(Date.now() - 2_000);
      const resolved = resolveTurnSession(turn);
      if (!resolved) {
        const result: AgentTurnCommandResult = {
          type: "command",
          outcome: "rejected",
          runtimeSessionId: turn.sessionId,
          piSessionId: turn.piSessionId,
          active: false,
          error: "Runtime session is no longer active.",
        };
        return Response.json(result, { status: 409 });
      }

      if (turn.mode === "prompt") {
        yield* ensurePromptRuntimeEffect(turn, resolved);
        launchPrompt(turn, resolved, commandImages);
        const resolvedPiSessionId = yield* resolvePiSessionIdEffect(
          resolved.session,
          turnStartedAt,
        );
        adoptRuntimePiSessionId(resolved.session, resolvedPiSessionId);
        return Response.json(
          commandResult(resolved.effectiveStreamingBehavior ? "queued" : "accepted", resolved, {
            piSessionId: resolvedPiSessionId,
          }),
        );
      }

      const controlOutcome = yield* dispatchControlEffect(turn, resolved, commandImages);
      if (controlOutcome === "rejected") {
        return Response.json(
          commandResult("rejected", resolved, {
            error: "Runtime session is no longer active.",
          }),
          { status: 409 },
        );
      }
      return Response.json(commandResult("queued", resolved));
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          Response.json(
            {
              type: "command",
              outcome: "rejected",
              runtimeSessionId: turn.sessionId,
              piSessionId: turn.piSessionId,
              active: false,
              error: errorMessage(error, "Pi agent turn failed"),
            } satisfies AgentTurnCommandResult,
            { status: 500 },
          ),
        ),
      ),
    );
  });
}

// ─── POST /api/agent/abort ────────────────────────────────────────────────

export async function handleAgentAbort(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { sessionId?: string };
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : "default";
  await piRuntimeManager.getSession(sessionId).abort();
  return Response.json({ ok: true });
}

export async function handleExtensionUiResponse(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | {
        sessionId?: unknown;
        requestId?: unknown;
        value?: unknown;
        confirmed?: unknown;
        cancelled?: unknown;
      }
    | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
  if (!sessionId || !requestId) return jsonError("sessionId and requestId are required");
  const resolved = piRuntimeManager.findSessionForLookup(sessionId);
  if (!resolved) return jsonError("Runtime session not found", 404);
  const accepted = resolved.session.respondExtensionUi(requestId, {
    ...(typeof body?.value === "string" ? { value: body.value.slice(0, 32_000) } : {}),
    ...(typeof body?.confirmed === "boolean" ? { confirmed: body.confirmed } : {}),
    cancelled: body?.cancelled === true,
  });
  return accepted ? Response.json({ ok: true }) : jsonError("Extension request is no longer active", 409);
}

// ─── POST /api/agent/compact ──────────────────────────────────────────────

type CompactRequest = {
  sessionId?: string;
  modelId?: string;
  thinkingLevel?: AgentThinkingLevel;
  toolAccess?: "read_only" | "full";
  cwd?: string;
  piSessionId?: string | null;
  customInstructions?: string;
  browserToolEnabled?: boolean;
  browserSessionId?: string;
  browserBackend?: "embedded" | "sitegeist";
  canvasEnabled?: boolean;
  skills?: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
};

function compactInstructions(skills: ComposerSkillRef[], custom?: string): string | undefined {
  const selected = selectedContextInstructions(skills);
  let extra = custom?.trim() || "";
  if (selected && extra) {
    if (selected.includes(extra)) extra = "";
    else if (extra.includes(selected)) extra = extra.replace(selected, "").trim();
  }
  const additional = extra ? `Additional compaction instructions:\n${extra}` : null;
  return [selected, additional].filter((value): value is string => Boolean(value)).join("\n\n");
}

export function handleAgentCompact(request: Request): Promise<Response> {
  return Effect.runPromise(compactRouteEffect(request));
}

function compactRouteEffect(request: Request): Effect.Effect<Response, unknown> {
  return Effect.gen(function* () {
    const body = (yield* Effect.tryPromise({
      try: () => request.json(),
      catch: () => null,
    })) as CompactRequest | null;
    if (!body) return jsonError("Invalid JSON body");

    const sessionId = body.sessionId?.trim() || "default";
    const modelId = body.modelId?.trim();
    const cwd = body.cwd?.trim() || undefined;
    const piSessionId = body.piSessionId?.trim() || null;
    if (!modelId) return jsonError("modelId is required");
    if (body.thinkingLevel != null && !isAgentThinkingLevel(body.thinkingLevel)) {
      return jsonError("thinkingLevel must be a supported reasoning level");
    }

    return yield* Effect.gen(function* () {
      const session = piRuntimeManager.getSession(sessionId);
      const skills = sanitizeComposerSkills(body.skills);
      const promptTemplates = sanitizeComposerPromptTemplates(body.promptTemplates);
      yield* Effect.tryPromise({
        try: () =>
          session.ensureStarted(modelId, cwd, piSessionId, {
            thinkingLevel: body.thinkingLevel,
            toolAccess: body.toolAccess === "full" ? "full" : "read_only",
            browserToolEnabled: body.browserToolEnabled === true,
            browserSessionId:
              typeof body.browserSessionId === "string" ? body.browserSessionId.trim() : undefined,
            browserBackend: body.browserBackend === "sitegeist" ? "sitegeist" : "embedded",
            canvasEnabled: body.canvasEnabled === true,
            skills,
            promptTemplates,
          }),
        catch: (error) => error,
      });
      const result = yield* Effect.tryPromise({
        try: () => session.compact(compactInstructions(skills, body.customInstructions)),
        catch: (error) => error,
      });
      return Response.json({ ok: true, result, status: session.status });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(jsonError(errorMessage(error, "Compaction failed"), 409)),
      ),
    );
  });
}

// ─── GET /api/agent/runtime/sessions ──────────────────────────────────────

export function handleRuntimeSessions(): Response {
  return Response.json({
    sessions: piRuntimeManager
      .listSessions()
      .map(({ sessionId, session }) => ({ sessionId, status: session.status })),
  });
}

// ─── GET /api/agent/runtime/status ────────────────────────────────────────

export function handleRuntimeStatus(request: Request): Response {
  const searchParams = new URL(request.url).searchParams;
  const sessionId = searchParams.get("sessionId")?.trim() || "default";
  const piSessionId = searchParams.get("piSessionId")?.trim() || null;
  const after = Number(searchParams.get("after") ?? 0);
  const resolved = piRuntimeManager.findSessionForLookup(sessionId, piSessionId);
  if (!resolved) {
    return Response.json({ sessionId, status: null, events: [] });
  }
  const afterSeq = replayAfterCursor(
    Number.isFinite(after) ? after : 0,
    resolved.session.status.eventSeq,
  );
  return Response.json({
    sessionId: resolved.sessionId,
    status: resolved.session.status,
    events: resolved.session.getEventsAfter(afterSeq),
  });
}

// ─── GET /api/agent/runtime/events (SSE) ──────────────────────────────────

function parseSeq(value: string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function encode(payload: unknown, id?: number): Uint8Array {
  const prefix = id === undefined ? "" : `id: ${id}\n`;
  return new TextEncoder().encode(`${prefix}data: ${JSON.stringify(payload)}\n\n`);
}

export function handleRuntimeEvents(request: Request): Response {
  const searchParams = new URL(request.url).searchParams;
  const sessionId = searchParams.get("sessionId")?.trim() || "default";
  const piSessionId = searchParams.get("piSessionId")?.trim() || null;
  const requestedAfter = Math.max(
    parseSeq(searchParams.get("after")),
    parseSeq(request.headers.get("last-event-id")),
  );
  const resolved = piRuntimeManager.findSessionForLookup(sessionId, piSessionId);
  if (!resolved) {
    return Response.json({ error: "Runtime session not found" }, { status: 404 });
  }
  const session = resolved.session;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let off = () => {};
      let ping: ReturnType<typeof setInterval> | null = null;
      let replaying = true;
      const replayQueue: LoggedPiEvent[] = [];
      const sentSeqs = new Set<number>();
      let after = replayAfterCursor(requestedAfter, session.status.eventSeq);
      const safeSend = (payload: unknown, id?: number) => {
        if (closed) return;
        try {
          controller.enqueue(encode(payload, id));
        } catch {
          close();
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        off();
        if (ping) clearInterval(ping);
        try {
          controller.close();
        } catch {
          // client already closed
        }
      };

      const sendLogged = (logged: LoggedPiEvent) => {
        after = replayAfterCursor(after, session.status.eventSeq);
        if (logged.seq <= after || sentSeqs.has(logged.seq)) return;
        sentSeqs.add(logged.seq);
        safeSend({ type: "pi", seq: logged.seq, event: logged.event }, logged.seq);
        if (isAgentSettledEvent(logged.event)) {
          safeSend({ type: "status", phase: "done", session: session.status });
          setTimeout(close, 25);
        }
      };
      const onLiveEvent = (logged: LoggedPiEvent) => {
        if (replaying) {
          replayQueue.push(logged);
          return;
        }
        sendLogged(logged);
      };

      off = session.onLoggedEvent(onLiveEvent);
      const backlog = session.getEventsAfter(after);
      const initialPhase = initialRuntimeStatusPhase(session.status.active, backlog.length);
      if (initialPhase) {
        safeSend({
          type: "status",
          phase: initialPhase,
          session: session.status,
        });
      }
      let sentTerminalStatus = false;
      for (const logged of backlog) {
        sendLogged(logged);
        if (isAgentSettledEvent(logged.event)) sentTerminalStatus = true;
      }
      replaying = false;
      for (const logged of replayQueue) {
        sendLogged(logged);
        if (isAgentSettledEvent(logged.event)) sentTerminalStatus = true;
      }
      if (
        shouldSendTrailingIdleStatus({
          active: session.status.active,
          replayBacklogCount: backlog.length + replayQueue.length,
          sentTerminalStatus,
        })
      ) {
        safeSend({ type: "status", phase: "idle", session: session.status });
      }

      ping = setInterval(() => {
        if (!session.status.active) {
          safeSend({ type: "status", phase: "idle", session: session.status });
          close();
          return;
        }
        safeSend({ type: "status", phase: "running", session: session.status });
      }, 20_000);

      request.signal.addEventListener("abort", close);
      if (!session.status.active) {
        setTimeout(close, 25);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── GET /api/agent/setup-checks ──────────────────────────────────────────

export function handleSetupChecks(): Response {
  const codexDir = path.join(homedir(), ".codex");
  const piDir = path.join(homedir(), ".pi");
  // First-party extension load failures captured during the most recent SDK
  // runtime creation. User/drop-in Pi extensions are intentionally disabled.
  const diagnostics = piResourceDiagnostics();
  return Response.json({
    checks: [
      {
        id: "pi-sdk",
        label: "Pi SDK",
        ok: typeof createAgentSessionRuntime === "function",
        value: "@earendil-works/pi-coding-agent",
        guidance: "The agent runtime is provided by the bundled Pi SDK package.",
      },
      {
        id: "pi-dir",
        label: "Pi data directory",
        ok: existsSync(piDir),
        value: piDir,
        guidance: "The directory is created after the first Pi run.",
      },
      {
        id: "codex-dir",
        label: "Codex config directory",
        ok: existsSync(codexDir),
        value: codexDir,
        guidance: "Optional but recommended for skills parity.",
      },
    ],
    diagnostics,
  });
}
