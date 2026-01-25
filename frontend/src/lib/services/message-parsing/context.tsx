// CRITICAL
"use client";

/**
 * Message Parsing Context
 * Provides dependency injection for MessageParsingService in React components
 */

import { createContext, useMemo, type ReactNode } from "react";
import { messageParsingServiceFactory } from "./factory";
import type {
  IMessageParsingService,
  MessageParsingConfig,
  MessageParsingContextValue,
} from "./types";

// Default configuration
const DEFAULT_CONFIG: MessageParsingConfig = {
  enableArtifacts: true,
  enableThinkingExtraction: true,
  enableMcpXmlStripping: true,
  enableBoxTagStripping: true,
  cacheSize: 100,
};

// Create context with undefined default (must be used within provider)
export const MessageParsingContext = createContext<MessageParsingContextValue | null>(null);

MessageParsingContext.displayName = "MessageParsingContext";

interface MessageParsingProviderProps {
  children: ReactNode;
  /** Optional custom configuration */
  config?: Partial<MessageParsingConfig>;
  /** Optional pre-created service instance (for testing/advanced use) */
  service?: IMessageParsingService;
}

/**
 * Provider component for MessageParsingService
 * Wraps children with access to the parsing service
 */
export function MessageParsingProvider({
  children,
  config,
  service: providedService,
}: MessageParsingProviderProps) {
  const contextValue = useMemo<MessageParsingContextValue>(() => {
    // Use provided service or create from factory
    const service =
      providedService ??
      (config
        ? messageParsingServiceFactory.create(config)
        : messageParsingServiceFactory.createDefault());

    const finalConfig: MessageParsingConfig = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    return {
      service,
      config: finalConfig,
    };
  }, [config, providedService]);

  return (
    <MessageParsingContext.Provider value={contextValue}>{children}</MessageParsingContext.Provider>
  );
}
