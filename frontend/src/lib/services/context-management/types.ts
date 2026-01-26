// CRITICAL
/**
 * Context Management Service Types
 * Defines all types for context/token management
 */

import type { IService } from "../types";

// ============================================================================
// Configuration Types
// ============================================================================

export interface ContextConfig {
  /** Percentage of max context to trigger compaction (0-1) */
  compactionThreshold: number;
  /** Target percentage after compaction (0-1) */
  targetAfterCompaction: number;
  /** Number of recent messages to always preserve */
  preserveRecentMessages: number;
  /** Enable automatic compaction */
  autoCompact: boolean;
  /** Interval in ms to check token count */
  checkInterval: number;
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  compactionThreshold: 0.8,
  targetAfterCompaction: 0.5,
  preserveRecentMessages: 4,
  autoCompact: true,
  checkInterval: 5000,
};

// ============================================================================
// Compaction Types
// ============================================================================

export type CompactionStrategy = "sliding_window" | "summarize" | "truncate";

export interface CompactionEvent {
  id: string;
  timestamp: Date;
  beforeTokens: number;
  afterTokens: number;
  messagesRemoved: number;
  messagesKept: number;
  maxContext: number;
  utilizationBefore: number;
  utilizationAfter: number;
  strategy: CompactionStrategy;
  summary?: string;
}

export interface CompactionResult {
  messages: ContextMessage[];
  removed: number;
}

// ============================================================================
// Stats Types
// ============================================================================

export interface ContextStats {
  currentTokens: number;
  maxContext: number;
  utilization: number;
  messagesCount: number;
  systemPromptTokens: number;
  toolsTokens: number;
  conversationTokens: number;
  headroom: number;
  estimatedMessagesUntilLimit: number;
  compactionHistory: CompactionEvent[];
  lastCompaction?: Date;
  totalCompactions: number;
  totalTokensCompacted: number;
}

export type UtilizationLevel = "low" | "medium" | "high" | "critical";

// ============================================================================
// Message Types
// ============================================================================

export interface ContextMessage {
  role: "user" | "assistant" | "system";
  content: string;
  [key: string]: unknown;
}

// ============================================================================
// Service Interface
// ============================================================================

export interface IContextManagementService extends IService {
  readonly name: "context-management";
  readonly config: ContextConfig;

  /** Estimate tokens for text */
  estimateTokens(text: string): number;

  /** Calculate total tokens for messages */
  calculateMessageTokens(messages: ContextMessage[]): number;

  /** Compact messages using specified strategy */
  compactMessages(
    messages: ContextMessage[],
    maxContext: number,
    strategy?: CompactionStrategy,
  ): { messages: ContextMessage[]; event: CompactionEvent };

  /** Get utilization level for color coding */
  getUtilizationLevel(utilization: number): UtilizationLevel;

  /** Format token count for display */
  formatTokenCount(tokens: number): string;

  /** Calculate context stats */
  calculateStats(
    messages: ContextMessage[],
    maxContext: number,
    systemPrompt?: string,
    tools?: unknown[],
  ): Omit<
    ContextStats,
    "compactionHistory" | "lastCompaction" | "totalCompactions" | "totalTokensCompacted"
  >;
}

// ============================================================================
// React Context Types
// ============================================================================

export interface ContextManagementContextValue {
  service: IContextManagementService;
  config: ContextConfig;
}
