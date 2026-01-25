// CRITICAL
"use client";

import { useEffect, useRef, useId, useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { EnhancedCodeBlock } from "../code/enhanced-code-block";
import { TypingIndicator, StreamingCursor } from "./typing-indicator";
import {
  useMessageParsingService,
  useMessageParsing,
  thinkingParser,
} from "@/lib/services/message-parsing";
import type { MarkdownSegment, ThinkingResult } from "@/lib/services/message-parsing";
import { useAppStore } from "@/store";

// Shared thinking parser exports
export { thinkingParser };
export function splitThinking(content: string): ThinkingResult {
  return thinkingParser.parse(content);
}

// Mermaid is loaded dynamically to avoid chunk loading errors
let mermaidInstance: typeof import("mermaid").default | null = null;
let mermaidInitialized = false;

/**
 * Sanitize mermaid code to fix common syntax issues from LLM output.
 */
function sanitizeMermaidCode(code: string): string {
  let result = code;

  // Fix <br/> to <br> (mermaid prefers no self-closing)
  result = result.replace(/<br\s*\/>/gi, "<br>");

  // Process line by line to fix node definitions
  const lines = result.split("\n");
  const fixedLines = lines.map((line) => {
    // Skip lines that are just diagram type declarations or arrows
    if (/^\s*(graph|flowchart|sequenceDiagram|subgraph|end)\b/i.test(line)) {
      return line;
    }

    // Fix unquoted text with parentheses in node labels
    // Pattern: NodeId[Text with (parens)] or NodeId(Text with (parens))
    // These need the inner parens escaped or the text quoted

    // Match node definitions like: A[Some Text (with parens)]
    // and convert problematic parens inside labels to escaped form
    line = line.replace(
      /(\w+)\[([^\]]*)\]/g,
      (match, nodeId, content) => {
        // If content has unbalanced or problematic parens, quote it
        if (/\([^)]*\)/.test(content) && !content.startsWith('"')) {
          // Escape quotes in content and wrap in quotes
          const escaped = content.replace(/"/g, "'");
          return `${nodeId}["${escaped}"]`;
        }
        return match;
      }
    );

    // Fix stadium shapes with parens inside: A(Text (thing))
    // Convert inner parens to brackets or escape
    line = line.replace(
      /(\w+)\(([^)]*\([^)]*\)[^)]*)\)/g,
      (match, nodeId, content) => {
        // Replace inner parens with brackets
        const fixed = content.replace(/\(([^)]*)\)/g, "[$1]");
        return `${nodeId}(${fixed})`;
      }
    );

    return line;
  });

  return fixedLines.join("\n");
}

async function getMermaid() {
  if (!mermaidInstance) {
    const mod = await import("mermaid");
    mermaidInstance = mod.default;
  }
  if (!mermaidInitialized && mermaidInstance) {
    mermaidInstance.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      fontFamily: "inherit",
      logLevel: "fatal",
      suppressErrorRendering: true,
    });
    mermaidInitialized = true;
  }
  return mermaidInstance;
}

interface MessageRendererProps {
  content: string;
  isStreaming?: boolean;
  artifactsEnabled?: boolean;
}

