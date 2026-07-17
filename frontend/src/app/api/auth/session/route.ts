import { Effect, Option, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import {
  STUDIO_TOKEN_COOKIE,
  STUDIO_TOKEN_MAX_AGE_SECONDS,
  resolveAccessPosture,
} from "@/lib/auth/access";
import { matchesAccessToken } from "@/lib/auth/guard";
import { readAccessForm } from "./access-form";

const AccessInputSchema = Schema.Struct({ token: Schema.String });
const decodeAccessInput = Schema.decodeUnknownOption(AccessInputSchema);

function redirect(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location } });
}

function accessRedirect(): NextResponse {
  return redirect("/access?error=invalid");
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
    const input = decodeAccessInput({ token: form.token });
    if (Option.isNone(input) || !matchesAccessToken(input.value.token.trim(), posture.token)) {
      return accessRedirect();
    }
    const response = redirect("/");
    response.cookies.set(STUDIO_TOKEN_COOKIE, posture.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: STUDIO_TOKEN_MAX_AGE_SECONDS,
    });
    return response;
  }).pipe(Effect.catch(() => Effect.succeed(accessRedirect())));
  return Effect.runPromise(program);
}
