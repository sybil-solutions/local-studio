"use client";

import type { GoogleAccountView } from "@local-studio/agent-runtime/google-account-contract";
import { Alert, Button, FormField, Input } from "@/ui";
import { ExternalLink } from "@/ui/icon-registry";
import { openExternal } from "./google-account-model";

/**
 * Release builds and configured servers carry Local Studio's own Google client,
 * so most people go straight to consent. The form below is for everyone else —
 * self-built apps, or anyone who wants their own Cloud project's quota and
 * consent screen (docs/google-workspace.md walks through creating one).
 */
export function GoogleAccountSetup({
  account,
  editing,
  clientId,
  clientSecret,
  replacementWarning,
  onClientId,
  onClientSecret,
  onEdit,
}: {
  account: GoogleAccountView;
  editing: boolean;
  clientId: string;
  clientSecret: string;
  replacementWarning: string | null;
  onClientId: (value: string) => void;
  onClientSecret: (value: string) => void;
  onEdit: () => void;
}) {
  if (account.configured && !editing) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-(--ui-border) px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-(--ui-fg)">
            {account.builtInClient ? "Local Studio Google client" : "OAuth client ready"}
          </div>
          <div className="mt-1 truncate text-xs text-(--ui-muted)">{account.clientId}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Alert variant="warning">
        This build has no Google client. Create a <strong>Desktop app</strong> OAuth client in your
        own Google Cloud project, enable the Gmail and Calendar APIs, and add yourself as a test
        user. No redirect URI has to be registered — desktop clients accept a loopback port. While
        the consent screen is in testing, Google expires refresh tokens after about a week, so
        expect to sign in again; publishing is not a shortcut, because Gmail read access is a
        restricted scope subject to review. Confirm current policy in the console.
      </Alert>
      <FormField
        label="OAuth client ID"
        required
        description="From Google Cloud → Credentials → OAuth client ID → Application type: Desktop app."
      >
        <Input
          value={clientId}
          onChange={(event) => onClientId(event.target.value)}
          placeholder="…apps.googleusercontent.com"
          autoComplete="off"
          spellCheck={false}
        />
      </FormField>
      <FormField
        label="OAuth client secret"
        required
        description="Shown next to the client ID in Google Cloud. Google rejects sign-in without it, even for desktop clients."
      >
        <Input
          type="password"
          value={clientSecret}
          onChange={(event) => onClientSecret(event.target.value)}
          placeholder={account.hasClientSecret ? "Stored securely" : "Client secret"}
          autoComplete="off"
          spellCheck={false}
        />
      </FormField>
      {replacementWarning ? <Alert variant="warning">{replacementWarning}</Alert> : null}
      <div className="flex flex-wrap gap-1">
        <Button
          variant="ghost"
          icon={<ExternalLink className="h-4 w-4" />}
          onClick={() => void openExternal("https://console.cloud.google.com/auth/clients")}
        >
          Google Cloud
        </Button>
        <Button
          variant="ghost"
          icon={<ExternalLink className="h-4 w-4" />}
          onClick={() =>
            void openExternal("https://developers.google.com/gmail/api/quickstart/nodejs")
          }
        >
          Setup guide
        </Button>
      </div>
    </div>
  );
}
