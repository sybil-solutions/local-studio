// CRITICAL
"use client";

/**
 * Context Management Hooks
 */

import { useContext, useCallback } from "react";
import { ContextManagementContext } from "./context";
import { getContextManagementService } from "./factory";
import type {
  IContextManagementService,
  ContextConfig,
  ContextMessage,
  CompactionStrategy,
  UtilizationLevel,
} from "./types";

/**
 * Hook to access the ContextManagementService
 */
export function useContextManagementService(): IContextManagementService {
  const context = useContext(ContextManagementContext);

  if (!context) {
    return getContextManagementService();
  }

  return context.service;
}

/**
 * Hook to access the context management configuration
 */
export function useContextManagementConfig(): ContextConfig {
  const context = useContext(ContextManagementContext);

  if (!context) {
    return {
      compactionThreshold: 0.8,
      targetAfterCompaction: 0.5,
      preserveRecentMessages: 4,
      autoCompact: true,
      checkInterval: 5000,
    };
  }

  return context.config;
}

/**
 * Main hook for context management operations
 */
export function useContextManagement() {
  const service = useContextManagementService();
  const config = useContextManagementConfig();

  const estimateTokens = useCallback((text: string) => service.estimateTokens(text), [service]);

  const calculateMessageTokens = useCallback(
    (messages: ContextMessage[]) => service.calculateMessageTokens(messages),
    [service],
  );

  const compactMessages = useCallback(
    (messages: ContextMessage[], maxContext: number, strategy?: CompactionStrategy) =>
      service.compactMessages(messages, maxContext, strategy),
    [service],
  );

  const getUtilizationLevel = useCallback(
    (utilization: number): UtilizationLevel => service.getUtilizationLevel(utilization),
    [service],
  );

  const formatTokenCount = useCallback(
    (tokens: number) => service.formatTokenCount(tokens),
    [service],
  );

  const calculateStats = useCallback(
    (messages: ContextMessage[], maxContext: number, systemPrompt?: string, tools?: unknown[]) =>
      service.calculateStats(messages, maxContext, systemPrompt, tools),
    [service],
  );

  return {
    service,
    config,
    estimateTokens,
    calculateMessageTokens,
    compactMessages,
    getUtilizationLevel,
    formatTokenCount,
    calculateStats,
  };
}
