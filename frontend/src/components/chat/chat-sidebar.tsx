'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageSquare,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Search,
  Sparkles,
  LayoutDashboard,
  Settings,
  FileText,
  BarChart3,
  Layers,
} from 'lucide-react';
import type { ChatSession } from '@/lib/types';

// Navigation items
const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/recipes', label: 'Recipes', icon: Settings },
  { href: '/logs', label: 'Logs', icon: FileText },
  { href: '/usage', label: 'Usage', icon: BarChart3 },
  { href: '/configs', label: 'Configs', icon: Settings },
];

// Empty state illustration - warm, friendly chat bubbles
function EmptyStateIllustration({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <ellipse cx="60" cy="85" rx="40" ry="8" fill="currentColor" opacity="0.05" />
      <rect x="20" y="20" width="60" height="45" rx="8" fill="currentColor" opacity="0.1" />
      <rect x="20" y="20" width="60" height="45" rx="8" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
      <path d="M35 65 L30 75 L45 65" fill="currentColor" opacity="0.1" />
      <path d="M35 65 L30 75 L45 65" stroke="currentColor" strokeWidth="1.5" opacity="0.2" strokeLinejoin="round" />
      <rect x="28" y="30" width="35" height="3" rx="1.5" fill="currentColor" opacity="0.15" />
      <rect x="28" y="38" width="44" height="3" rx="1.5" fill="currentColor" opacity="0.12" />
      <rect x="28" y="46" width="28" height="3" rx="1.5" fill="currentColor" opacity="0.1" />
      <rect x="50" y="40" width="50" height="35" rx="6" fill="currentColor" opacity="0.08" />
      <rect x="50" y="40" width="50" height="35" rx="6" stroke="currentColor" strokeWidth="1.5" opacity="0.15" />
      <path d="M85 75 L92 82 L78 75" fill="currentColor" opacity="0.08" />
      <rect x="58" y="50" width="30" height="2.5" rx="1.25" fill="currentColor" opacity="0.12" />
      <rect x="58" y="57" width="35" height="2.5" rx="1.25" fill="currentColor" opacity="0.1" />
      <rect x="58" y="64" width="22" height="2.5" rx="1.25" fill="currentColor" opacity="0.08" />
      <circle cx="95" cy="25" r="2" fill="currentColor" opacity="0.2" />
      <circle cx="15" cy="45" r="1.5" fill="currentColor" opacity="0.15" />
      <circle cx="105" cy="55" r="1.5" fill="currentColor" opacity="0.15" />
    </svg>
  );
}

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

const CHATS_PER_PAGE = 15;

