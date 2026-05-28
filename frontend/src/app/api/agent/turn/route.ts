import { NextRequest } from "next/server";
import { listSessions } from "@/lib/agent/sessions-store";
import { piRuntimeManager } from "@/lib/agent/pi-runtime";
import { parseAgentTurnRequest } from "@/lib/agent/contracts/turn";
import { controlTargetHasActiveTurn } from "@/lib/agent/control-routing";

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

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parseAgentTurnRequest(rawBody);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const {
    sessionId,
    modelId,
    message,
    images,
    cwd,
    piSessionId,
    browserToolEnabled,
    browserSessionId,
    canvasEnabled,
    plugins,
    skills,
    promptTemplates,
    extensionOverrides,
    mode,
    streamingBehavior,
  } = parsed.value;
  const commandImages = images.length ? images : undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const isOpen = () => open;
      request.signal.addEventListener("abort", () => {
        open = false;
      });
      try {
        const turnStartedAt = new Date(Date.now() - 2_000);
        const resolved =
          mode === "prompt"
            ? { sessionId, session: piRuntimeManager.getSession(sessionId) }
            : piRuntimeManager.getSessionForLookup(sessionId, piSessionId);
        const session = resolved.session;
        const existingStatus = session.status;
        const promptAlreadyActive = existingStatus.active === true;
        const controlTargetActive = controlTargetHasActiveTurn(existingStatus);
        const effectivePiSessionId =
          mode === "prompt"
            ? piSessionId
            : controlTargetActive
              ? (existingStatus.piSessionId ?? piSessionId)
              : piSessionId;
        sse(
          controller,
          { type: "status", phase: "starting", sessionId: resolved.sessionId, modelId, cwd },
          isOpen,
        );
        // Control turns are keyed to an active Pi turn, not just to a live
        // runtime process. A completed session can keep its runtime around for
        // reuse; late steer/queue controls must become normal streamed prompts.
        const ownsPromptStream = mode === "prompt" || !controlTargetActive;
        const effectiveStreamingBehavior =
          mode === "prompt" && promptAlreadyActive
            ? (streamingBehavior ?? "steer")
            : streamingBehavior;
        if (ownsPromptStream) {
          await session.ensureStarted(modelId, cwd, effectivePiSessionId, {
            browserToolEnabled,
            browserSessionId,
            canvasEnabled,
            plugins,
            skills,
            promptTemplates,
            extensionOverrides,
          });
        }
        sse(controller, { type: "status", phase: "running", session: session.status }, isOpen);
        if (ownsPromptStream) {
          const promptOptions = {
            streamingBehavior: effectiveStreamingBehavior,
            ...(commandImages ? { images: commandImages } : {}),
          };
          await session.prompt(
            message,
            (event, seq) => {
              sse(controller, { type: "pi", seq, event }, isOpen);
            },
            promptOptions,
          );
        } else if (mode === "steer") {
          if (commandImages) {
            await session.steer(message, commandImages);
          } else {
            await session.steer(message);
          }
          // Steer is a fire-and-forget control message — events keep flowing on
          // the original prompt's stream. Close ours immediately.
          sse(controller, { type: "status", phase: "queued", queue: "steer" }, isOpen);
        } else if (mode === "follow_up") {
          if (commandImages) {
            await session.followUp(message, commandImages);
          } else {
            await session.followUp(message);
          }
          sse(controller, { type: "status", phase: "queued", queue: "follow_up" }, isOpen);
        }
        const status = session.status;
        let resolvedPiSessionId = status.piSessionId;
        if (!resolvedPiSessionId && status.cwd) {
          const recent = await listSessions(status.cwd, { since: turnStartedAt });
          resolvedPiSessionId = recent[0]?.id ?? null;
        }
        adoptRuntimePiSessionId(session, resolvedPiSessionId);
        sse(
          controller,
          { type: "status", phase: "done", piSessionId: resolvedPiSessionId },
          isOpen,
        );
      } catch (error) {
        sse(
          controller,
          {
            type: "error",
            error: error instanceof Error ? error.message : "Pi agent turn failed",
          },
          isOpen,
        );
      } finally {
        open = false;
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
