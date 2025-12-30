'use client';

import { useState } from 'react';
import {
  Wrench,
  ChevronDown,
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
} from 'lucide-react';
import type { ToolCall, ToolResult } from '@/lib/types';

interface ToolCallCardProps {
  toolCall: ToolCall;
  result?: ToolResult;
  isExecuting?: boolean;
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
      <div className="fixed inset-0 z-[100] bg-black/60" onClick={onClose} />
      <div className="fixed inset-2 md:inset-8 z-[101] bg-[var(--card)] rounded-lg flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 md:px-4 py-2 md:py-3 border-b border-[var(--border)] flex-shrink-0">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-blue-500" />
            <span className="font-medium text-sm">{toolName} Result</span>
            <span className="text-xs text-[var(--muted)]">
              {result.content.length.toLocaleString()} chars
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="p-2 rounded hover:bg-[var(--accent)] transition-colors"
              title="Copy"
            >
              {copied ? (
                <Check className="h-4 w-4 text-[var(--success)]" />
              ) : (
                <Copy className="h-4 w-4 text-[var(--muted)]" />
              )}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded hover:bg-[var(--accent)] transition-colors"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-3 md:p-4">
          <pre className={`text-xs md:text-sm whitespace-pre-wrap break-words ${
            result.isError ? 'text-[var(--error)]' : ''
          }`}>
            {result.content}
          </pre>
        </div>
      </div>
    </>
  );
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  'brave_web_search': <Globe className="h-3.5 w-3.5" />,
  'brave_local_search': <Search className="h-3.5 w-3.5" />,
  'fetch': <Globe className="h-3.5 w-3.5" />,
  'get_current_time': <Clock className="h-3.5 w-3.5" />,
};

export function ToolCallCard({ toolCall, result, isExecuting }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showResult, setShowResult] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Parse server__toolname format
  const fullName = toolCall.function.name;
  const [serverName, ...nameParts] = fullName.split('__');
  const toolName = nameParts.length > 0 ? nameParts.join('__') : fullName;
  const displayServer = toolCall.server || (nameParts.length > 0 ? serverName : 'unknown');

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    args = { raw: toolCall.function.arguments };
  }

  const icon = TOOL_ICONS[toolName] || <Wrench className="h-3.5 w-3.5" />;
  const hasResult = result !== undefined;
  const isError = result?.isError;

  // Truncate long results for display
  const resultContent = result?.content || '';
  const isLongResult = resultContent.length > 500;
  const truncatedResult = isLongResult ? resultContent.slice(0, 500) + '...' : resultContent;

  return (
    <>
      {/* Result Modal */}
      {showModal && result && (
        <ToolResultModal
          toolName={toolName}
          result={result}
          onClose={() => setShowModal(false)}
        />
      )}

      <div className={`my-1.5 md:my-2 rounded-md md:rounded-lg border overflow-hidden ${
        isError
          ? 'border-[var(--error)]/30 bg-[var(--error)]/5'
          : 'border-[var(--border)] bg-[var(--accent)]'
      }`}>
        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1.5 md:py-2 hover:bg-[var(--background)]/50 transition-colors"
        >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--muted)]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[var(--muted)]" />
        )}

        <div className={`p-1 rounded ${
          isError
            ? 'bg-[var(--error)]/20 text-[var(--error)]'
            : 'bg-blue-500/20 text-blue-500'
        }`}>
          {icon}
        </div>

        <div className="flex-1 text-left">
          <span className="text-sm font-medium">{toolName}</span>
          <span className="text-xs text-[var(--muted)] ml-2">via {displayServer}</span>
        </div>

        {isExecuting && (
          <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
        )}
        {hasResult && !isExecuting && (
          isError ? (
            <XCircle className="h-3.5 w-3.5 text-[var(--error)]" />
          ) : (
            <CheckCircle className="h-3.5 w-3.5 text-[var(--success)]" />
          )
        )}
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-[var(--border)]">
          {/* Arguments */}
          <div className="pt-2">
            <p className="text-xs text-[var(--muted)] mb-1">Arguments</p>
            <pre className="text-xs bg-[var(--background)] rounded p-2 overflow-x-auto">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>

          {/* Result */}
          {hasResult && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowResult(!showResult); }}
                  className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  {showResult ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Result {isLongResult && `(${resultContent.length.toLocaleString()} chars)`}
                </button>
                {isLongResult && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowModal(true); }}
                    className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)] px-1.5 py-0.5 rounded hover:bg-[var(--background)]"
                  >
                    <Maximize2 className="h-3 w-3" />
                    <span className="hidden md:inline">View Full</span>
                  </button>
                )}
              </div>
              {showResult && (
                <pre className={`text-xs rounded p-2 overflow-x-auto whitespace-pre-wrap ${
                  isError
                    ? 'bg-[var(--error)]/10 text-[var(--error)]'
                    : 'bg-[var(--background)]'
                }`}>
                  {truncatedResult}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Collapsed Result Preview */}
      {!isExpanded && hasResult && !isError && resultContent.length > 0 && (
        <div className="px-2 md:px-3 pb-1.5 md:pb-2">
          <p className="text-xs text-[var(--muted)] truncate">
            {resultContent.slice(0, 100)}
            {resultContent.length > 100 && '...'}
          </p>
        </div>
      )}

      {/* Collapsed Error Preview */}
      {!isExpanded && hasResult && isError && (
        <div className="px-2 md:px-3 pb-1.5 md:pb-2">
          <p className="text-xs text-[var(--error)] truncate">
            Error: {resultContent.slice(0, 80)}
            {resultContent.length > 80 && '...'}
          </p>
        </div>
      )}
      </div>
    </>
  );
}

// Component for displaying multiple tool calls
interface ToolCallsDisplayProps {
  toolCalls: ToolCall[];
  toolResults: Map<string, ToolResult>;
  executingTools: Set<string>;
}

export function ToolCallsDisplay({ toolCalls, toolResults, executingTools }: ToolCallsDisplayProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className="space-y-1">
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
