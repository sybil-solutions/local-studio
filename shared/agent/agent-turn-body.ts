import { AGENT_IMAGE_LIMITS } from "./agent-image-input";

export const AGENT_TURN_BODY_LIMIT_BYTES =
  Math.ceil((AGENT_IMAGE_LIMITS.totalBytes * 4) / 3) + 1_000_000;

export type RequestBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: 400 | 413 };

const bodyLimitError = (limit: number): RequestBodyResult<never> => ({
  ok: false,
  error: `Request body exceeds the ${Math.floor(limit / 1_000_000)} MB agent turn limit.`,
  status: 413,
});

export async function readRequestBytesWithinLimit(
  request: Request,
  limit: number,
): Promise<RequestBodyResult<Uint8Array>> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) return bodyLimitError(limit);
  if (!request.body) return { ok: true, value: new Uint8Array() };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return bodyLimitError(limit);
      }
      chunks.push(chunk.value);
    }
  } catch {
    return { ok: false, error: "Invalid request body", status: 400 };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: bytes };
}

export async function readJsonRequestWithinLimit(
  request: Request,
  limit: number,
): Promise<RequestBodyResult<unknown>> {
  const body = await readRequestBytesWithinLimit(request, limit);
  if (!body.ok) return body;
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body.value)) };
  } catch {
    return { ok: false, error: "Invalid JSON body", status: 400 };
  }
}
