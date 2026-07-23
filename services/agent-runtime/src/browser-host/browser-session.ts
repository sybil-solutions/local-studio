import { Schema } from "effect";

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