// Group sessions by date
function groupSessionsByDate(sessions: ChatSession[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const groups: { label: string; sessions: ChatSession[] }[] = [
    { label: 'Today', sessions: [] },
    { label: 'Yesterday', sessions: [] },
    { label: 'Last 7 days', sessions: [] },
    { label: 'Older', sessions: [] },
  ];

  sessions.forEach((session) => {
    const date = new Date(session.updated_at);
    if (date >= today) {
      groups[0].sessions.push(session);
    } else if (date >= yesterday) {
      groups[1].sessions.push(session);
    } else if (date >= lastWeek) {
      groups[2].sessions.push(session);
    } else {
      groups[3].sessions.push(session);
    }
  });

  return groups.filter((g) => g.sessions.length > 0);
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
  const pathname = usePathname();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(CHATS_PER_PAGE);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.model?.toLowerCase().includes(q)
    );
  }, [sessions, searchQuery]);

  // Paginated sessions
  const paginatedSessions = useMemo(() => {
    return filteredSessions.slice(0, visibleCount);
  }, [filteredSessions, visibleCount]);

  const groupedSessions = useMemo(() => {
    return groupSessionsByDate(paginatedSessions);
  }, [paginatedSessions]);

  const hasMore = filteredSessions.length > visibleCount;

  const loadMore = () => {
    setVisibleCount((prev) => prev + CHATS_PER_PAGE);
  };

  // On mobile, if collapsed, don't render anything
  if (isCollapsed && isMobile) {
    return null;
  }

  // Desktop collapsed state - minimal rail with nav
  if (isCollapsed && !isMobile) {
    return (
      <div className="fixed left-0 top-0 bottom-0 w-12 border-r border-[var(--border)] bg-[var(--card)] flex flex-col items-center py-3 z-40">
        {/* Logo */}
        <Link
          href="/"
          className="p-2 rounded-lg hover:bg-[var(--accent)] transition-colors mb-2"
          title="vLLM Studio"
        >
          <Layers className="h-5 w-5 text-[var(--foreground)]" />
        </Link>

        <div className="w-7 h-px bg-[var(--border)] my-1" />

        {/* Nav items */}
        <div className="flex flex-col items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`p-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-[var(--accent)] text-[var(--foreground)]'
                    : 'text-[#9a9590] hover:text-[var(--foreground)] hover:bg-[var(--accent)]'
                }`}
                title={item.label}
              >
                <Icon className="h-4 w-4" />
              </Link>
            );
          })}
        </div>

        <div className="w-7 h-px bg-[var(--border)] my-2" />

        {/* Expand & New */}
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded-lg hover:bg-[var(--accent)] transition-colors"
          title="Expand sidebar"
        >
          <ChevronRight className="h-4 w-4 text-[#9a9590]" />
        </button>
        <button
          onClick={onNewSession}
          className="p-2 rounded-lg hover:bg-[var(--accent)] transition-colors"
          title="New chat"
        >
          <Plus className="h-4 w-4 text-[#9a9590]" />
        </button>

        {/* Mini session indicators */}
        <div className="flex-1 flex flex-col items-center gap-1 mt-2 overflow-hidden">
          {sessions.slice(0, 6).map((session) => (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-medium transition-colors ${
                currentSessionId === session.id
                  ? 'bg-[var(--accent)] text-[var(--foreground)]'
                  : 'hover:bg-[var(--accent)] text-[#9a9590]'
              }`}
              title={session.title}
            >
              {session.title.charAt(0).toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Mobile overlay
  if (isMobile) {
    return (
      <>
        <div
          className="fixed inset-0 bg-black/60 z-40 animate-fade-in"
          onClick={onToggleCollapse}
        />
        <div className="fixed left-0 top-0 bottom-0 w-80 bg-[var(--card)] border-r border-[var(--border)] flex flex-col z-50 animate-slide-in-left">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top,0))] border-b border-[var(--border)]">
            <div className="flex items-center gap-2.5">
              <Layers className="h-5 w-5 text-[var(--foreground)]" />
              <span className="font-semibold text-sm">vLLM Studio</span>
            </div>
            <button
              onClick={onToggleCollapse}
              className="p-2 rounded-lg hover:bg-[var(--accent)] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Navigation */}
          <div className="px-2 py-2 border-b border-[var(--border)]">
            <div className="space-y-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onToggleCollapse}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-[var(--accent)] text-[var(--foreground)]'
                        : 'text-[#9a9590] hover:text-[var(--foreground)] hover:bg-[var(--accent)]'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-[var(--border)]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9a9590]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--muted)]"
              />
            </div>
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
              <Sparkles className="h-4 w-4" />
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
              <div className="text-center py-12 px-4">
                <EmptyStateIllustration className="w-32 h-28 mx-auto mb-4 text-[var(--foreground)]" />
                <p className="text-sm font-medium mb-1">No conversations yet</p>
                <p className="text-xs text-[#9a9590]">Start a new chat to begin exploring</p>
              </div>
            ) : groupedSessions.length === 0 ? (
              <div className="text-center py-8">
                <Search className="h-8 w-8 text-[#9a9590] mx-auto mb-3 opacity-50" />
                <p className="text-sm text-[#9a9590]">No matches found</p>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedSessions.map((group) => (
                  <div key={group.label}>
                    <div className="px-2 py-1.5 text-[10px] font-medium text-[#9a9590] uppercase tracking-wider">
                      {group.label}
                    </div>
                    <div className="space-y-0.5">
                      {group.sessions.map((session) => (
                        <div
                          key={session.id}
                          className={`group relative rounded-lg transition-colors ${
                            currentSessionId === session.id
                              ? 'bg-[var(--accent)]'
                              : 'hover:bg-[var(--accent)]/50'
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
                                <span className="text-xs text-[#9a9590] font-mono truncate max-w-[120px]">
                                  {session.parent_id ? '↳ ' : ''}{session.model.split('/').pop()}
                                </span>
                              )}
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
                  </div>
                ))}

                {/* Load more */}
                {hasMore && (
                  <button
                    onClick={loadMore}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-[#9a9590] hover:text-[var(--foreground)] hover:bg-[var(--accent)] rounded-lg transition-colors"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    Load more ({filteredSessions.length - visibleCount} remaining)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // Desktop expanded state
  return (
    <div className="fixed left-0 top-0 bottom-0 w-60 border-r border-[var(--border)] bg-[var(--card)] flex flex-col z-40">
      {/* Header with logo */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--border)]">
        <Link href="/" className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-[var(--foreground)]" />
          <span className="font-semibold text-sm">vLLM Studio</span>
        </Link>
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg hover:bg-[var(--accent)] transition-colors"
          title="Collapse sidebar"
        >
          <ChevronLeft className="h-4 w-4 text-[#9a9590]" />
        </button>
      </div>

      {/* Navigation */}
      <div className="px-2 py-2 border-b border-[var(--border)]">
        <div className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--accent)] text-[var(--foreground)]'
                    : 'text-[#9a9590] hover:text-[var(--foreground)] hover:bg-[var(--accent)]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* New Chat + Search */}
      <div className="px-2 py-2 border-b border-[var(--border)] space-y-2">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-medium bg-[var(--foreground)] text-[var(--background)] px-3 py-2 rounded-lg hover:opacity-90 transition-opacity"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>New Chat</span>
        </button>

        {sessions.length > 5 && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9a9590]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats..."
              className="w-full pl-8 pr-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--muted)]"
            />
          </div>
        )}
      </div>

      {/* Sessions */}
      <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted)] animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted)] animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted)] animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-8 px-3">
            <EmptyStateIllustration className="w-24 h-20 mx-auto mb-3 text-[var(--foreground)]" />
            <p className="text-xs text-[#9a9590]">No chats yet</p>
          </div>
        ) : groupedSessions.length === 0 ? (
          <div className="text-center py-6 px-3">
            <p className="text-xs text-[#9a9590]">No matches</p>
          </div>
        ) : (
          <div className="space-y-3 px-2">
            {groupedSessions.map((group) => (
              <div key={group.label}>
                <div className="px-2 py-1 text-[9px] font-semibold text-[#9a9590] uppercase tracking-wider">
                  {group.label}
                </div>
                {group.sessions.map((session) => (
                  <div
                    key={session.id}
                    onMouseEnter={() => setHoveredId(session.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className={`group relative mb-0.5 rounded-lg cursor-pointer transition-colors ${
                      currentSessionId === session.id
                        ? 'bg-[var(--accent)]'
                        : 'hover:bg-[var(--accent)]/50'
                    }`}
                  >
                    <button
                      onClick={() => onSelectSession(session.id)}
                      className="w-full px-2.5 py-1.5 text-left"
                    >
                      <span className="text-xs font-medium truncate block leading-tight">
                        {session.title}
                      </span>
                      {session.model && (
                        <span className="text-[10px] text-[#9a9590] font-mono truncate block mt-0.5">
                          {session.parent_id ? '↳ ' : ''}{session.model.split('/').pop()}
                        </span>
                      )}
                    </button>

                    {hoveredId === session.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session.id);
                        }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--error)]/20 text-[#9a9590] hover:text-[var(--error)] transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {/* Load more */}
            {hasMore && (
              <button
                onClick={loadMore}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-2 text-[10px] text-[#9a9590] hover:text-[var(--foreground)] hover:bg-[var(--accent)] rounded-lg transition-colors"
              >
                <ChevronDown className="h-3 w-3" />
                Load more ({filteredSessions.length - visibleCount})
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
