"use client";

import { createContext, useMemo, type ReactNode } from "react";
import { contextManagementServiceFactory } from "./factory";
import {
  DEFAULT_CONTEXT_CONFIG,
  type ContextConfig,
  type ContextManagementContextValue,
  type IContextManagementService,
} from "./types";

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
