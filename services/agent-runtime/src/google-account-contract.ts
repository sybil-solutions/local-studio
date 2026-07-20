import { Schema } from "effect";

export const GoogleConnectionViewSchema = Schema.Struct({
  connected: Schema.Boolean,
  email: Schema.NullOr(Schema.String),
  scopes: Schema.Array(Schema.String),
  resource: Schema.String,
  connectedAt: Schema.NullOr(Schema.String),
});

export const GoogleAccountViewSchema = Schema.Struct({
  configured: Schema.Boolean,
  clientId: Schema.NullOr(Schema.String),
  hasClientSecret: Schema.Boolean,
  connections: Schema.Struct({
    gmail: GoogleConnectionViewSchema,
    "google-calendar": GoogleConnectionViewSchema,
  }),
});

export const GoogleAccountResponseSchema = Schema.Struct({ account: GoogleAccountViewSchema });
export const GoogleAuthorizationResponseSchema = Schema.Struct({ authorizationUrl: Schema.String });
export const GoogleCancellationResponseSchema = Schema.Struct({
  cancelled: Schema.Literal(true),
});
export const GoogleClientInputSchema = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optional(Schema.String),
});
export const GoogleAccountInputSchema = Schema.Struct({
  account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
});

export type GoogleConnectionView = typeof GoogleConnectionViewSchema.Type;
export type GoogleAccountView = typeof GoogleAccountViewSchema.Type;
export type GoogleAccountResponse = typeof GoogleAccountResponseSchema.Type;
export type GoogleAuthorizationResponse = typeof GoogleAuthorizationResponseSchema.Type;
export type GoogleCancellationResponse = typeof GoogleCancellationResponseSchema.Type;
export type GoogleClientInput = typeof GoogleClientInputSchema.Type;
export type GoogleAccountInput = typeof GoogleAccountInputSchema.Type;
