"use client";

import { Alert, Button, Spinner } from "@/ui";

export function GoogleAccountLoadState({ error, onRetry }: { error: string; onRetry: () => void }) {
  if (error) {
    return (
      <Alert variant="error">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </Alert>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-24 items-center justify-center gap-2 text-sm text-(--ui-muted)"
    >
      <Spinner size="sm" />
      Loading Google account
    </div>
  );
}
