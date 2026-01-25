"use client";

import { Activity } from "lucide-react";

interface PageStateOptions {
  loading: boolean;
  data: unknown | null;
  hasData: boolean;
  error?: string | null;
  onLoad: () => void;
}

function PageState({ loading, data, hasData, error, onLoad }: PageStateOptions) {
  const isInitialLoading = loading && !hasData;

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-50 bg-background">
        <Activity className="h-6 w-6 text-(--muted-foreground) animate-pulse" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center h-full min-h-50 bg-background">
        <div className="text-center mb-0">
          <p className="text-(--error) mb-4">{error}</p>
          <button
            onClick={onLoad}
            className="px-4 py-2 bg-(--card) border border-(--border) rounded-lg text-foreground hover:bg-(--card-hover) transition-colors"
            title="Retry"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export { PageState };
