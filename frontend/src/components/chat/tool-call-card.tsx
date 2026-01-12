'use client';

import { useState } from 'react';
import {
  ChevronRight,
  Loader2,
  CheckCircle,
  XCircle,
  Globe,
  Clock,
  Search,
  Maximize2,
  X,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import type { ToolCall, ToolResult } from '@/lib/types';

interface ToolCallCardProps {
  toolCall: ToolCall;
  result?: ToolResult;
  isExecuting?: boolean;
  compact?: boolean;
}

interface ToolResultModalProps {
  toolName: string;
  result: ToolResult;
  onClose: () => void;
}

function ToolResultModal({ toolName, result, onClose }: ToolResultModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/70" onClick={onClose} />
      <div className="fixed inset-0 md:inset-12 z-[101] bg-[#1e1e1e] md:rounded-lg flex flex-col overflow-hidden border border-[#363432] max-w-full">
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-[#363432] bg-[#1e1e1e]">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="font-medium text-sm text-[#f0ebe3] truncate">{toolName}</span>
            <span className="text-xs text-[#9a9088] flex-shrink-0">
              {result.content.length.toLocaleString()} chars
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={handleCopy}
              className="p-2 rounded hover:bg-[#363432] transition-colors touch-manipulation"
              title="Copy"
              aria-label="Copy"
            >
              {copied ? (
                <Check className="h-5 w-5 text-[#7d9a6a]" />
              ) : (
                <Copy className="h-5 w-5 text-[#9a9088]" />
              )}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded hover:bg-[#363432] transition-colors touch-manipulation"
              title="Close"
              aria-label="Close"
            >
              <X className="h-5 w-5 text-[#9a9088]" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <pre className={`text-sm font-mono whitespace-pre-wrap break-words leading-relaxed ${
            result.isError ? 'text-[#c97a6b]' : 'text-[#f0ebe3]'
          }`}>
            {result.content}
          </pre>
        </div>
      </div>
    </>
  );
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  'brave_web_search': <Globe className="h-3 w-3" />,
  'brave_local_search': <Search className="h-3 w-3" />,
  'search': <Search className="h-3 w-3" />,
  'fetch': <ExternalLink className="h-3 w-3" />,
  'get_current_time': <Clock className="h-3 w-3" />,
  'getContents': <ExternalLink className="h-3 w-3" />,
  'findSimilar': <Search className="h-3 w-3" />,
};

export function ToolCallCard({ toolCall, result, isExecuting, compact = false }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Parse server__toolname format
  const fullName = toolCall.function.name;
  const [serverName, ...nameParts] = fullName.split('__');
  const toolName = nameParts.length > 0 ? nameParts.join('__') : fullName;
  const displayServer = toolCall.server || (nameParts.length > 0 ? serverName : null);

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    args = { raw: toolCall.function.arguments };
  }

  // Get a preview of the main argument (usually query or url)
  const mainArg = args.query || args.url || args.text || Object.values(args)[0];
  const argPreview = typeof mainArg === 'string' ? mainArg.slice(0, 60) : JSON.stringify(mainArg)?.slice(0, 60);

  const icon = TOOL_ICONS[toolName] || <Globe className="h-3 w-3" />;
  const hasResult = result !== undefined;
  const isError = result?.isError;

  // Truncate result for inline display
  const resultContent = result?.content || '';
  const isLongResult = resultContent.length > 300;

  // Extract meaningful preview from result
  const getResultPreview = () => {
    if (!resultContent) return '';
    // Try to get first meaningful line
    const lines = resultContent.split('\n').filter(l => l.trim());
    const preview = lines[0] || '';
    return preview.length > 100 ? preview.slice(0, 100) + '...' : preview;
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[#9a9088]">
        {isExecuting ? (
          <Loader2 className="h-3 w-3 animate-spin text-[#c9a66b]" />
        ) : hasResult ? (
          isError ? <XCircle className="h-3 w-3 text-[#c97a6b]" /> : <CheckCircle className="h-3 w-3 text-[#7d9a6a]" />
        ) : (
          icon
        )}
        <span className="font-medium">{toolName}</span>
        {argPreview && <span className="text-[#9a9088]/60 truncate max-w-[200px]">{argPreview}</span>}
      </div>
    );
  }

  return (
    <>
      {showModal && result && (
        <ToolResultModal
          toolName={toolName}
          result={result}
          onClose={() => setShowModal(false)}
        />
      )}

      <div className="group">
        {/* Minimal header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-[11px] text-[#9a9088] hover:text-[#c9a66b] transition-colors w-full text-left"
        >
          <span className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
            <ChevronRight className="h-3 w-3" />
          </span>

          {isExecuting ? (
            <Loader2 className="h-3 w-3 animate-spin text-[#c9a66b]" />
          ) : hasResult ? (
            isError ? <XCircle className="h-3 w-3 text-[#c97a6b]" /> : <CheckCircle className="h-3 w-3 text-[#7d9a6a]" />
          ) : (
            <span className="text-[#9a9088]">{icon}</span>
          )}

          <span className="font-medium">{toolName}</span>
          {displayServer && <span className="text-[#9a9088]/50">via {displayServer}</span>}

          {!isExpanded && argPreview && (
            <span className="text-[#9a9088]/60 truncate flex-1">{argPreview}</span>
          )}
        </button>

        {/* Expanded content */}
        {isExpanded && (
          <div className="mt-2 pl-5 border-l-2 border-[#363432] space-y-2">
            {/* Arguments */}
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[#9a9088]/50">args</span>
              <pre className="mt-1 text-xs text-[#9a9088] font-mono overflow-x-auto">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>

            {/* Result */}
            {hasResult && (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-[#9a9088]/50">
                    result {isLongResult && `(${resultContent.length.toLocaleString()} chars)`}
                  </span>
                  {isLongResult && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowModal(true); }}
                      className="flex items-center gap-1 text-[10px] text-[#9a9088] hover:text-[#c9a66b]"
                    >
                      <Maximize2 className="h-3 w-3" />
                      expand
                    </button>
                  )}
                </div>
                <pre className={`mt-1 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto ${
                  isError ? 'text-[#c97a6b]' : 'text-[#9a9088]'
                }`}>
                  {isLongResult ? resultContent.slice(0, 300) + '...' : resultContent}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Collapsed result preview */}
        {!isExpanded && hasResult && !isError && resultContent && (
          <div className="mt-1 pl-5 text-[11px] text-[#9a9088]/60 truncate">
            {getResultPreview()}
          </div>
        )}

        {/* Collapsed error preview */}
        {!isExpanded && hasResult && isError && (
          <div className="mt-1 pl-5 text-[11px] text-[#c97a6b]/80 truncate">
            {resultContent.slice(0, 80)}
          </div>
        )}
      </div>
    </>
  );
}

// Component for displaying multiple tool calls in a compact list
interface ToolCallsDisplayProps {
  toolCalls: ToolCall[];
  toolResults: Map<string, ToolResult>;
  executingTools: Set<string>;
}

export function ToolCallsDisplay({ toolCalls, toolResults, executingTools }: ToolCallsDisplayProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {toolCalls.map((toolCall) => (
        <ToolCallCard
          key={toolCall.id}
          toolCall={toolCall}
          result={toolResults.get(toolCall.id)}
          isExecuting={executingTools.has(toolCall.id)}
        />
      ))}
    </div>
  );
}
