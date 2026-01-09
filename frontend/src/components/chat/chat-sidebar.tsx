'use client';

import { useState, useEffect } from 'react';
import {
  MessageSquare,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import type { ChatSession } from '@/lib/types';

interface ChatSidebarProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isLoading?: boolean;
  isMobile?: boolean;
}

export function ChatSidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  isCollapsed,
  onToggleCollapse,
  isLoading,
  isMobile = false,
}: ChatSidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // On mobile, if collapsed, don't render anything (toggle button is in header)
  if (isCollapsed && isMobile) {
    return null;
  }

  // Desktop collapsed state
  if (isCollapsed && !isMobile) {
    return (
      <div className="fixed left-0 top-12 md:top-14 bottom-0 w-8 border-r border-[var(--border)] bg-[var(--background)] flex flex-col items-center py-2 gap-0.5 z-30">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded hover:bg-[var(--accent)] transition-colors"
          title="Expand"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => {
            onNewSession();
          }}
          className="p-1.5 rounded hover:bg-[var(--accent)] transition-colors"
          title="New chat"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Mobile overlay
  if (isMobile) {
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/60 z-40 animate-fade-in"
          onClick={onToggleCollapse}
        />
        {/* Sidebar */}
        <div className="fixed left-0 top-0 bottom-0 w-72 bg-[var(--card)] border-r border-[var(--border)] flex flex-col z-50 animate-slide-in-left">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top,0))] border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[#9a9590]" />
              <span className="font-medium">Conversations</span>
            </div>
            <button
              onClick={onToggleCollapse}
              className="p-2 rounded-lg hover:bg-[var(--accent)] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* New Chat Button */}
          <div className="px-3 py-3">
            <button
              onClick={() => {
                onNewSession();
                onToggleCollapse();
              }}
              className="w-full flex items-center justify-center gap-2 text-sm bg-[var(--foreground)] text-[var(--background)] px-4 py-2.5 rounded-lg hover:opacity-90 transition-opacity font-medium"
            >
              <Plus className="h-4 w-4" />
              <span>New Chat</span>
            </button>
          </div>

          {/* Sessions */}
          <div className="flex-1 overflow-y-auto px-2 pb-[env(safe-area-inset-bottom,1rem)]">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[var(--muted)] animate-pulse-soft" />
                  <span className="w-2 h-2 rounded-full bg-[var(--muted)] animate-pulse-soft" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-[var(--muted)] animate-pulse-soft" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-12">
                <MessageSquare className="h-8 w-8 text-[#9a9590] mx-auto mb-3 opacity-50" />
                <p className="text-sm text-[#9a9590]">No conversations yet</p>
                <p className="text-xs text-[#9a9590] mt-1">Start a new chat to begin</p>
              </div>
            ) : (
              <div className="space-y-1">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`group relative rounded-lg transition-colors ${
                      currentSessionId === session.id
                        ? 'bg-[var(--accent)]'
                        : 'hover:bg-[var(--card-hover)]'
                    }`}
                  >
                    <button
                      onClick={() => {
                        onSelectSession(session.id);
                        onToggleCollapse();
                      }}
                      className="w-full px-3 py-2.5 text-left"
                    >
                      <span className="text-sm font-medium truncate block">{session.title}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        {session.model && (
                          <span className="text-xs text-[#9a9590] font-mono truncate">
                            {session.parent_id ? '↳ ' : ''}{session.model.split('/').pop()}
                          </span>
                        )}
                        <span className="text-xs text-[#9a9590]">
                          {new Date(session.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg hover:bg-[var(--error)]/20 text-[#9a9590] hover:text-[var(--error)] transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // Desktop expanded state
  return (
    <div className="fixed left-0 top-12 md:top-14 bottom-0 w-56 border-r border-[var(--border)] bg-[var(--background)] flex flex-col z-30">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--border)]">
        <button
          onClick={() => {
            onNewSession();
          }}
          className="flex items-center gap-1 text-xs hover:text-[var(--foreground)] hover:bg-[var(--accent)] px-2 py-1 rounded transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New</span>
        </button>
        <button
          onClick={onToggleCollapse}
          className="p-0.5 rounded hover:bg-[var(--accent)] transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Sessions */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <div className="flex gap-1">
              <span className="w-1 h-1 rounded-full bg-[var(--muted)] animate-pulse" />
              <span className="w-1 h-1 rounded-full bg-[var(--muted)] animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 rounded-full bg-[var(--muted)] animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-4 text-xs text-[#9a9590]">
            No chats
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              onMouseEnter={() => setHoveredId(session.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`group relative mx-1 mb-0.5 rounded cursor-pointer ${
                currentSessionId === session.id
                  ? 'bg-[var(--accent)]'
                  : 'hover:bg-[var(--accent)]/50'
              }`}
            >
              <button
                onClick={() => onSelectSession(session.id)}
                className="w-full px-2 py-1 text-left"
              >
                <span className="text-xs truncate block">{session.title}</span>
                {session.model && (
                  <span className="text-[10px] text-[#9a9590] font-mono truncate block">
                    {session.parent_id ? '↳ ' : ''}{session.model}
                  </span>
                )}
              </button>

              {hoveredId === session.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[var(--error)]/20 text-[#9a9590] hover:text-[var(--error)] transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
