// CRITICAL
"use client";

import { memo, useCallback, useState, type ReactNode, type RefObject } from "react";
import type { AgentFileEntry, Artifact, ChatMessage } from "@/lib/types";
import { ChatMessageList } from "../../messages/chat-message-list";

interface ChatConversationProps {
  messages: ChatMessage[];
  isLoading: boolean;
  artifactsEnabled?: boolean;
  artifactsByMessage?: Map<string, Artifact[]>;
  selectedModel?: string;
  contextUsageLabel?: string | null;
  agentFiles?: AgentFileEntry[];
  selectedAgentFilePath?: string | null;
  onOpenAgentFile?: (path: string) => void;
  onFork?: (messageId: string) => void;
  onReprompt?: (messageId: string) => void;
  onListen?: (messageId: string) => void;
  listeningMessageId?: string | null;
  listeningPending?: boolean;
  onOpenContext?: () => void;
  showEmptyState: boolean;
  toolBelt: ReactNode;
  onScroll: () => void;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
}

function ChatConversationBase({
  messages,
  isLoading,
  artifactsEnabled,
  artifactsByMessage,
  selectedModel,
  contextUsageLabel,
  agentFiles,
  selectedAgentFilePath,
  onOpenAgentFile,
  onFork,
  onReprompt,
  onListen,
  listeningMessageId,
  listeningPending,
  onOpenContext,
  showEmptyState,
  toolBelt,
  onScroll,
  messagesContainerRef,
  messagesEndRef,
}: ChatConversationProps) {
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null);

  const handleScrollContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      messagesContainerRef.current = node;
      setScrollParent(node);
    },
    [messagesContainerRef],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
      <div
        ref={handleScrollContainerRef}
        onScroll={onScroll}
        className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col chat-scroll-pad"
      >
        <div className="md:pb-4 flex-1 flex flex-col">
          <div className="flex-1 relative overflow-hidden flex items-center justify-center px-4 md:px-6 py-10 transition-opacity duration-500 ease-out bg-background">
            {showEmptyState ? (
              <div className="relative z-10 w-full max-w-2xl">
                <div className="hidden md:block">{toolBelt}</div>
              </div>
            ) : (
              <div className="relative z-10 flex flex-col min-h-0 w-full">
                <ChatMessageList
                  messages={messages}
                  isLoading={isLoading}
                  artifactsEnabled={artifactsEnabled}
                  artifactsByMessage={artifactsByMessage}
                  selectedModel={selectedModel}
                  contextUsageLabel={contextUsageLabel}
                  agentFiles={agentFiles}
                  selectedAgentFilePath={selectedAgentFilePath}
                  onOpenAgentFile={onOpenAgentFile}
                  scrollParent={scrollParent}
                  messagesEndRef={messagesEndRef}
                  onFork={onFork}
                  onReprompt={onReprompt}
                  onListen={onListen}
                  listeningMessageId={listeningMessageId}
                  listeningPending={listeningPending}
                  onOpenContext={onOpenContext}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function areChatConversationPropsEqual(
  prev: ChatConversationProps,
  next: ChatConversationProps,
): boolean {
  if (prev.showEmptyState || next.showEmptyState) {
    return (
      prev.messages === next.messages &&
      prev.isLoading === next.isLoading &&
      prev.artifactsEnabled === next.artifactsEnabled &&
      prev.artifactsByMessage === next.artifactsByMessage &&
      prev.selectedModel === next.selectedModel &&
      prev.contextUsageLabel === next.contextUsageLabel &&
      prev.agentFiles === next.agentFiles &&
      prev.selectedAgentFilePath === next.selectedAgentFilePath &&
      prev.onOpenAgentFile === next.onOpenAgentFile &&
      prev.onFork === next.onFork &&
      prev.onReprompt === next.onReprompt &&
      prev.onListen === next.onListen &&
      prev.listeningMessageId === next.listeningMessageId &&
      prev.listeningPending === next.listeningPending &&
      prev.onOpenContext === next.onOpenContext &&
      prev.showEmptyState === next.showEmptyState &&
      prev.toolBelt === next.toolBelt &&
      prev.onScroll === next.onScroll &&
      prev.messagesContainerRef === next.messagesContainerRef &&
      prev.messagesEndRef === next.messagesEndRef
    );
  }

  return (
    prev.messages === next.messages &&
    prev.isLoading === next.isLoading &&
    prev.artifactsEnabled === next.artifactsEnabled &&
    prev.artifactsByMessage === next.artifactsByMessage &&
    prev.selectedModel === next.selectedModel &&
    prev.contextUsageLabel === next.contextUsageLabel &&
    prev.agentFiles === next.agentFiles &&
    prev.selectedAgentFilePath === next.selectedAgentFilePath &&
    prev.onOpenAgentFile === next.onOpenAgentFile &&
    prev.onFork === next.onFork &&
    prev.onReprompt === next.onReprompt &&
    prev.onListen === next.onListen &&
    prev.listeningMessageId === next.listeningMessageId &&
    prev.listeningPending === next.listeningPending &&
    prev.onOpenContext === next.onOpenContext &&
    prev.showEmptyState === next.showEmptyState &&
    prev.onScroll === next.onScroll &&
    prev.messagesContainerRef === next.messagesContainerRef &&
    prev.messagesEndRef === next.messagesEndRef
  );
}

export const ChatConversation = memo(ChatConversationBase, areChatConversationPropsEqual);
