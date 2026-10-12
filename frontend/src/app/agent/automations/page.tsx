import { Suspense } from "react";
import AutomationsPage from "@/features/agent/automations/automations-page";

export default function AgentAutomationsPage() {
  return (
    <Suspense fallback={null}>
      <AutomationsPage />
    </Suspense>
  );
}
