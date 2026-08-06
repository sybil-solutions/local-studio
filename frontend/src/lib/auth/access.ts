import { resolveAccessPostureFromEnvironment, type AccessDecision } from "./access-posture.mjs";

export { resolveAccessPostureFromEnvironment } from "./access-posture.mjs";
export type { AccessDecision, AccessEnvironment } from "./access-posture.mjs";

export const STUDIO_TOKEN_HEADER = "x-local-studio-token";
export const STUDIO_TOKEN_COOKIE = "local_studio_token";
export const STUDIO_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function resolveAccessPosture(): AccessDecision {
  return resolveAccessPostureFromEnvironment(process.env);
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export function presentedToken(
  headerToken: string | null,
  cookieToken: string | null | undefined,
): string {
  return (headerToken ?? cookieToken ?? "").trim();
}
