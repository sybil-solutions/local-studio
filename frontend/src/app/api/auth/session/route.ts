import { Effect, Option, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import {
  STUDIO_TOKEN_COOKIE,
  STUDIO_TOKEN_MAX_AGE_SECONDS,
  resolveAccessPosture,
} from "@/lib/auth/access";
import { matchesAccessToken } from "@/lib/auth/guard";

const BODY_LIMIT_BYTES = 4 * 1_024;
const AccessInputSchema = Schema.Struct({ token: Schema.String });
const decodeAccessInput = Schema.decodeUnknownOption(AccessInputSchema);

type FormResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly status: 400 | 413 | 415; readonly error: string };

function failure(status: 400 | 413 | 415, error: string): FormResult {
  return { ok: false, status, error };
}

function supportsForm(value: string | null): boolean {
  if (!value) return false;
  const [mediaType, ...parameters] = value.split(";");
  if (mediaType?.trim().toLowerCase() !== "application/x-www-form-urlencoded") return false;
  return parameters.every((parameter) => /^\s*charset\s*=\s*"?utf-8"?\s*$/iu.test(parameter));
}

async function readBoundedBody(request: Request): Promise<FormResult | Uint8Array> {
  const declared = request.headers.get("content-length")?.trim();
  if (declared && /^\d+$/u.test(declared) && Number(declared) > BODY_LIMIT_BYTES) {
    return failure(413, "Access form body exceeds the allowed size.");
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > BODY_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        return failure(413, "Access form body exceeds the allowed size.");
      }
      chunks.push(chunk.value);
    }
  } catch {
    return failure(400, "Invalid access form body.");
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseForm(body: Uint8Array): FormResult {
  try {
    const parameters = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(body));
    const tokens = parameters.getAll("token");
    const input = decodeAccessInput({ token: tokens.length === 1 ? tokens[0] : null });
    return Option.isSome(input)
      ? { ok: true, token: input.value.token }
      : failure(400, "Invalid access form body.");
  } catch {
    return failure(400, "Invalid access form body.");
  }
}

function readAccessForm(request: Request) {
  if (!supportsForm(request.headers.get("content-type"))) {
    return Effect.succeed<FormResult>(
      failure(415, "Access form requires application/x-www-form-urlencoded."),
    );
  }
  return Effect.promise(() => readBoundedBody(request)).pipe(
    Effect.map((body): FormResult => (body instanceof Uint8Array ? parseForm(body) : body)),
  );
}

function redirect(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location } });
}

function secureRequest(request: NextRequest): boolean {
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() ||
    request.nextUrl.protocol.replace(/:$/, "");
  return protocol === "https";
}

export function POST(request: NextRequest): Promise<Response> {
  const program = Effect.gen(function* () {
    const posture = resolveAccessPosture();
    if (posture.kind === "configuration-error") {
      return NextResponse.json({ error: posture.message }, { status: 503 });
    }
    if (posture.kind === "allow") return redirect("/");
    const form = yield* readAccessForm(request);
    if (!form.ok) return NextResponse.json({ error: form.error }, { status: form.status });
    if (!matchesAccessToken(form.token.trim(), posture.token)) {
      return redirect("/access?error=invalid");
    }
    const response = redirect("/");
    response.cookies.set(STUDIO_TOKEN_COOKIE, posture.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureRequest(request),
      path: "/",
      maxAge: STUDIO_TOKEN_MAX_AGE_SECONDS,
    });
    return response;
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(NextResponse.json({ error: "Invalid access form body." }, { status: 400 })),
    ),
  );
  return Effect.runPromise(program);
}
