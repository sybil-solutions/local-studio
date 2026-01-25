// CRITICAL
/**
 * Message Parsing Service
 * Orchestrates all parsing operations with caching
 */

import { LRUCache, hashString } from "../types";
import {
  boxTagsParser,
  thinkingParser,
  mcpXmlParser,
  artifactsParser,
  markdownParser,
} from "./parsers";
import type {
  IMessageParsingService,
  MessageParsingConfig,
  ParseOptions,
  ParsedMessage,
  ThinkingResult,
  ArtifactsResult,
  MarkdownSegment,
  ArtifactType,
  Artifact,
} from "./types";

export class MessageParsingService implements IMessageParsingService {
  readonly name = "message-parsing" as const;
  readonly config: MessageParsingConfig;

  private cache: LRUCache<string, ParsedMessage>;

  constructor(config: MessageParsingConfig) {
    this.config = config;
    this.cache = new LRUCache<string, ParsedMessage>(config.cacheSize);
  }

  /**
   * Parse a complete message with all enabled transformations
   */
  parse(content: string, options: ParseOptions = {}): ParsedMessage {
    if (!content) {
      return this.createEmptyResult("", options.isStreaming ?? false);
    }

    const hash = this.createHash(content, options);

    // Check cache unless explicitly skipped or streaming
    if (!options.skipCache && !options.isStreaming) {
      const cached = this.cache.get(hash);
      if (cached) {
        return cached;
      }
    }

    // Step 1: Strip MCP XML if enabled
    let processedContent = content;
    if (this.config.enableMcpXmlStripping) {
      processedContent = mcpXmlParser.parse(processedContent);
    }

    // Step 2: Strip box tags if enabled
    if (this.config.enableBoxTagStripping) {
      processedContent = boxTagsParser.parse(processedContent);
    }

    // Step 3: Extract artifacts if enabled
    let artifacts: Artifact[] = [];
    let contentWithoutArtifacts = processedContent;
    const shouldExtractArtifacts = options.extractArtifacts ?? this.config.enableArtifacts;

    if (shouldExtractArtifacts) {
      const artifactResult = artifactsParser.parse(processedContent);
      artifacts = artifactResult.artifacts;
      contentWithoutArtifacts = artifactResult.text;
    }

    // Step 4: Extract thinking if enabled
    let thinking: ThinkingResult = {
      thinkingContent: null,
      mainContent: contentWithoutArtifacts,
      isThinkingComplete: true,
    };
    const shouldExtractThinking = options.extractThinking ?? this.config.enableThinkingExtraction;

    if (shouldExtractThinking) {
      thinking = thinkingParser.parse(contentWithoutArtifacts);

      // Extract artifacts from thinking content if artifacts enabled
      if (shouldExtractArtifacts && thinking.thinkingContent) {
        const thinkingArtifacts = artifactsParser.extractFromThinking(thinking.thinkingContent);
        if (thinkingArtifacts.artifacts.length > 0) {
          thinking = {
            ...thinking,
            thinkingContent: thinkingArtifacts.remainingThinking || null,
          };
          artifacts = [...artifacts, ...thinkingArtifacts.artifacts];
        }
      }
    }

    // Step 5: Parse markdown segments
    const segments = markdownParser.parse(thinking.mainContent);

    // Build result
    const result: ParsedMessage = {
      raw: content,
      hash,
      thinking,
      artifacts,
      contentWithoutArtifacts,
      segments,
      isStreaming: options.isStreaming ?? false,
      parsedAt: Date.now(),
    };

    // Cache non-streaming results
    if (!options.isStreaming) {
      this.cache.set(hash, result);
    }

    return result;
  }

  /**
   * Parse only thinking content (lightweight operation)
   */
  parseThinking(content: string): ThinkingResult {
    if (!content) {
      return { thinkingContent: null, mainContent: "", isThinkingComplete: true };
    }

    // Strip box tags first
    const cleaned = this.config.enableBoxTagStripping ? boxTagsParser.parse(content) : content;

    return thinkingParser.parse(cleaned);
  }

  /**
   * Extract all thinking blocks from content
   */
  extractThinkingBlocks(content: string): Array<{ content: string; isComplete: boolean }> {
    if (!content) return [];
    return thinkingParser.extractAllBlocks(content);
  }

  /**
   * Parse only artifacts (lightweight operation)
   */
  parseArtifacts(content: string): ArtifactsResult {
    if (!content) {
      return { text: "", artifacts: [] };
    }

    // Strip box tags first
    const cleaned = this.config.enableBoxTagStripping ? boxTagsParser.parse(content) : content;

    return artifactsParser.parse(cleaned);
  }

  /**
   * Strip all tags without full parsing
   */
  stripTags(content: string): string {
    if (!content) return content;

    let result = content;

    if (this.config.enableMcpXmlStripping) {
      result = mcpXmlParser.parse(result);
    }

    if (this.config.enableBoxTagStripping) {
      result = boxTagsParser.parse(result);
    }

    return result;
  }

  /**
   * Get markdown segments for rendering
   */
  getSegments(content: string): MarkdownSegment[] {
    if (!content) return [];
    return markdownParser.parse(content);
  }

  /**
   * Render markdown to HTML
   */
  renderMarkdown(content: string): string {
    if (!content) return "";
    return markdownParser.renderToHtml(content);
  }

  /**
   * Determine artifact type from language
   */
  getArtifactType(language: string): ArtifactType | null {
    return artifactsParser.getArtifactType(language);
  }

  /**
   * Get cached result by content
   */
  getCached(content: string): ParsedMessage | null {
    const hash = hashString(content);
    return this.cache.get(hash);
  }

  /**
   * Invalidate cache
   */
  invalidateCache(content?: string): void {
    if (content) {
      const hash = hashString(content);
      this.cache.delete(hash);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get current cache size
   */
  get cacheSize(): number {
    return this.cache.size;
  }

  /**
   * Create content hash for caching
   */
  private createHash(content: string, options: ParseOptions): string {
    const optionsKey = [
      options.extractArtifacts ?? "default",
      options.extractThinking ?? "default",
    ].join("-");
    return hashString(`${content}:${optionsKey}`);
  }

  /**
   * Create empty result for empty content
   */
  private createEmptyResult(raw: string, isStreaming: boolean): ParsedMessage {
    return {
      raw,
      hash: "",
      thinking: { thinkingContent: null, mainContent: "", isThinkingComplete: true },
      artifacts: [],
      contentWithoutArtifacts: "",
      segments: [],
      isStreaming,
      parsedAt: Date.now(),
    };
  }
}
