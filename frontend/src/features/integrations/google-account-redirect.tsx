"use client";

import { Alert, Button, FormField, Input } from "@/ui";

/**
 * Google always redirects the browser to 127.0.0.1. When the runtime lives on
 * another machine that request never reaches its listener, so the address the
 * browser landed on is pasted back here instead.
 */
export function GoogleRedirectPaste({
  value,
  busy,
  onChange,
  onFinish,
}: {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onFinish: () => void;
}) {
  return (
    <div className="space-y-3">
      <Alert variant="success">
        Finish consent in your browser. Local Studio is checking for the connection.
      </Alert>
      <FormField
        label="Browser says it can't connect?"
        description="When Local Studio runs on another machine, Google's final redirect lands on this computer instead. Paste the full address from the browser's address bar."
      >
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="http://127.0.0.1:…/callback?state=…&code=…"
            autoComplete="off"
            spellCheck={false}
          />
          <Button variant="secondary" onClick={onFinish} disabled={busy || !value.trim()}>
            Finish
          </Button>
        </div>
      </FormField>
    </div>
  );
}
