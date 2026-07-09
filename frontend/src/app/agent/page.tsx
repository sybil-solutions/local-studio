import { Suspense } from "react";
import { AgentWorkspace } from "@/features/agent/ui/agent-workspace-shell";
import { ToolsProvider } from "@/features/agent/tools/context";

export default function AgentPage() {
  return (
    <ToolsProvider>
      <Suspense fallback={null}>
        <AgentWorkspace />
      </Suspense>
    </ToolsProvider>
  );
}
