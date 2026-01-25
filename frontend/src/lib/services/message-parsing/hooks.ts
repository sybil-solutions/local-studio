// CRITICAL
"use client";

/**
 * Message Parsing Hooks
 * React hooks for consuming the MessageParsingService
 */

import { useContext, useMemo, useCallback } from "react";
import { MessageParsingContext } from "./context";
import { getMessageParsingService } from "./factory";
import type {
  IMessageParsingService,
  ParsedMessage,
  ParseOptions,
  ThinkingResult,
  ArtifactsResult,
  MarkdownSegment,
  ArtifactType,
  MessageParsingConfig,
} from "./types";

/**
 * Hook to access the MessageParsingService
 * Falls back to default service if used outside provider
 */
export function useMessageParsingService(): IMessageParsingService {
  const context = useContext(MessageParsingContext);

  // Fall back to default service if no provider
  if (!context) {
    return getMessageParsingService();
  }

  return context.service;
}

/**
 * Hook to access the parsing configuration
 */
export function useMessageParsingConfig(): MessageParsingConfig {
  const context = useContext(MessageParsingContext);

  if (!context) {
    // Return default config
    return {
      enableArtifacts: true,
      enableThinkingExtraction: true,
      enableMcpXmlStripping: true,
      enableBoxTagStripping: true,
      cacheSize: 100,
    };
  }

  return context.config;
}

/**
 * Main hook for message parsing operations
 * Provides memoized callbacks for all parsing operations
 */
export function useMessageParsing() {
  const service = useMessageParsingService();
  const config = useMessageParsingConfig();

  const parse = useCallback(
    (content: string, options?: ParseOptions): ParsedMessage => {
      return service.parse(content, options);
    },
    [service],
  );

  const parseThinking = useCallback(
    (content: string): ThinkingResult => {
      return service.parseThinking(content);
    },
    [service],
  );

  const extractThinkingBlocks = useCallback(
    (content: string): Array<{ content: string; isComplete: boolean }> => {
      return service.extractThinkingBlocks(content);
    },
    [service],
  );

  const parseArtifacts = useCallback(
    (content: string): ArtifactsResult => {
      return service.parseArtifacts(content);
    },
    [service],
  );

  const stripTags = useCallback(
    (content: string): string => {
      return service.stripTags(content);
    },
    [service],
  );

  const getSegments = useCallback(
    (content: string): MarkdownSegment[] => {
      return service.getSegments(content);
    },
    [service],
  );

  const renderMarkdown = useCallback(
    (content: string): string => {
      return service.renderMarkdown(content);
    },
    [service],
  );

  const getArtifactType = useCallback(
    (language: string): ArtifactType | null => {
      return service.getArtifactType(language);
    },
    [service],
  );

  const getCached = useCallback(
    (content: string): ParsedMessage | null => {
      return service.getCached(content);
    },
    [service],
  );

  const invalidateCache = useCallback(
    (content?: string): void => {
      service.invalidateCache(content);
    },
    [service],
  );

  return {
    // Service instance
    service,
    config,

    // Parsing operations
    parse,
    parseThinking,
    extractThinkingBlocks,
    parseArtifacts,
    stripTags,
    getSegments,
    renderMarkdown,
    getArtifactType,

    // Cache operations
    getCached,
    invalidateCache,
    cacheSize: service.cacheSize,
  };
}

/**
 * Hook for parsing a single message with memoization
 * Useful when you need the full parsed result for a specific message
 */
export function useParsedMessage(content: string, options?: ParseOptions): ParsedMessage {
  const service = useMessageParsingService();

  return useMemo(() => {
    return service.parse(content, options);
  }, [service, content, options]);
}

/**
 * Hook for parsing only thinking content
 * Lightweight alternative when you only need thinking extraction
 */
export function useThinkingContent(content: string): ThinkingResult {
  const service = useMessageParsingService();

  return useMemo(() => {
    return service.parseThinking(content);
  }, [service, content]);
}

/**
 * Hook for parsing only artifacts
 * Lightweight alternative when you only need artifact extraction
 */
export function useArtifacts(content: string): ArtifactsResult {
  const service = useMessageParsingService();

  return useMemo(() => {
    return service.parseArtifacts(content);
  }, [service, content]);
}

/**
 * Hook for markdown segments
 */
export function useMarkdownSegments(content: string): MarkdownSegment[] {
  const service = useMessageParsingService();

  return useMemo(() => {
    return service.getSegments(content);
  }, [service, content]);
}
