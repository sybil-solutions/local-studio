import { Schema } from "effect";

export const ApiErrorResponseSchema = Schema.Struct({ error: Schema.String });
