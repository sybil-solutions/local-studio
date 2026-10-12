import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  STUDIO_TOKEN_COOKIE,
  STUDIO_TOKEN_HEADER,
  presentedToken,
  resolveAccessPosture,
} from "./access";

function safeEqual(a: string, b: string): boolean {
  const actual = Buffer.from(a);
  const expected = Buffer.from(b);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
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
