"use client";

import { lazy, Suspense } from "react";
import { Drawer, DrawerBody, DrawerHeader, DrawerOverlay } from "@/ui/drawer";
import type { GitSummary } from "@/features/agent/projects/types";

const LazyGitDiffPanel = lazy(() =>
  import("@/features/agent/ui/git-diff-panel").then(({ GitDiffPanel }) => ({
    default: GitDiffPanel,
  })),
);

// Right-anchored overlay drawer showing the working-tree diff. The single
// entry point is the composer status bar's diff stat — the pill that used to
// duplicate it above the composer is gone.
export function GitDiffDrawer({
  cwd,
  gitBranch,
  gitSummary,
  onClose,
}: {
  cwd: string | null;
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
  onClose: () => void;
}) {
  return (
    <DrawerOverlay onClose={onClose}>
      <Drawer width={720} className="h-full">
        <DrawerHeader
          title={gitBranch ? `Changes · ${gitBranch}` : "Changes"}
          badge={
            gitSummary?.isRepo ? (
              <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[length:var(--fs-xs)] tabular-nums">
                <span className="text-(--ok)">+{gitSummary.additions}</span>
                <span className="text-(--err)">-{gitSummary.deletions}</span>
              </span>
            ) : null
          }
          onClose={onClose}
        />
        <DrawerBody className="p-0">
          <Suspense
            fallback={
              <div className="p-4 text-[length:var(--fs-sm)] text-(--dim)">Loading diff…</div>
            }
          >
            <LazyGitDiffPanel cwd={cwd} />
          </Suspense>
        </DrawerBody>
      </Drawer>
    </DrawerOverlay>
  );
}
