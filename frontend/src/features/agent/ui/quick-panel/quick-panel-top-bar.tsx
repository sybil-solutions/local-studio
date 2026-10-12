"use client";

import type { ProjectsContextValue } from "@/features/agent/projects/context";
import { ExternalLink, X } from "@/ui/icon-registry";
import { getQuickPanelBridge } from "@/features/agent/ui/quick-panel/quick-panel-bridge";
import { QuickProjectPicker } from "@/features/agent/ui/quick-panel/quick-project-picker";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export function useQuickPanelExpandEffect(compact: boolean, expanded: boolean): void {
  useMountSubscription(() => {
    if (compact && expanded) {
      void getQuickPanelBridge()?.expand();
    }
  }, [compact, expanded]);
}

export function QuickPanelTopBar({
  projects,
  projectId,
  sessionId,
  hasThread,
}: {
  projects: ProjectsContextValue;
  projectId: string | null;
  sessionId: string | null;
  hasThread: boolean;
}) {
  if (!hasThread) return null;
  return (
    <div
      className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-(--border) px-2 [-webkit-app-region:drag]"
      onDoubleClick={(event) => event.preventDefault()}
    >
      <div className="[-webkit-app-region:no-drag]">
        <QuickProjectPicker projects={projects} />
      </div>
      <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
        {projectId ? (
          <button
            type="button"
            onClick={() =>
              void getQuickPanelBridge()?.focusMainAndNavigate(projectId, sessionId ?? undefined)
            }
            title="Open in Local Studio"
            aria-label="Open in Local Studio"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void getQuickPanelBridge()?.dismiss()}
          title="Close panel"
          aria-label="Close panel"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
