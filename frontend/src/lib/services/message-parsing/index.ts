// CRITICAL
/**
 * Message Parsing Service Module
 *
 * A comprehensive service for parsing model responses with:
 * - Box tag stripping
 * - Thinking/reasoning extraction
 * - MCP XML stripping
 * - Artifact extraction
 * - Markdown segmentation and rendering
 *
 * @example
 * ```tsx
 * // Wrap your app/page with the provider
 * <MessageParsingProvider>
 *   <ChatComponent />
 * </MessageParsingProvider>
 *
 * // Use the hook in components
 * function ChatComponent() {
 *   const { parse, parseThinking } = useMessageParsing();
 *
 *   const parsed = parse(message.content, { isStreaming });
 *   // Use parsed.thinking, parsed.artifacts, parsed.segments
 * }
 * ```
 */

// Types
export type {
  ArtifactType,
  Artifact,
  ArtifactsResult,
  ThinkingResult,
  MarkdownSegmentType,
  MarkdownSegment,
  ParsedMessage,
  ParseOptions,
  MessageParsingConfig,
  IMessageParsingService,
  IMessageParsingServiceFactory,
  MessageParsingContextValue,
  IBoxTagsParser,
  IThinkingParser,
  IMcpXmlParser,
  IArtifactsParser,
  IMarkdownParser,
} from "./types";

// Default config
export { DEFAULT_CONFIG } from "./types";

// Service
export { MessageParsingService } from "./service";

// Factory
export {
  MessageParsingServiceFactory,
  messageParsingServiceFactory,
  getMessageParsingService,
} from "./factory";

// Context
export { MessageParsingContext, MessageParsingProvider } from "./context";

// Hooks
export {
  useMessageParsingService,
  useMessageParsingConfig,
  useMessageParsing,
  useParsedMessage,
  useThinkingContent,
  useArtifacts,
  useMarkdownSegments,
} from "./hooks";

// Individual parsers (for advanced use cases)
export {
  BoxTagsParser,
  boxTagsParser,
  ThinkingParser,
  thinkingParser,
  McpXmlParser,
  mcpXmlParser,
  ArtifactsParser,
  artifactsParser,
  MarkdownParser,
  markdownParser,
} from "./parsers";
