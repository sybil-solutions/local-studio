// CRITICAL
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import type { ChatSession } from "@/lib/types";

export function ChatSessionsSection({
  sessions,
  open,
  setOpen,
  isMobile,
  onCloseMobile,
  onNewChat,
}: {
  sessions: ChatSession[];
  open: boolean;
  setOpen: (next: boolean) => void;
  isMobile: boolean;
  onCloseMobile: () => void;
  onNewChat: () => void;
}) {
  const [query, setQuery] = useState("");

  const sessionRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions
      .map((session) => {
        let displayTitle = session.title;
        if (!displayTitle || displayTitle === "New Chat") {
          if (session.first_user_message) {
            const words = session.first_user_message.trim().split(/\s+/).slice(0, 5);
            displayTitle = words.join(" ") + (words.length >= 5 ? "..." : "");
          } else {
            displayTitle = "New Chat";
          }
        }
        return { session, displayTitle };
      })
      .filter((row) => (q ? row.displayTitle.toLowerCase().includes(q) : true));
  }, [query, sessions]);

  if (sessions.length === 0) {
    return (
      <div className="ml-2 mt-2 mb-2">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-(--dim) hover:text-(--fg) hover:bg-(--surface) rounded-md transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Chat</span>
        </button>
      </div>
    );
  }

  return (
    <div className="ml-2 mt-2 mb-2">
      <button
        onClick={onNewChat}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-(--dim) hover:text-(--fg) hover:bg-(--surface) rounded-md transition-colors mb-1.5"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>New Chat</span>
      </button>

      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-(--dim) hover:text-(--fg) rounded-md hover:bg-(--surface) text-xs font-medium transition-colors"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
        <span>Your chats</span>
      </button>

      {open && (
        <div className="ml-4 pr-1">
          <div className="mb-1.5">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats..."
              className="w-full h-7 px-2 text-xs rounded-md border border-(--border) bg-(--surface)/40 text-(--fg) placeholder:text-(--dim) focus:outline-none focus:ring-1 focus:ring-(--hl1)/40"
            />
          </div>
          <div className="space-y-0.5 max-h-52 overflow-y-auto scrollbar-thin">
            {sessionRows.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-(--dim)">No matching chats</div>
            )}
            {sessionRows.map(({ session, displayTitle }) => (
              <Link
                key={session.id}
                href={`/chat?session=${session.id}`}
                onClick={() => {
                  if (isMobile) onCloseMobile();
                }}
                className="block px-3 py-1.5 text-xs text-(--dim) hover:text-(--fg) hover:bg-(--surface) rounded transition-colors truncate"
                title={displayTitle}
              >
                {displayTitle}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