function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "_");
  const mermaidState = useAppStore((state) => state.mermaidState[id] ?? { svg: "", error: null });
  const setMermaidState = useAppStore((state) => state.setMermaidState);
  const { svg, error } = mermaidState;
  const renderSeqRef = useRef(0);

  useEffect(() => {
    const renderDiagram = async () => {
      if (!code.trim()) return;

      const seq = ++renderSeqRef.current;

      const looksLikeMermaid =
        /^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/.test(
          code.trim(),
        );
      if (!looksLikeMermaid) {
        setMermaidState(
          id,
          "",
          "Not a valid Mermaid diagram (missing diagram header like `graph TD` or `sequenceDiagram`).",
        );
        return;
      }

      try {
        const mermaid = await getMermaid();
        if (!mermaid) {
          setMermaidState(id, "", "Failed to load mermaid library");
          return;
        }
        const sanitized = sanitizeMermaidCode(code.trim());
        const { svg } = await mermaid.render(`mermaid_${id}_${seq}`, sanitized);
        if (seq !== renderSeqRef.current) return;
        setMermaidState(id, svg, null);
      } catch (e) {
        if (seq !== renderSeqRef.current) return;
        setMermaidState(
          id,
          "",
          e instanceof Error ? e.message : "Failed to render diagram",
        );
      }
    };

    const handle = window.setTimeout(() => {
      renderDiagram();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [code, id, setMermaidState]);

  if (error) {
    return (
      <div className="my-3 p-4 rounded-lg border border-red-500/30 bg-red-500/10">
        <div className="flex items-center gap-2 text-red-400 text-sm mb-2">
          <AlertCircle className="h-4 w-4" />
          <span>Diagram Error</span>
        </div>
        <div className="text-xs text-red-300 mb-2 break-words">{error}</div>
        <pre className="text-xs text-[#d8d4cd] overflow-x-auto">{code}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-3 p-4 rounded-lg border border-(--border) bg-(--card) overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

interface CodeBlockProps {
  segment: MarkdownSegment;
  artifactsEnabled?: boolean;
  isStreaming?: boolean;
}

function CodeBlock({ segment, artifactsEnabled, isStreaming }: CodeBlockProps) {
  const lang = segment.language || "";

  // Handle mermaid diagrams
  if (lang === "mermaid") {
    if (isStreaming) {
      return (
        <div className="my-3 p-4 rounded-lg border border-(--border) bg-(--card) animate-in fade-in">
          <div className="text-xs text-[#b8b4ad] mb-2">
            Mermaid preview renders after streaming completes.
          </div>
          <pre className="text-xs text-[#d8d4cd] overflow-x-auto">{segment.content}</pre>
        </div>
      );
    }
    return <MermaidDiagram code={segment.content} />;
  }

  // Use enhanced code block for everything else
  return (
    <EnhancedCodeBlock
      language={lang}
      artifactsEnabled={artifactsEnabled}
      isStreaming={isStreaming}
    >
      {segment.content}
    </EnhancedCodeBlock>
  );
}

interface MarkdownBlockProps {
  html: string;
}

function MarkdownBlock({ html }: MarkdownBlockProps) {
  return <div className="chat-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MessageRenderer({ content, isStreaming, artifactsEnabled }: MessageRendererProps) {
  const parsingService = useMessageParsingService();
  const { renderMarkdown } = useMessageParsing();

  const parsed = useMemo(() => {
    if (isStreaming) return null;
    return parsingService.parse(content, {
      isStreaming: false,
      extractArtifacts: false,
    });
  }, [parsingService, content, isStreaming]);

  const mainContent = parsed?.thinking.mainContent ?? content;
  const segments = parsed?.segments ?? [];
  const thinkingContent = parsed?.thinking.thinkingContent ?? null;

  return (
    <div className="message-content min-w-0 break-words overflow-hidden max-w-full group relative text-inherit">
      {/* Main content */}
      {mainContent && (
        <div style={{ color: "#e8e4dd" }}>
          {isStreaming ? (
            <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
              {mainContent}
            </div>
          ) : (
            segments.map((segment, index) => {
              if (segment.type === "code") {
                return (
                  <CodeBlock
                    key={`code-${index}`}
                    segment={segment}
                    artifactsEnabled={artifactsEnabled}
                    isStreaming={isStreaming}
                  />
                );
              }

              const html = renderMarkdown(segment.content);
              return <MarkdownBlock key={`md-${index}`} html={html} />;
            })
          )}
        </div>
      )}

      {/* Streaming indicators */}
      {!mainContent && !thinkingContent && isStreaming && (
        <div className="flex items-center gap-2">
          <TypingIndicator size="md" />
        </div>
      )}

      {mainContent && isStreaming && <StreamingCursor />}
    </div>
  );
}
