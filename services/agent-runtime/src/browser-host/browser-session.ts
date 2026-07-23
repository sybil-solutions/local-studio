import { Schema } from "effect";
import {
  BROWSER_SESSION_KEY_PATTERN,
  type BrowserSessionKey,
} from "../../../../shared/agent/browser-session";

export const BrowserSessionKeySchema = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128),
    Schema.isPattern(BROWSER_SESSION_KEY_PATTERN),
  ),
);

export function decodeBrowserSessionKey(input: unknown): BrowserSessionKey {
  return Schema.decodeUnknownSync(BrowserSessionKeySchema)(input);
}

const SessionLimitSchema = Schema.NumberFromString.pipe(
  Schema.check(
    Schema.isFinite(),
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(32),
  ),
);
const SessionIdleSchema = Schema.NumberFromString.pipe(
  Schema.check(
    Schema.isFinite(),
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(60_000),
    Schema.isLessThanOrEqualTo(86_400_000),
  ),
);
const BrowserSessionConfigSchema = Schema.Struct({
  maxSessions: SessionLimitSchema,
  idleMs: SessionIdleSchema,
});

export type BrowserSessionConfig = typeof BrowserSessionConfigSchema.Type;

export function browserSessionConfig(env: NodeJS.ProcessEnv = process.env): BrowserSessionConfig {
  return Schema.decodeUnknownSync(BrowserSessionConfigSchema)({
    maxSessions: env.LOCAL_STUDIO_BROWSER_MAX_SESSIONS ?? "8",
    idleMs: env.LOCAL_STUDIO_BROWSER_SESSION_IDLE_MS ?? "900000",
  });
}
