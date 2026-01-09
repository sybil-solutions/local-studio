'use client';

import { useState, useMemo, useEffect, useRef, useId } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, Brain, Copy, Check, AlertCircle, Play } from 'lucide-react';
import mermaid from 'mermaid';
import { CodeSandbox } from './code-sandbox';
import { ArtifactRenderer, extractArtifacts, getArtifactType } from './artifact-renderer';
import { EnhancedCodeBlock } from './enhanced-code-block';
import { TypingIndicator, StreamingCursor } from './typing-indicator';
import { MessageActions } from './message-actions';
import type { Artifact } from '@/lib/types';
import { normalizeAssistantMarkdownForRender } from '@/lib/chat-markdown';

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'inherit',
  logLevel: 'fatal',
  suppressErrorRendering: true,
});

interface MessageRendererProps {
  content: string;
  isStreaming?: boolean;
  artifactsEnabled?: boolean;
  messageId?: string;
  showActions?: boolean;
}

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

const BOX_TAGS_PATTERN = /<\|(?:begin|end)_of_box\|>/g;
const stripBoxTags = (text: string) => (text ? text.replace(BOX_TAGS_PATTERN, '') : text);

// Strip MCP tool call XML from content (MiroThinker/Qwen3 models)
// Handles various malformations: missing <, space in closing tag, etc.
const MCP_TOOL_PATTERN = /<?use_mcp_tool>[\s\S]*?<\/use_mcp[_ ]?tool>/gi;
const MCP_INCOMPLETE_PATTERN = /<use_mcp_tool>[\s\S]*$/gi;
const stripMcpXml = (text: string): string => {
  if (!text) return text;
  // Remove complete MCP tool blocks
  let result = text.replace(MCP_TOOL_PATTERN, '');
  // Remove incomplete MCP blocks at end of stream
  result = result.replace(MCP_INCOMPLETE_PATTERN, '');
  // Clean up any orphaned fragments
  result = result.replace(/use_mcp_tool>[\s\S]*?<\/use_mcp[_ ]?tool>/gi, '');
  return result.trim();
};

// Export for use in chat page (thinking panel)
export function splitThinking(content: string): {
  thinkingContent: string | null;
  mainContent: string;
  isThinkingComplete: boolean;
} {
  if (!content) return { thinkingContent: null, mainContent: '', isThinkingComplete: true };

  const openTags = ['<think>', '<thinking>'];
  const closeTags = ['</think>', '</thinking>'];

  const reasoningParts: string[] = [];
  const visibleParts: string[] = [];
  let remaining = content;
  let isComplete = true;

  while (remaining) {
    const lower = remaining.toLowerCase();

    const openIdxs = openTags
      .map((t) => lower.indexOf(t))
      .filter((i) => i !== -1);
    const closeIdxs = closeTags
      .map((t) => lower.indexOf(t))
      .filter((i) => i !== -1);

    const openIdx = openIdxs.length ? Math.min(...openIdxs) : -1;
    const closeIdx = closeIdxs.length ? Math.min(...closeIdxs) : -1;

    if (openIdx === -1 && closeIdx === -1) {
      visibleParts.push(remaining);
      break;
    }

    const isOpenNext = openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx);

    if (isOpenNext) {
      if (openIdx > 0) {
        visibleParts.push(remaining.slice(0, openIdx));
      }

      const matchedOpen = openTags.find((t) => lower.startsWith(t, openIdx))!;
      remaining = remaining.slice(openIdx + matchedOpen.length);

      const lowerAfter = remaining.toLowerCase();
      const closeIdxAfter = closeTags
        .map((t) => lowerAfter.indexOf(t))
        .filter((i) => i !== -1);
      const closePos = closeIdxAfter.length ? Math.min(...closeIdxAfter) : -1;
      if (closePos === -1) {
        reasoningParts.push(remaining);
        remaining = '';
        isComplete = false;
        break;
      }

      reasoningParts.push(remaining.slice(0, closePos));
      const matchedClose = closeTags.find((t) => lowerAfter.startsWith(t, closePos))!;
      remaining = remaining.slice(closePos + matchedClose.length);
      continue;
    }

    // Closing tag without explicit opening (prompt may include opening tag)
    if (closeIdx > 0) {
      reasoningParts.push(remaining.slice(0, closeIdx));
    }
    const matchedClose = closeTags.find((t) => lower.startsWith(t, closeIdx))!;
    remaining = remaining.slice(closeIdx + matchedClose.length);
  }

  const thinkingText = stripBoxTags(reasoningParts.join('')).trim();
  const visibleText = stripBoxTags(visibleParts.join(''));

  return {
    thinkingContent: thinkingText ? thinkingText : null,
    mainContent: visibleText,
    isThinkingComplete: isComplete,
  };
}

