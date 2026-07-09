"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { ProjectsProvider } from "@/features/agent/projects/context";
import { requestIdleWork } from "@/lib/idle-work";

type GlobalListenersComponent = ComponentType;

let globalListenersPromise: Promise<GlobalListenersComponent> | null = null;

function loadGlobalListeners(): Promise<GlobalListenersComponent> {
  globalListenersPromise ??= import("./global-listeners").then((mod) => mod.GlobalListeners);
  return globalListenersPromise;
}

function LazyGlobalListeners() {
  const [GlobalListeners, setGlobalListeners] = useState<GlobalListenersComponent | null>(null);

  useMountSubscription(() => {
    if (GlobalListeners) return;
    let cancelled = false;
    const cancelIdle = requestIdleWork(() => {
      void loadGlobalListeners().then((Component) => {
        if (!cancelled) setGlobalListeners(() => Component);
      });
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [GlobalListeners]);

  return GlobalListeners ? <GlobalListeners /> : null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ProjectsProvider>
      <LazyGlobalListeners />
      {children}
    </ProjectsProvider>
  );
}
