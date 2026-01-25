// CRITICAL
/**
 * Context Management Service
 * Handles token estimation, compaction, and context management
 */

import type {
  IContextManagementService,
  ContextConfig,
  ContextMessage,
  CompactionEvent,
  CompactionResult,
  CompactionStrategy,
  UtilizationLevel,
  ContextStats,
} from "./types";

export class ContextManagementService implements IContextManagementService {
  readonly name = "context-management" as const;
  readonly config: ContextConfig;

  constructor(config: ContextConfig) {
    this.config = config;
  }

  /**
   * Estimate tokens for text (rough approximation: ~4 chars per token)
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate total tokens for messages
   */
  calculateMessageTokens(messages: ContextMessage[]): number {
    return messages.reduce((total, msg) => {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      return total + this.estimateTokens(content) + 4; // +4 for role/formatting overhead
    }, 0);
  }

  /**
   * Compact messages using specified strategy
   */
  compactMessages(
    messages: ContextMessage[],
    maxContext: number,
    strategy: CompactionStrategy = "sliding_window",
  ): { messages: ContextMessage[]; event: CompactionEvent } {
    const beforeTokens = this.calculateMessageTokens(messages);
    const targetTokens = Math.floor(maxContext * this.config.targetAfterCompaction);

    let result: CompactionResult;
    let summary: string | undefined;

    switch (strategy) {
      case "summarize": {
        const recentMessages = messages.slice(-this.config.preserveRecentMessages);
        const olderMessages = messages.slice(0, -this.config.preserveRecentMessages);

        if (olderMessages.length > 0) {
          const summaryMessage = this.createSummaryMessage(olderMessages);
          result = {
            messages: [summaryMessage, ...recentMessages],
            removed: olderMessages.length,
          };
          summary = summaryMessage.content;
        } else {
          result = { messages, removed: 0 };
        }
        break;
      }
      case "truncate":
        result = this.compactTruncate(messages, targetTokens);
        break;
      case "sliding_window":
      default:
        result = this.compactSlidingWindow(messages, targetTokens);
    }

    const afterTokens = this.calculateMessageTokens(result.messages);

    const event: CompactionEvent = {
      id: `compact-${Date.now()}`,
      timestamp: new Date(),
      beforeTokens,
      afterTokens,
      messagesRemoved: result.removed,
      messagesKept: result.messages.length,
      maxContext,
      utilizationBefore: beforeTokens / maxContext,
      utilizationAfter: afterTokens / maxContext,
      strategy,
      summary,
    };

    return { messages: result.messages, event };
  }

  /**
   * Get utilization level for color coding
   */
  getUtilizationLevel(utilization: number): UtilizationLevel {
    if (utilization < 0.5) return "low";
    if (utilization < 0.75) return "medium";
    if (utilization < 0.9) return "high";
    return "critical";
  }

  /**
   * Format token count for display
   */
  formatTokenCount(tokens: number): string {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
  }

  /**
   * Calculate context stats
   */
  calculateStats(
    messages: ContextMessage[],
    maxContext: number,
    systemPrompt?: string,
    tools?: unknown[],
  ): Omit<
    ContextStats,
    "compactionHistory" | "lastCompaction" | "totalCompactions" | "totalTokensCompacted"
  > {
    const systemPromptTokens = systemPrompt ? this.estimateTokens(systemPrompt) : 0;
    const toolsTokens = tools?.length ? this.estimateTokens(JSON.stringify(tools)) : 0;
    const conversationTokens = this.calculateMessageTokens(messages);
    const currentTokens = systemPromptTokens + toolsTokens + conversationTokens;
    const utilization = maxContext > 0 ? currentTokens / maxContext : 0;
    const headroom = Math.max(0, maxContext - currentTokens);

    // Estimate messages until limit based on average message size
    const avgMessageTokens = messages.length > 0 ? conversationTokens / messages.length : 100; // Default estimate
    const estimatedMessagesUntilLimit =
      avgMessageTokens > 0 ? Math.floor(headroom / avgMessageTokens) : 0;

    return {
      currentTokens,
      maxContext,
      utilization,
      messagesCount: messages.length,
      systemPromptTokens,
      toolsTokens,
      conversationTokens,
      headroom,
      estimatedMessagesUntilLimit,
    };
  }

  /**
   * Compact using sliding window strategy
   */
  private compactSlidingWindow(messages: ContextMessage[], targetTokens: number): CompactionResult {
    const preserveRecent = this.config.preserveRecentMessages;

    if (messages.length <= preserveRecent) {
      return { messages, removed: 0 };
    }

    const recentMessages = messages.slice(-preserveRecent);
    const olderMessages = messages.slice(0, -preserveRecent);

    let currentTokens = this.calculateMessageTokens(recentMessages);
    const keptOlder: ContextMessage[] = [];

    // Keep older messages from most recent, until we hit target
    for (let i = olderMessages.length - 1; i >= 0; i--) {
      const msgTokens = this.calculateMessageTokens([olderMessages[i]]);
      if (currentTokens + msgTokens > targetTokens) {
        break;
      }
      keptOlder.unshift(olderMessages[i]);
      currentTokens += msgTokens;
    }

    const newMessages = [...keptOlder, ...recentMessages];
    return {
      messages: newMessages,
      removed: messages.length - newMessages.length,
    };
  }

  /**
   * Compact by truncating oldest
   */
  private compactTruncate(messages: ContextMessage[], targetTokens: number): CompactionResult {
    const preserveRecent = this.config.preserveRecentMessages;
    let currentTokens = this.calculateMessageTokens(messages);
    let startIndex = 0;

    while (currentTokens > targetTokens && startIndex < messages.length - preserveRecent) {
      currentTokens -= this.calculateMessageTokens([messages[startIndex]]);
      startIndex++;
    }

    const newMessages = messages.slice(startIndex);
    return {
      messages: newMessages,
      removed: startIndex,
    };
  }

  /**
   * Create a summary message from compacted messages
   */
  private createSummaryMessage(removedMessages: ContextMessage[]): ContextMessage {
    const summary = removedMessages
      .filter((m) => m.role !== "system")
      .map((m) => {
        const role = m.role === "user" ? "User" : "Assistant";
        const content =
          typeof m.content === "string"
            ? m.content.slice(0, 200)
            : JSON.stringify(m.content).slice(0, 200);
        return `${role}: ${content}${m.content.length > 200 ? "..." : ""}`;
      })
      .join("\n");

    return {
      role: "system",
      content: `[Previous conversation summary (${removedMessages.length} messages compacted)]:\n${summary}`,
    };
  }
}
