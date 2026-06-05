import { NextRequest } from "next/server";
import { listSessions } from "@/lib/agent/sessions-store";
import { piRuntimeManager } from "@/lib/agent/pi-runtime";
import {
  parseAgentTurnRequest,
  type AgentImageInput,
  type AgentTurnRequest,
} from "@/lib/agent/contracts/turn";
import { controlTargetHasActiveTurn } from "@/lib/agent/control-routing";
import type { PiAgentSession, PiAgentStatus } from "@/lib/agent/pi-runtime-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: unknown,
  streamOpen: () => boolean = () => true,
) {
  if (!streamOpen()) return;
  const encoder = new TextEncoder();
  try {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  } catch {
    // The browser may have navigated away. The Pi runtime must keep running;
    // callers can reattach through /api/agent/runtime/events.
  }
}

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
    // Dev HMR can keep an older runtime instance from the previous module
    // version alive. Preserve reattach correctness for those sessions too.
    runtime.currentPiSessionId = next;
  }
}

type ResolvedTurnSession = {
  effectivePiSessionId: string | null;
  effectiveStreamingBehavior: AgentTurnRequest["streamingBehavior"];
  ownsPromptStream: boolean;
  session: PiAgentSession;
  sessionId: string;
};

type TurnStreamState = {
  close: () => void;
  isOpen: () => boolean;
};

function createTurnStreamState(request: NextRequest): TurnStreamState {
  let open = true;
  request.signal.addEventListener("abort", () => {
    open = false;
  });
  return {
    close: () => {
      open = false;
    },
    isOpen: () => open,
  };
}

function resolveTurnSession(turn: AgentTurnRequest): ResolvedTurnSession {
  const resolved =
    turn.mode === "prompt"
      ? { sessionId: turn.sessionId, session: piRuntimeManager.getSession(turn.sessionId) }
      : piRuntimeManager.getSessionForLookup(turn.sessionId, turn.piSessionId);
  const status = resolved.session.status;
  const controlTargetActive = controlTargetHasActiveTurn(status);
  return {
    effectivePiSessionId: effectivePiSessionId(turn, status, controlTargetActive),
    effectiveStreamingBehavior: effectiveStreamingBehavior(turn, status),
    ownsPromptStream: turn.mode === "prompt" || !controlTargetActive,
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

async function ensurePromptRuntime(turn: AgentTurnRequest, resolved: ResolvedTurnSession) {
  if (!resolved.ownsPromptStream) return;
  await resolved.session.ensureStarted(turn.modelId, turn.cwd, resolved.effectivePiSessionId, {
    browserToolEnabled: turn.browserToolEnabled,
    browserSessionId: turn.browserSessionId,
    canvasEnabled: turn.canvasEnabled,
    plugins: turn.plugins,
    skills: turn.skills,
    promptTemplates: turn.promptTemplates,
  });
}

async function dispatchTurn(
  turn: AgentTurnRequest,
  resolved: ResolvedTurnSession,
  commandImages: AgentImageInput[] | undefined,
  emit: (payload: unknown) => void,
) {
  if (resolved.ownsPromptStream) {
    await resolved.session.prompt(
      turn.message,
      (event, seq) => {
        emit({ type: "pi", seq, event });
      },
      {
        streamingBehavior: resolved.effectiveStreamingBehavior,
        ...(commandImages ? { images: commandImages } : {}),
      },
    );
    return;
  }

  if (turn.mode === "steer") {
    await resolved.session.steer(turn.message, commandImages);
    // Steer is a fire-and-forget control message — events keep flowing on
    // the original prompt's stream. Close ours immediately.
    emit({ type: "status", phase: "queued", queue: "steer" });
    return;
  }

  if (turn.mode === "follow_up") {
    await resolved.session.followUp(turn.message, commandImages);
    emit({ type: "status", phase: "queued", queue: "follow_up" });
  }
}

async function resolvePiSessionId(session: PiAgentSession, since: Date) {
  const status = session.status;
  if (status.piSessionId || !status.cwd) return status.piSessionId;
  const recent = await listSessions(status.cwd, { since });
  return recent[0]?.id ?? null;
}

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parseAgentTurnRequest(rawBody);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const turn = parsed.value;
  const commandImages = turn.images.length ? turn.images : undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const streamState = createTurnStreamState(request);
      const emit = (payload: unknown) => sse(controller, payload, streamState.isOpen);
      try {
        const turnStartedAt = new Date(Date.now() - 2_000);
        const resolved = resolveTurnSession(turn);
        emit({
          type: "status",
          phase: "starting",
          sessionId: resolved.sessionId,
          modelId: turn.modelId,
          cwd: turn.cwd,
        });
        await ensurePromptRuntime(turn, resolved);
        emit({ type: "status", phase: "running", session: resolved.session.status });
        await dispatchTurn(turn, resolved, commandImages, emit);
        const resolvedPiSessionId = await resolvePiSessionId(resolved.session, turnStartedAt);
        adoptRuntimePiSessionId(resolved.session, resolvedPiSessionId);
        emit({ type: "status", phase: "done", piSessionId: resolvedPiSessionId });
      } catch (error) {
        emit({
          type: "error",
          error: error instanceof Error ? error.message : "Pi agent turn failed",
        });
      } finally {
        streamState.close();
        try {
          controller.close();
        } catch {
          // already closed by client navigation
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
