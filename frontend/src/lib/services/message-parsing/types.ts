// CRITICAL
/**
 * Message Parsing Service Types
 * Defines all types specific to message parsing functionality
 */

import type { IParser, ICacheableService, IServiceFactory } from "../types";

// ============================================================================
// Artifact Types
// ============================================================================

export type ArtifactType = "html" | "react" | "javascript" | "svg" | "python" | "mermaid";

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  code: string;
}

export interface ArtifactsResult {
  text: string;
  artifacts: Artifact[];
}

// ============================================================================
// Thinking Types
// ============================================================================

export interface ThinkingResult {
  thinkingContent: string | null;
  mainContent: string;
  isThinkingComplete: boolean;
}

// ============================================================================
// Markdown Types
// ============================================================================

export type MarkdownSegmentType = "markdown" | "code";

export interface MarkdownSegment {
  type: MarkdownSegmentType;
  content: string;
  language?: string;
}

// ============================================================================
// Parsed Message (Full Result)
// ============================================================================

export interface ParsedMessage {
  /** Original raw content */
  raw: string;
  /** Content hash for caching */
  hash: string;
  /** Thinking/reasoning content if present */
  thinking: ThinkingResult;
  /** Extracted artifacts */
  artifacts: Artifact[];
  /** Content with artifacts removed (for display) */
  contentWithoutArtifacts: string;
  /** Markdown segments for rendering */
  segments: MarkdownSegment[];
  /** Whether parsing is from a streaming message */
  isStreaming: boolean;
  /** Timestamp of parsing */
  parsedAt: number;
}

// ============================================================================
// Parser Interfaces
// ============================================================================

export interface IBoxTagsParser extends IParser<string, string> {
  readonly name: "box-tags";
}

export interface IThinkingParser extends IParser<string, ThinkingResult> {
  readonly name: "thinking";
}

export interface IMcpXmlParser extends IParser<string, string> {
  readonly name: "mcp-xml";
}

export interface IArtifactsParser extends IParser<string, ArtifactsResult> {
  readonly name: "artifacts";
  getArtifactType(language: string): ArtifactType | null;
}

export interface IMarkdownParser extends IParser<string, MarkdownSegment[]> {
  readonly name: "markdown";
  renderToHtml(markdown: string): string;
}

// ============================================================================
// Service Configuration
// ============================================================================

export interface MessageParsingConfig {
  /** Enable artifact extraction */
  enableArtifacts: boolean;
  /** Enable thinking/reasoning extraction */
  enableThinkingExtraction: boolean;
  /** Enable MCP XML stripping */
  enableMcpXmlStripping: boolean;
  /** Enable box tag stripping */
  enableBoxTagStripping: boolean;
  /** Maximum cache size for parsed results */
  cacheSize: number;
}

export const DEFAULT_CONFIG: MessageParsingConfig = {
  enableArtifacts: true,
  enableThinkingExtraction: true,
  enableMcpXmlStripping: true,
  enableBoxTagStripping: true,
  cacheSize: 100,
};

// ============================================================================
// Parse Options (per-call overrides)
// ============================================================================

export interface ParseOptions {
  /** Whether the message is currently streaming */
  isStreaming?: boolean;
  /** Skip cache lookup */
  skipCache?: boolean;
  /** Override artifact extraction for this call */
  extractArtifacts?: boolean;
  /** Override thinking extraction for this call */
  extractThinking?: boolean;
}

// ============================================================================
// Service Interface
// ============================================================================

export interface IMessageParsingService extends ICacheableService<string, ParsedMessage> {
  readonly name: "message-parsing";
  readonly config: MessageParsingConfig;

  /**
   * Parse a complete message with all enabled transformations
   */
  parse(content: string, options?: ParseOptions): ParsedMessage;

  /**
   * Parse only thinking content (lightweight)
   */
  parseThinking(content: string): ThinkingResult;

  /**
   * Extract all thinking blocks from content
   * Returns array of blocks with content and completion status
   */
  extractThinkingBlocks(content: string): Array<{ content: string; isComplete: boolean }>;

  /**
   * Parse only artifacts (lightweight)
   */
  parseArtifacts(content: string): ArtifactsResult;

  /**
   * Strip all tags without full parsing
   */
  stripTags(content: string): string;

  /**
   * Get markdown segments for rendering
   */
  getSegments(content: string): MarkdownSegment[];

  /**
   * Render markdown to HTML
   */
  renderMarkdown(content: string): string;

  /**
   * Determine artifact type from language
   */
  getArtifactType(language: string): ArtifactType | null;
}

// ============================================================================
// Factory Interface
// ============================================================================

export interface IMessageParsingServiceFactory extends IServiceFactory<
  Partial<MessageParsingConfig>,
  IMessageParsingService
> {
  create(config: Partial<MessageParsingConfig>): IMessageParsingService;
  createDefault(): IMessageParsingService;
}

// ============================================================================
// React Context Types
// ============================================================================

export interface MessageParsingContextValue {
  service: IMessageParsingService;
  config: MessageParsingConfig;
}
