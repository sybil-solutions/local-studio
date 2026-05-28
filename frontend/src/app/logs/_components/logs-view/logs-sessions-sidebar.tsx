"use client";

import { ChevronLeft, Search, Trash2 } from "lucide-react";
import type { LogSession } from "@/lib/types";

export function LogsSessionsSidebar({
  sessions,
  filteredSessions,
  selectedSession,
  filter,
  sidebarOpen,
  onFilterChange,
  onSidebarToggle,
  onSelectSession,
  onDeleteSession,
  formatDateTime,
}: {
  sessions: LogSession[];
  filteredSessions: LogSession[];
  selectedSession: string | null;
  filter: string;
  sidebarOpen: boolean;
  onFilterChange: (value: string) => void;
  onSidebarToggle: (value: boolean) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  formatDateTime: (dateValue: string) => string;
}) {
  const renderFilter = () => (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-(--dim)" />
      <input
        type="text"
        value={filter}
        onChange={(event) => onFilterChange(event.target.value)}
        placeholder="Filter..."
        className="w-full pl-9 pr-3 py-2 bg-(--surface) border border-(--border) rounded-lg text-sm text-(--fg) placeholder-(--dim)/50 focus:outline-none focus:border-(--accent)"
      />
    </div>
  );

  const renderSessionRow = (session: LogSession) => (
    <div
      key={session.id}
      role="button"
      tabIndex={0}
      aria-pressed={selectedSession === session.id}
      onClick={() => onSelectSession(session.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectSession(session.id);
        }
      }}
      className={`w-full text-left p-3 border-b border-(--border)/50 transition-colors group cursor-pointer ${
        selectedSession === session.id ? "bg-(--surface)" : "hover:bg-(--surface)"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-(--fg) truncate">
            {session.model || session.id}
          </div>
          <div className="text-[11px] text-(--dim) mt-1">{formatDateTime(session.created_at)}</div>
          {session.backend && (
            <span
              className={`inline-block mt-1.5 px-1.5 py-0.5 rounded text-[10px] ${
                session.backend === "vllm"
                  ? "bg-(--hl1)/10 text-(--hl1)"
                  : "bg-(--hl1)/10 text-(--hl1)"
              }`}
            >
              {session.backend}
            </span>
          )}
        </div>
        <button
          disabled={session.id === "controller"}
          onClick={(event) => {
            event.stopPropagation();
            onDeleteSession(session.id);
          }}
          className={`p-1 text-(--dim) opacity-0 group-hover:opacity-100 transition-all ${
            session.id === "controller" ? "cursor-not-allowed opacity-20" : "hover:text-(--err)"
          }`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  const renderSessions = () =>
    filteredSessions.length === 0 ? (
      <div className="p-4 text-center text-(--dim) text-sm">No log files found</div>
    ) : (
      filteredSessions.map(renderSessionRow)
    );

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => onSidebarToggle(false)}
        />
      )}

      <div className="w-72 border-r border-(--border) flex-col bg-(--surface) shrink-0 hidden md:flex">
        <div className="p-4 border-b border-(--border)">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-sm font-medium text-(--dim) uppercase tracking-wider">
              Log Sessions
            </h1>
          </div>
          {renderFilter()}
        </div>
        <div className="flex-1 overflow-y-auto">{renderSessions()}</div>
        <div className="p-3 border-t border-(--border) text-[11px] text-(--dim)">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div
        className={`fixed inset-y-0 left-0 z-30 w-72 border-r border-(--border) flex flex-col bg-(--surface) transform transition-transform duration-200 ease-in-out md:hidden ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-4 border-b border-(--border)">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-sm font-medium text-(--dim) uppercase tracking-wider">
              Log Sessions
            </h1>
            <button
              onClick={() => onSidebarToggle(false)}
              className="p-1 hover:bg-(--surface) rounded"
            >
              <ChevronLeft className="h-4 w-4 text-(--dim)" />
            </button>
          </div>
          {renderFilter()}
        </div>
        <div className="flex-1 overflow-y-auto">{renderSessions()}</div>
        <div className="p-3 border-t border-(--border) text-[11px] text-(--dim)">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </div>
      </div>
    </>
  );
}
