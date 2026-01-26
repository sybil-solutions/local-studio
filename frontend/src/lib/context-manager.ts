// CRITICAL
/**
 * Context Management System
 * Prevents model crashes by tracking and compacting conversation context
 */

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

export type CompactionStrategy = 'sliding_window' | 'summarize' | 'truncate';

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

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  [key: string]: unknown;
}

/**
 * Estimate tokens for a message (rough approximation: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Calculate total tokens for messages
 */
export function calculateMessageTokens(messages: Message[]): number {
  return messages.reduce((total, msg) => {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return total + estimateTokens(content) + 4; // +4 for role/formatting overhead
  }, 0);
}

/**
 * Compact messages using sliding window strategy
 */
export function compactSlidingWindow(
  messages: Message[],
  targetTokens: number,
  preserveRecent: number
): { messages: Message[]; removed: number } {
  if (messages.length <= preserveRecent) {
    return { messages, removed: 0 };
  }

  const recentMessages = messages.slice(-preserveRecent);
  const olderMessages = messages.slice(0, -preserveRecent);

  let currentTokens = calculateMessageTokens(recentMessages);
  const keptOlder: Message[] = [];

  // Keep older messages from most recent, until we hit target
  for (let i = olderMessages.length - 1; i >= 0; i--) {
    const msgTokens = calculateMessageTokens([olderMessages[i]]);
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
 * Compact messages by truncating oldest
 */
export function compactTruncate(
  messages: Message[],
  targetTokens: number,
  preserveRecent: number
): { messages: Message[]; removed: number } {
  let currentTokens = calculateMessageTokens(messages);
  let startIndex = 0;

  while (currentTokens > targetTokens && startIndex < messages.length - preserveRecent) {
    currentTokens -= calculateMessageTokens([messages[startIndex]]);
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
export function createSummaryMessage(removedMessages: Message[]): Message {
  const summary = removedMessages
    .filter(m => m.role !== 'system')
    .map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      const content = typeof m.content === 'string'
        ? m.content.slice(0, 200)
        : JSON.stringify(m.content).slice(0, 200);
      return `${role}: ${content}${m.content.length > 200 ? '...' : ''}`;
    })
    .join('\n');

  return {
    role: 'system',
    content: `[Previous conversation summary (${removedMessages.length} messages compacted)]:\n${summary}`,
  };
}

/**
 * Perform compaction on messages
 */
export function compactMessages(
  messages: Message[],
  maxContext: number,
  config: ContextConfig,
  strategy: CompactionStrategy = 'sliding_window'
): { messages: Message[]; event: CompactionEvent } {
  const beforeTokens = calculateMessageTokens(messages);
  const targetTokens = Math.floor(maxContext * config.targetAfterCompaction);

  let result: { messages: Message[]; removed: number };
  let summary: string | undefined;

  switch (strategy) {
    case 'summarize': {
      const recentMessages = messages.slice(-config.preserveRecentMessages);
      const olderMessages = messages.slice(0, -config.preserveRecentMessages);

      if (olderMessages.length > 0) {
        const summaryMessage = createSummaryMessage(olderMessages);
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
    case 'truncate':
      result = compactTruncate(messages, targetTokens, config.preserveRecentMessages);
      break;
    case 'sliding_window':
    default:
      result = compactSlidingWindow(messages, targetTokens, config.preserveRecentMessages);
  }

  const afterTokens = calculateMessageTokens(result.messages);

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
export function getUtilizationLevel(utilization: number): 'low' | 'medium' | 'high' | 'critical' {
  if (utilization < 0.5) return 'low';
  if (utilization < 0.75) return 'medium';
  if (utilization < 0.9) return 'high';
  return 'critical';
}

/**
 * Format token count for display
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}
