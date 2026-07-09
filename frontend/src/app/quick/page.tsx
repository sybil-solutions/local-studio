"use client";

import { Suspense } from "react";
import { AgentWorkspace } from "@/features/agent/ui/agent-workspace-shell";
import { ToolsProvider } from "@/features/agent/tools/context";
import { getQuickPanelBridge } from "@/features/agent/ui/quick-panel/quick-panel-bridge";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

function useDismissOnEscape(): void {
  useMountSubscription(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const bridge = getQuickPanelBridge();
      if (!bridge) return;
      event.preventDefault();
      void bridge.dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export default function QuickPanelPage() {
  useDismissOnEscape();
  return (
    <ToolsProvider>
      <Suspense fallback={null}>
        <AgentWorkspace compact />
      </Suspense>
    </ToolsProvider>
  );
}