function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="my-2 md:my-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-xs text-[#b8b4ad] hover:text-[#e8e4dd] transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span>reasoned for {wordCount} words{isStreaming ? '...' : ''}</span>
      </button>
      {isExpanded && (
        <div className="mt-2 pl-4 border-l-2 border-[#363432] text-sm text-[#c8c4bd] whitespace-pre-wrap max-h-[40vh] overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  );
}

function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const id = useId().replace(/:/g, '_');
  const renderSeqRef = useRef(0);

  useEffect(() => {
    const renderDiagram = async () => {
      if (!code.trim()) return;

      // Mermaid parsing is noisy (and often invalid while streaming). Debounce renders.
      const seq = ++renderSeqRef.current;

      const looksLikeMermaid =
        /^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/.test(
          code.trim()
        );
      if (!looksLikeMermaid) {
        // Avoid spamming mermaid with obviously non-mermaid content.
        setSvg('');
        setError('Not a valid Mermaid diagram (missing diagram header like `graph TD` or `sequenceDiagram`).');
        return;
      }

      try {
        // Mermaid can behave badly when re-rendered with the same id; include a monotonically increasing suffix.
        const { svg } = await mermaid.render(`mermaid_${id}_${seq}`, code.trim());
        if (seq !== renderSeqRef.current) return;
        setSvg(svg);
        setError(null);
      } catch (e) {
        if (seq !== renderSeqRef.current) return;
        setError(e instanceof Error ? e.message : 'Failed to render diagram');
        setSvg('');
      }
    };

    const handle = window.setTimeout(() => {
      renderDiagram();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [code, id]);

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
      className="my-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

interface CodeBlockProps {
  children: string;
  className?: string;
  artifactsEnabled?: boolean;
  isStreaming?: boolean;
  language?: string;
}

function CodeBlock({ children, className, artifactsEnabled, isStreaming, language }: CodeBlockProps) {
  const lang = language || className?.replace('language-', '') || '';

  // Check if this is a mermaid diagram
  if (lang === 'mermaid') {
    // Avoid spamming mermaid parser while a streamed response is still changing.
    if (isStreaming) {
      return (
        <div className="my-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--card)] animate-in fade-in">
          <div className="text-xs text-[#b8b4ad] mb-2">Mermaid preview renders after streaming completes.</div>
          <pre className="text-xs text-[#d8d4cd] overflow-x-auto">{children}</pre>
        </div>
      );
    }
    return <MermaidDiagram code={String(children)} />;
  }

  // Use enhanced code block for everything else
  return (
    <EnhancedCodeBlock
      language={lang}
      artifactsEnabled={artifactsEnabled}
      isStreaming={isStreaming}
    >
      {String(children)}
    </EnhancedCodeBlock>
  );
}

export function MessageRenderer({ content, isStreaming, artifactsEnabled, messageId, showActions = true }: MessageRendererProps) {
  // Mermaid uses an internal render ID cache. We need to reset when content changes.
  // This is done via useId in MermaidDiagram.
  const { thinkingContent, mainContent, isThinkingComplete, artifacts } = useMemo(() => {
    // First strip any MCP XML tool calls that leaked through streaming
    const contentWithoutMcp = stripMcpXml(content);
    const normalizedContent = normalizeAssistantMarkdownForRender(contentWithoutMcp);
    // First extract any explicit artifact blocks
    const { text: contentWithoutArtifacts, artifacts: extractedArtifacts } = extractArtifacts(normalizedContent);

    const split = splitThinking(contentWithoutArtifacts);

    // If the model placed renderable code fences inside <think>, surface them as artifacts
    // so users can still preview them without expanding the thinking panel.
    const additionalArtifacts: Artifact[] = [];
    let updatedThinking = split.thinkingContent;
    if (artifactsEnabled && updatedThinking) {
      const fenceRegex = /```([a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/g;
      const keptChunks: string[] = [];
      let lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = fenceRegex.exec(updatedThinking)) !== null) {
        const lang = (m[1] || '').trim();
        const code = (m[2] || '').trim();
        const lowered = lang.toLowerCase() === 'mermaidgraph' ? 'mermaid' : lang.toLowerCase();
        const artifactType = getArtifactType(lowered);
        const canPreview = artifactType && ['html', 'react', 'javascript', 'svg'].includes(artifactType);
        if (artifactType && canPreview) {
          additionalArtifacts.push({
            id: `think-artifact-${additionalArtifacts.length}-${Date.now()}`,
            type: artifactType,
            title: lang ? `${lang} (from thinking)` : 'Artifact (from thinking)',
            code,
          });
          keptChunks.push(updatedThinking.slice(lastIndex, m.index));
          keptChunks.push(`[Artifact: ${artifactType}]`);
          lastIndex = m.index + m[0].length;
        }
      }
      if (additionalArtifacts.length > 0) {
        keptChunks.push(updatedThinking.slice(lastIndex));
        updatedThinking = keptChunks.join('').trim() || null;
      }
    }

    return {
      thinkingContent: updatedThinking,
      mainContent: split.mainContent,
      isThinkingComplete: split.isThinkingComplete,
      artifacts: [...extractedArtifacts, ...additionalArtifacts],
    };
  }, [content, artifactsEnabled]);

  return (
    <div className="message-content overflow-hidden max-w-full group relative text-inherit">
      {/* Message Actions */}
      {showActions && messageId && content && (
        <div className="absolute -top-2 right-0 z-10">
          <MessageActions content={content} messageId={messageId} />
        </div>
      )}

      {thinkingContent && (
        <ThinkingBlock
          content={thinkingContent}
          isStreaming={isStreaming && !isThinkingComplete}
        />
      )}

      {mainContent && (
        <div style={{ color: '#e8e4dd' }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const isInline = !className;
              const codeContent = String(children).replace(/\n$/, '');
              const langMatch = className?.match(/language-(\w+)/);
              const language = langMatch?.[1];

              if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded bg-[var(--accent)] font-mono text-sm"
                  {...props}
                >
                  {codeContent}
                </code>
              );
            }

              return (
                <CodeBlock
                  className={className}
                  artifactsEnabled={artifactsEnabled}
                  isStreaming={isStreaming}
                  language={language}
                >
                  {codeContent}
                </CodeBlock>
              );
            },
            p({ children }) {
              return <p className="mb-3 last:mb-0 leading-relaxed text-[#e8e4dd]">{children}</p>;
            },
            ul({ children }) {
              return <ul className="mb-3 pl-4 space-y-1 list-disc">{children}</ul>;
            },
            ol({ children }) {
              return <ol className="mb-3 pl-4 space-y-1 list-decimal">{children}</ol>;
            },
            li({ children }) {
              return <li className="leading-relaxed text-[#e8e4dd]">{children}</li>;
            },
            h1({ children }) {
              return <h1 className="text-xl font-semibold mb-3 mt-4 first:mt-0 text-[#e8e4dd]">{children}</h1>;
            },
            h2({ children }) {
              return <h2 className="text-lg font-semibold mb-2 mt-4 first:mt-0 text-[#e8e4dd]">{children}</h2>;
            },
            h3({ children }) {
              return <h3 className="text-base font-semibold mb-2 mt-3 first:mt-0 text-[#e8e4dd]">{children}</h3>;
            },
            blockquote({ children }) {
              return (
                <blockquote className="border-l-2 border-[var(--border)] pl-4 my-3 text-[#c8c4bd] italic">
                  {children}
                </blockquote>
              );
            },
            hr() {
              return <hr className="my-4 border-[var(--border)]" />;
            },
            a({ href, children }) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--success)] hover:underline"
                >
                  {children}
                </a>
              );
            },
            table({ children }) {
              return (
                <div className="my-3 overflow-x-auto">
                  <table className="min-w-full border border-[var(--border)] rounded-lg overflow-hidden">
                    {children}
                  </table>
                </div>
              );
            },
            thead({ children }) {
              return <thead className="bg-[var(--accent)]">{children}</thead>;
            },
            th({ children }) {
              return (
                <th className="px-4 py-2 text-left text-xs font-medium text-[#d8d4cd] uppercase tracking-wider border-b border-[var(--border)]">
                  {children}
                </th>
              );
            },
            td({ children }) {
              return (
                <td className="px-4 py-2 text-sm border-b border-[var(--border)]">
                  {children}
                </td>
              );
            },
            img({ src, alt }) {
              return (
                <img
                  src={src}
                  alt={alt || ''}
                  className="max-w-full rounded-lg my-3"
                />
              );
            },
          }}
        >
          {mainContent}
        </ReactMarkdown>
        </div>
      )}

      {/* Render explicit artifacts */}
      {artifacts.length > 0 && artifactsEnabled && (
        <div className="mt-3 space-y-3">
          {artifacts.map((artifact) => (
            <ArtifactRenderer
              key={artifact.id}
              artifact={artifact}
            />
          ))}
        </div>
      )}

      {/* Streaming indicators */}
      {!mainContent && !thinkingContent && isStreaming && (
        <div className="flex items-center gap-2">
          <TypingIndicator size="md" />
        </div>
      )}

      {mainContent && isStreaming && (
        <StreamingCursor />
      )}
    </div>
  );
}
