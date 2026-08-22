import { Schema } from "effect";

export const GoogleConnectionViewSchema = Schema.Struct({
  connected: Schema.Boolean,
  scopes: Schema.Array(Schema.String),
  /** The remote this account's read-only tools are served from. */
  endpoint: Schema.String,
  connectedAt: Schema.NullOr(Schema.String),
});

export const GoogleAccountEntryViewSchema = Schema.Struct({
  /** Stable digest of the verified mailbox; names this account in connector ids. */
  key: Schema.String,
  email: Schema.String,
  connections: Schema.Struct({
    gmail: GoogleConnectionViewSchema,
    "google-calendar": GoogleConnectionViewSchema,
  }),
});

export const GoogleAccountViewSchema = Schema.Struct({
  configured: Schema.Boolean,
  clientId: Schema.NullOr(Schema.String),
  hasClientSecret: Schema.Boolean,
  accounts: Schema.Array(GoogleAccountEntryViewSchema),
});

export const GoogleAccountResponseSchema = Schema.Struct({ account: GoogleAccountViewSchema });
export const GoogleAuthorizationResponseSchema = Schema.Struct({ authorizationUrl: Schema.String });

export type GoogleConnectionView = typeof GoogleConnectionViewSchema.Type;
export type GoogleAccountEntryView = typeof GoogleAccountEntryViewSchema.Type;
export type GoogleAccountView = typeof GoogleAccountViewSchema.Type;
