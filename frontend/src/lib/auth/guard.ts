import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  STUDIO_TOKEN_COOKIE,
  STUDIO_TOKEN_HEADER,
  presentedToken,
  resolveAccessPosture,
} from "./access";
import { matchesFrontendCallbackCredential } from "./callback-credential";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function matchesAccessToken(presented: string, expected: string): boolean {
  return Boolean(presented) && safeEqual(presented, expected);
}

export function requireApiAccess(request: NextRequest): Response | null {
  const posture = resolveAccessPosture();
  if (posture.kind === "configuration-error") {
    return Response.json({ error: posture.message }, { status: 503 });
  }
  if (posture.kind === "allow") return null;
  const presented = presentedToken(
    request.headers.get(STUDIO_TOKEN_HEADER),
    request.cookies.get(STUDIO_TOKEN_COOKIE)?.value,
  );
  if (matchesAccessToken(presented, posture.token)) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function requireCallbackOrApiAccess(request: NextRequest): Response | null {
  const denied = requireApiAccess(request);
  if (!denied || denied.status === 503) return denied;
  return matchesFrontendCallbackCredential(request) ? null : denied;
}
