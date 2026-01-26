// CRITICAL
"use client";

/**
 * Context Management Context
 * Provides dependency injection for ContextManagementService
 */

import { createContext, useMemo, type ReactNode } from "react";
import { contextManagementServiceFactory } from "./factory";
import type {
  IContextManagementService,
  ContextConfig,
  ContextManagementContextValue,
} from "./types";

const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  compactionThreshold: 0.8,
  targetAfterCompaction: 0.5,
  preserveRecentMessages: 4,
  autoCompact: true,
  checkInterval: 5000,
};

export const ContextManagementContext = createContext<ContextManagementContextValue | null>(null);

ContextManagementContext.displayName = "ContextManagementContext";

interface ContextManagementProviderProps {
  children: ReactNode;
  config?: Partial<ContextConfig>;
  service?: IContextManagementService;
}

export function ContextManagementProvider({
  children,
  config,
  service: providedService,
}: ContextManagementProviderProps) {
  const contextValue = useMemo<ContextManagementContextValue>(() => {
    const service =
      providedService ??
      (config
        ? contextManagementServiceFactory.create(config)
        : contextManagementServiceFactory.createDefault());

    const finalConfig: ContextConfig = {
      ...DEFAULT_CONTEXT_CONFIG,
      ...config,
    };

    return {
      service,
      config: finalConfig,
    };
  }, [config, providedService]);

  return (
    <ContextManagementContext.Provider value={contextValue}>
      {children}
    </ContextManagementContext.Provider>
  );
}
