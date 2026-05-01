/**
 * Context Management Service Module
 *
 * Handles token estimation, context tracking, and automatic compaction
 * to prevent model context overflow.
 *
 * @example
 * ```tsx
 * // Wrap your app/page with the provider
 * <ContextManagementProvider>
 *   <ChatComponent />
 * </ContextManagementProvider>
 *
 * // Use the hook in components
 * function ChatComponent() {
 *   const { calculateStats, compactMessages, formatTokenCount } = useContextManagement();
 *
 *   const stats = calculateStats(messages, maxContext, systemPrompt, tools);
 *   // Check stats.utilization, display formatTokenCount(stats.currentTokens)
 * }
 * ```
 */

// Types
export type {
  ContextConfig,
  CompactionStrategy,
  CompactionEvent,
  CompactionResult,
  ContextStats,
  UtilizationLevel,
  ContextMessage,
  IContextManagementService,
  ContextManagementContextValue,
} from "./types";

export { DEFAULT_CONTEXT_CONFIG } from "./types";

// Service
export { ContextManagementService } from "./service";

// Factory
export { ContextManagementServiceFactory, contextManagementServiceFactory } from "./factory";

// Context
export { ContextManagementContext, ContextManagementProvider } from "./context";
