// CRITICAL
/**
 * Artifacts Parser
 * Extracts artifact blocks from message content
 * Supports multiple formats: <artifact> tags, ```artifact-* code blocks
 */

import type { IArtifactsParser, ArtifactsResult, Artifact, ArtifactType } from "../types";

// Pattern for <artifact type="html" title="...">...</artifact>
const ARTIFACT_TAG_REGEX =
  /<artifact\s+type="([^"]+)"(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/artifact>/g;

// Pattern for ```artifact-html ... ``` or ```artifact-react ... ```
const ARTIFACT_CODE_BLOCK_REGEX =
  /```artifact-(html|react|javascript|python|svg|mermaid)\s*\n([\s\S]*?)```/g;

// Language to artifact type mapping
const LANGUAGE_TYPE_MAP: Record<string, ArtifactType> = {
  "artifact-html": "html",
  "artifact-react": "react",
  "artifact-javascript": "javascript",
  "artifact-python": "python",
  "artifact-svg": "svg",
  "artifact-mermaid": "mermaid",
};

// Languages that are explicitly artifact-prefixed
const ARTIFACT_LANGUAGES = [
  "artifact-html",
  "artifact-react",
  "artifact-javascript",
  "artifact-python",
  "artifact-svg",
  "artifact-mermaid",
];

export class ArtifactsParser implements IArtifactsParser {
  readonly name = "artifacts" as const;

  parse(input: string): ArtifactsResult {
    if (!input) {
      return { text: "", artifacts: [] };
    }

    const artifacts: Artifact[] = [];
    let text = input;
    let match: RegExpExecArray | null;

    // Pattern 1: <artifact type="html" title="...">...</artifact>
    const tagRegex = new RegExp(ARTIFACT_TAG_REGEX.source, "g");
    while ((match = tagRegex.exec(input)) !== null) {
      const type = this.normalizeType(match[1]);
      const title = match[2] || "";
      const code = match[3].trim();

      // Only add if type is recognized
      if (type) {
        artifacts.push({
          id: `artifact-${artifacts.length}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type,
          title,
          code,
        });
        text = text.replace(match[0], `[Artifact: ${title || type}]`);
      }
    }

    // Pattern 2: ```artifact-html ... ``` or ```artifact-react ... ```
    const codeBlockRegex = new RegExp(ARTIFACT_CODE_BLOCK_REGEX.source, "g");
    while ((match = codeBlockRegex.exec(input)) !== null) {
      const type = this.normalizeType(match[1]);
      const code = match[2].trim();

      // Only add if type is recognized
      if (type) {
        artifacts.push({
          id: `artifact-${artifacts.length}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type,
          title: "",
          code,
        });
        text = text.replace(match[0], `[Artifact: ${type}]`);
      }
    }

    return { text, artifacts };
  }

  canParse(input: string): boolean {
    return ARTIFACT_TAG_REGEX.test(input) || ARTIFACT_CODE_BLOCK_REGEX.test(input);
  }

  getArtifactType(language: string): ArtifactType | null {
    const normalized = language.toLowerCase().trim();
    return LANGUAGE_TYPE_MAP[normalized] || null;
  }

  /**
   * Check if a language identifier is explicitly an artifact type
   */
  isArtifactLanguage(language: string): boolean {
    return ARTIFACT_LANGUAGES.includes(language.toLowerCase().trim());
  }

  /**
   * Normalize type string to ArtifactType
   * Returns null if type is not recognized
   */
  private normalizeType(type: string): ArtifactType | null {
    return this.getArtifactType(type);
  }

  /**
   * Extract artifacts from thinking content
   * Used to surface renderable code from inside <think> blocks
   */
  extractFromThinking(thinkingContent: string): {
    remainingThinking: string;
    artifacts: Artifact[];
  } {
    if (!thinkingContent) {
      return { remainingThinking: "", artifacts: [] };
    }

    const { text, artifacts } = this.parse(thinkingContent);
    if (artifacts.length === 0) {
      return { remainingThinking: thinkingContent, artifacts: [] };
    }

    return {
      remainingThinking: text.trim(),
      artifacts,
    };
  }
}


export const artifactsParser = new ArtifactsParser();
