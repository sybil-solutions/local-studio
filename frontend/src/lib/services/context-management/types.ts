import type { IService } from "../types";

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

export interface ContextMessage {
  role: "user" | "assistant" | "system";
  content: string;
  [key: string]: unknown;
}

export interface IContextManagementService extends IService {
  readonly name: "context-management";
  readonly config: ContextConfig;

  estimateTokens(text: string): number;

  calculateMessageTokens(messages: ContextMessage[]): number;

  compactMessages(
    messages: ContextMessage[],
    maxContext: number,
    strategy?: CompactionStrategy,
  ): { messages: ContextMessage[]; event: CompactionEvent };

  getUtilizationLevel(utilization: number): UtilizationLevel;

  formatTokenCount(tokens: number): string;

  calculateStats(
    messages: ContextMessage[],
    maxContext: number,
    systemPrompt?: string,
    tools?: Record<string, unknown>[],
  ): Omit<
    ContextStats,
    "compactionHistory" | "lastCompaction" | "totalCompactions" | "totalTokensCompacted"
  >;
}

export interface ContextManagementContextValue {
  service: IContextManagementService;
  config: ContextConfig;
}
