// HTTP surface for server-side PTY sessions. Output travels as SSE so the
// Next.js proxy streams it through unbuffered (pass-through bodies flush in
// the standalone server; only locally-generated streams don't). Frames:
//   event: snapshot  → base64 of the full replay buffer (first event frame)
//   data:            → base64 of a live output chunk
//   event: exit      → {"exitCode":n,"signal":s}
// plus `: ping` comments to keep intermediaries from idling the stream out.

import {
  MAX_PTY_INPUT_CHARS,
  isPtyAvailable,
  ptyUnavailableReason,
  closePtySession,
  openPtySession,
  resizePtySession,
  subscribePtySession,
  writePtySession,
} from "../pty-service";
import { errorMessage, jsonError, readJsonBody } from "./helpers";
import { sseResponse } from "./sse";

const PING_INTERVAL_MS = 15_000;
const MAX_BODY_CHARS = MAX_PTY_INPUT_CHARS + 4_096;

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function encodeBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

export async function handlePtyOpen(request: Request): Promise<Response> {
  if (!isPtyAvailable()) {
    return jsonError(`PTY unavailable: ${ptyUnavailableReason() ?? "unknown"}`, 503);
  }
  const body = await readJsonBody(request, { maxChars: MAX_BODY_CHARS });
  if (!body) return jsonError("Invalid JSON body");
  try {
    const result = openPtySession({
      cwd: asString(body.cwd),
      ownerKey: asString(body.ownerKey),
      cols: Number(body.cols),
      rows: Number(body.rows),
    });
    return Response.json(result);
  } catch (error) {
    return jsonError(errorMessage(error, "PTY open failed"), 500);
  }
}

export function handlePtyStream(request: Request): Response {
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return jsonError("id is required");

  return sseResponse({
    signal: request.signal,
    heartbeat: { intervalMs: PING_INTERVAL_MS, comment: "ping" },
    start(send, close) {
      const subscription = subscribePtySession(id, {
        onData: (chunk) => send(`data: ${encodeBase64(chunk)}\n\n`),
        onExit: (info) => {
          send(`event: exit\ndata: ${JSON.stringify(info)}\n\n`);
          close();
        },
      });
      if (!subscription) {
        send(`event: gone\ndata: {}\n\n`);
        close();
        return;
      }
      send(`event: snapshot\ndata: ${encodeBase64(subscription.replay)}\n\n`);
      return subscription.unsubscribe;
    },
  });
}

export async function handlePtyInput(request: Request): Promise<Response> {
  const body = await readJsonBody(request, { maxChars: MAX_BODY_CHARS });
  const id = asString(body?.id)?.trim();
  const data = asString(body?.data);
  if (!body || !id || typeof data !== "string") return jsonError("id and data are required");
  if (data.length > MAX_PTY_INPUT_CHARS) return jsonError("input too large", 413);
  return Response.json({ ok: writePtySession(id, data) });
}

export async function handlePtyResize(request: Request): Promise<Response> {
  const body = await readJsonBody(request, { maxChars: MAX_BODY_CHARS });
  const id = asString(body?.id)?.trim();
  if (!body || !id) return jsonError("id is required");
  return Response.json({ ok: resizePtySession(id, Number(body.cols), Number(body.rows)) });
}

export async function handlePtyClose(request: Request): Promise<Response> {
  const body = await readJsonBody(request, { maxChars: MAX_BODY_CHARS });
  const id = asString(body?.id)?.trim();
  if (!body || !id) return jsonError("id is required");
  closePtySession(id);
  return Response.json({ ok: true });
}
