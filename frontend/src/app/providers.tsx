"use client";

import type { ReactNode } from "react";
import { ContextManagementProvider } from "@/lib/services/context-management";
import { useControllerEvents } from "@/hooks/use-controller-events";

function ControllerEventsListener() {
  useControllerEvents();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ContextManagementProvider>
      <ControllerEventsListener />
      {children}
    </ContextManagementProvider>
  );
}
