'use client';

import { Copy, Check, GitBranch, Sparkles } from 'lucide-react';
import { MessageRenderer } from '@/components/chat';
import { ToolCallCard } from '@/components/chat/tool-call-card';
import type { ToolResult, ToolCall } from '@/lib/types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  isStreaming?: boolean;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  model?: string;
  total_tokens?: number;
  request_total_input_tokens?: number | null;
  request_completion_tokens?: number | null;
}

interface ChatMessageListProps {
  messages: ChatMessage[];
  selectedModel?: string;
  modelName?: string;
  currentSessionId: string | null;
  artifactsEnabled: boolean;
  isMobile: boolean;
  isLoading: boolean;
  error: string | null;
  copiedIndex: number | null;
  toolResultsMap: Map<string, ToolResult>;
  executingTools: Set<string>;
  onCopy: (text: string, index: number) => void;
  onFork: (messageId: string) => void;
}

export function ChatMessageList({
  messages,
  selectedModel,
  modelName,
  currentSessionId,
  artifactsEnabled,
  isMobile,
  isLoading,
  error,
  copiedIndex,
  toolResultsMap,
  executingTools,
  onCopy,
  onFork,
}: ChatMessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center px-4 py-8">
          <h2 className="text-base font-medium mb-2">Start a conversation</h2>
          <p className="text-sm text-[#9a9590] max-w-xs mx-auto">
            {selectedModel ? 'Send a message to begin chatting.' : 'Select a model in Settings to get started.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 md:px-6 space-y-6">
      {messages.map((message, index) => (
        <div key={message.id} id={`message-${message.id}`} className="animate-message-appear">
          {message.role === 'user' ? (
            <UserMessage
              message={message}
              index={index}
              copiedIndex={copiedIndex}
              onCopy={onCopy}
            />
          ) : (
            <AssistantMessage
              message={message}
              index={index}
              selectedModel={selectedModel}
              modelName={modelName}
              currentSessionId={currentSessionId}
              artifactsEnabled={artifactsEnabled}
              isMobile={isMobile}
              copiedIndex={copiedIndex}
              toolResultsMap={toolResultsMap}
              executingTools={executingTools}
              onCopy={onCopy}
              onFork={onFork}
            />
          )}
        </div>
      ))}

      {/* Loading indicator */}
      {isLoading && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content && (
        <div className="flex gap-3">
          <div className="w-6 h-6 rounded-full bg-[#7d9a6a]/20 flex items-center justify-center">
            <Sparkles className="h-3 w-3 text-[#7d9a6a] animate-pulse" />
          </div>
          <div className="flex items-center pt-1.5">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#8b7355] animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#8b7355] animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[#8b7355] animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="px-3 py-2 bg-[#c97a6b]/10 border border-[#c97a6b]/20 rounded-lg text-xs text-[#c97a6b]">
          {error}
        </div>
      )}
    </div>
  );
}

// User Message Component
interface UserMessageProps {
  message: ChatMessage;
  index: number;
  copiedIndex: number | null;
  onCopy: (text: string, index: number) => void;
}

function UserMessage({ message, index, copiedIndex, onCopy }: UserMessageProps) {
  return (
    <div className="group">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium text-[#8a8580]">You</span>
        <button
          onClick={() => onCopy(message.content, index)}
          className="p-1 rounded hover:bg-[#363432] opacity-0 group-hover:opacity-100"
        >
          {copiedIndex === index ? (
            <Check className="h-3 w-3 text-[#7d9a6a]" />
          ) : (
            <Copy className="h-3 w-3 text-[#6a6560]" />
          )}
        </button>
      </div>
      {message.images && message.images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {message.images.map((base64, i) => (
            <img
              key={i}
              src={`data:image/jpeg;base64,${base64}`}
              alt=""
              className="max-w-[140px] max-h-[140px] rounded-xl border border-[#363432]"
            />
          ))}
        </div>
      )}
      <p className="text-[15px] text-[#e8e4dd] whitespace-pre-wrap break-words">{message.content}</p>
    </div>
  );
}

// Assistant Message Component
interface AssistantMessageProps {
  message: ChatMessage;
  index: number;
  selectedModel?: string;
  modelName?: string;
  currentSessionId: string | null;
  artifactsEnabled: boolean;
  isMobile: boolean;
  copiedIndex: number | null;
  toolResultsMap: Map<string, ToolResult>;
  executingTools: Set<string>;
  onCopy: (text: string, index: number) => void;
  onFork: (messageId: string) => void;
}

function AssistantMessage({
  message,
  index,
  selectedModel,
  modelName,
  currentSessionId,
  artifactsEnabled,
  isMobile,
  copiedIndex,
  toolResultsMap,
  executingTools,
  onCopy,
  onFork,
}: AssistantMessageProps) {
  const totalTokens = (message.request_total_input_tokens || 0) + (message.request_completion_tokens || 0) || message.total_tokens || 0;

  return (
    <div className="group">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium text-[#9a8570]">
          {message.model?.split('/').pop() || selectedModel?.split('/').pop() || modelName || 'Assistant'}
        </span>
        {totalTokens > 0 && (
          <span className="text-[10px] text-[#6a6560] font-mono">
            {totalTokens.toLocaleString()} tok
          </span>
        )}
        {currentSessionId && (
          <button
            onClick={() => onFork(message.id)}
            className="p-1 rounded hover:bg-[#363432] opacity-0 group-hover:opacity-100"
            title="Fork"
          >
            <GitBranch className="h-3 w-3 text-[#6a6560]" />
          </button>
        )}
        <button
          onClick={() => onCopy(message.content, index)}
          className="p-1 rounded hover:bg-[#363432] opacity-0 group-hover:opacity-100"
        >
          {copiedIndex === index ? (
            <Check className="h-3 w-3 text-[#7d9a6a]" />
          ) : (
            <Copy className="h-3 w-3 text-[#6a6560]" />
          )}
        </button>
      </div>
      <div className="text-[15px] text-[#e8e4dd] overflow-hidden break-words">
        <MessageRenderer
          content={message.content}
          isStreaming={message.isStreaming}
          artifactsEnabled={artifactsEnabled}
          messageId={message.id}
          showActions={true}
        />
        {isMobile && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.toolCalls.map((tc) => (
              <ToolCallCard
                key={tc.id}
                toolCall={tc}
                result={toolResultsMap.get(tc.id)}
                isExecuting={executingTools.has(tc.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
