import { Schema } from "effect";

export const LogProxyReadySchema = Schema.Struct({
  type: Schema.Literal("ready"),
  pid: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
});

export type LogProxyReady = typeof LogProxyReadySchema.Type;
