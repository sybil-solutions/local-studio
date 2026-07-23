import { Effect } from "effect";

const ACCESS_FORM_BODY_LIMIT_BYTES = 4 * 1_024;

type AccessFormFailure = {
  readonly error: string;
  readonly ok: false;
  readonly status: 400 | 413 | 415;
};

type AccessFormResult = AccessFormFailure | { readonly ok: true; readonly token: string | null };

const invalidBody = (): AccessFormFailure => ({
  error: "Invalid access form body.",
  ok: false,
  status: 400,
});

const oversizedBody = (): AccessFormFailure => ({
  error: "Access form body exceeds the allowed size.",
  ok: false,
  status: 413,
});

const unsupportedMedia = (): AccessFormFailure => ({
  error: "Access form requires application/x-www-form-urlencoded.",
  ok: false,
  status: 415,
});

function charsetValue(value: string): string | null {
  const normalized = value.trim();
  const quoted = normalized.startsWith('"') || normalized.endsWith('"');
  if (!quoted) return normalized;
  if (!(normalized.startsWith('"') && normalized.endsWith('"')) || normalized.length < 2) {
    return null;
  }
  return normalized.slice(1, -1);
}

function supportsUrlEncodedForm(value: string | null): boolean {
  if (!value) return false;
  const [mediaType, ...parameters] = value.split(";");
  if (mediaType?.trim().toLowerCase() !== "application/x-www-form-urlencoded") return false;
  return parameters.every((parameter) => {
    const separator = parameter.indexOf("=");
    if (separator < 1) return false;
    const name = parameter.slice(0, separator).trim().toLowerCase();
    const charset = charsetValue(parameter.slice(separator + 1));
    return name === "charset" && charset?.toLowerCase() === "utf-8";
  });
}

function declaredBodyExceedsLimit(value: string | null): boolean {
  if (!value || !/^\d+$/.test(value.trim())) return false;
  const length = Number(value);
  return !Number.isFinite(length) || length > ACCESS_FORM_BODY_LIMIT_BYTES;
}

async function readBodyWithinLimit(request: Request): Promise<AccessFormFailure | Uint8Array> {
  if (declaredBodyExceedsLimit(request.headers.get("content-length"))) return oversizedBody();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > ACCESS_FORM_BODY_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        return oversizedBody();
      }
      chunks.push(chunk.value);
    }
  } catch {
    return invalidBody();
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parsedAccessForm(body: Uint8Array): AccessFormResult {
  try {
    const parameters = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(body));
    return { ok: true, token: parameters.get("token") };
  } catch {
    return invalidBody();
  }
}

export function readAccessForm(request: Request) {
  if (!supportsUrlEncodedForm(request.headers.get("content-type"))) {
    return Effect.succeed<AccessFormResult>(unsupportedMedia());
  }
  return Effect.promise(() => readBodyWithinLimit(request)).pipe(
    Effect.map(
      (body): AccessFormResult => (body instanceof Uint8Array ? parsedAccessForm(body) : body),
    ),
  );
}
