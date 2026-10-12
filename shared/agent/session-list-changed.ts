import { Schema } from "effect";

export const SessionListChangedEventSchema = Schema.Struct({
  type: Schema.Literal("session_list_changed"),
  version: Schema.Number,
});

export type SessionListChangedEvent = Schema.Schema.Type<typeof SessionListChangedEventSchema>;
