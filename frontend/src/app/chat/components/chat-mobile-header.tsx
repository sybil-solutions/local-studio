'use client';

import Link from 'next/link';
import { Layers, ChevronDown, Plus, Search, Menu } from 'lucide-react';
import { ThemeToggle } from '@/components/chat/theme-toggle';
import type { ChatSession } from '@/lib/types';
import { useAppStore } from '@/store';

interface ChatMobileHeaderProps {
  currentSessionTitle: string;
  currentSessionId: string | null;
  sessions: ChatSession[];
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onOpenSidebar: () => void;
}

export function ChatMobileHeader({
  currentSessionTitle,
  currentSessionId,
  sessions,
  onSelectSession,
  onNewSession,
  onOpenSidebar,
}: ChatMobileHeaderProps) {
  const recentChatsOpen = useAppStore((state) => state.recentChatsOpen);
  const setRecentChatsOpen = useAppStore((state) => state.setRecentChatsOpen);
  const chatSearchQuery = useAppStore((state) => state.chatSearchQuery);
  const setChatSearchQuery = useAppStore((state) => state.setChatSearchQuery);

  const filteredSessions = chatSearchQuery
    ? sessions.filter((s) => s.title.toLowerCase().includes(chatSearchQuery.toLowerCase()))
    : sessions;

  return (
    <div
      className="relative z-40 bg-[var(--card)] border-b border-[var(--border)] flex-shrink-0"
      style={{ paddingTop: 'env(safe-area-inset-top, 0)' }}
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 w-full">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {/* Logo */}
          <Link
            href="/"
            className="p-1.5 -ml-1 rounded-lg hover:bg-[var(--accent)] transition-colors flex-shrink-0"
          >
            <Layers className="h-5 w-5 text-[#9a9590]" />
          </Link>

          {/* Recent Chats Dropdown */}
          <div className="relative flex-1 min-w-0">
            <button
              onClick={() => setRecentChatsOpen(!recentChatsOpen)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-[var(--accent)] transition-colors w-full min-w-0"
            >
              <span className="text-sm font-medium truncate">{currentSessionTitle || 'New Chat'}</span>
              <ChevronDown
                className={`h-4 w-4 text-[#9a9590] flex-shrink-0 transition-transform ${recentChatsOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Dropdown */}
            {recentChatsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setRecentChatsOpen(false)} />
                <div className="absolute left-0 right-0 top-full mt-1 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-lg z-50 max-h-[60vh] overflow-hidden flex flex-col">
                  {/* Search */}
                  <div className="p-2 border-b border-[var(--border)]">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9a9590]" />
                      <input
                        type="text"
                        value={chatSearchQuery}
                        onChange={(e) => setChatSearchQuery(e.target.value)}
                        placeholder="Search chats..."
                        className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* New Chat Button */}
                  <button
                    onClick={() => {
                      onNewSession();
                      setRecentChatsOpen(false);
                    }}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--accent)] transition-colors text-sm font-medium border-b border-[var(--border)]"
                  >
                    <Plus className="h-4 w-4" />
                    New Chat
                  </button>

                  {/* Recent Chats */}
                  <div className="overflow-y-auto flex-1">
                    {filteredSessions.slice(0, chatSearchQuery ? 20 : 5).map((session) => (
                      <button
                        key={session.id}
                        onClick={() => {
                          onSelectSession(session.id);
                          setRecentChatsOpen(false);
                          setChatSearchQuery('');
                        }}
                        className={`w-full px-3 py-2 text-left hover:bg-[var(--accent)] transition-colors ${
                          currentSessionId === session.id ? 'bg-[var(--accent)]' : ''
                        }`}
                      >
                        <div className="text-sm truncate">{session.title}</div>
                        <div className="text-xs text-[#9a9590] truncate">
                          {session.model?.split('/').pop()} • {new Date(session.updated_at).toLocaleDateString()}
                        </div>
                      </button>
                    ))}
                    {filteredSessions.length === 0 && (
                      <div className="px-3 py-4 text-sm text-[#9a9590] text-center">No chats found</div>
                    )}
                    {!chatSearchQuery && sessions.length > 5 && (
                      <button
                        onClick={() => {
                          onOpenSidebar();
                          setRecentChatsOpen(false);
                        }}
                        className="w-full px-3 py-2 text-sm text-[#9a9590] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
                      >
                        View all {sessions.length} chats →
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <ThemeToggle />
          <button
            onClick={onOpenSidebar}
            className="p-1.5 rounded hover:bg-[var(--accent)] transition-colors"
            title="Open sidebar"
          >
            <Menu className="h-5 w-5 text-[#9a9590]" />
          </button>
        </div>
      </div>
    </div>
  );
}
