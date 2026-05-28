"use client";

import { ChevronRight, Download, Menu, RefreshCw } from "lucide-react";
import { Button, Checkbox, SearchInput } from "@/ui";
import type { LogSession } from "@/lib/types";
import { LogsSessionsSidebar } from "./logs-view/logs-sessions-sidebar";

interface LogsViewProps {
  sessions: LogSession[];
  filteredSessions: LogSession[];
  selectedSession: string | null;
  hasLogContent: boolean;
  filter: string;
  contentFilter: string;
  loading: boolean;
  loadingContent: boolean;
  autoScroll: boolean;
  autoRefresh: boolean;
  sidebarOpen: boolean;
  logRef: React.RefObject<HTMLDivElement | null>;
  onFilterChange: (value: string) => void;
  onContentFilterChange: (value: string) => void;
  onAutoScrollChange: (value: boolean) => void;
  onAutoRefreshChange: (value: boolean) => void;
  onSidebarToggle: (value: boolean) => void;
  onLoadLogContent: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onDownloadLog: () => void;
  onRenderLogs: () => React.ReactNode;
  onSelectSession: (sessionId: string) => void;
  formatDateTime: (dateValue: string) => string;
}

export function LogsView({
  sessions,
  filteredSessions,
  selectedSession,
  hasLogContent,
  filter,
  contentFilter,
  loading,
  loadingContent,
  autoScroll,
  autoRefresh,
  sidebarOpen,
  logRef,
  onFilterChange,
  onContentFilterChange,
  onAutoScrollChange,
  onAutoRefreshChange,
  onSidebarToggle,
  onLoadLogContent,
  onDeleteSession,
  onDownloadLog,
  onRenderLogs,
  onSelectSession,
  formatDateTime,
}: LogsViewProps) {
  if (loading)
    return (
      <div className="flex items-center justify-center h-full bg-(--surface)">
        <div className="flex items-center gap-2 text-(--dim)">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading logs...</span>
        </div>
      </div>
    );

  return (
    <div className="flex h-full bg-(--surface) text-(--fg) relative">
      <LogsSessionsSidebar
        sessions={sessions}
        filteredSessions={filteredSessions}
        selectedSession={selectedSession}
        filter={filter}
        sidebarOpen={sidebarOpen}
        onFilterChange={onFilterChange}
        onSidebarToggle={onSidebarToggle}
        onSelectSession={onSelectSession}
        onDeleteSession={onDeleteSession}
        formatDateTime={formatDateTime}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedSession ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-(--border) gap-2">
              <div className="flex items-center gap-2 text-sm min-w-0 flex-1">
                <Button
                  variant="icon"
                  size="sm"
                  onClick={() => onSidebarToggle(true)}
                  className="shrink-0 md:hidden"
                >
                  <Menu className="h-4 w-4 text-(--dim)" />
                </Button>
                <ChevronRight className="h-3.5 w-3.5 text-(--dim) hidden sm:block flex-shrink-0" />
                <span className="text-(--fg) font-mono truncate text-xs sm:text-sm">
                  {selectedSession}
                </span>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                <Checkbox
                  checked={autoRefresh}
                  onChange={onAutoRefreshChange}
                  label="Auto-refresh"
                  className="hidden items-center sm:flex"
                  labelClassName="text-[11px] font-normal"
                />
                <Checkbox
                  checked={autoScroll}
                  onChange={onAutoScrollChange}
                  label="Auto-scroll"
                  className="hidden items-center sm:flex"
                  labelClassName="text-[11px] font-normal"
                />
                <div className="w-px h-4 bg-(--border) hidden sm:block" />
                <SearchInput
                  value={contentFilter}
                  onChange={onContentFilterChange}
                  placeholder="Filter..."
                  className="w-28 sm:w-44 [&_input]:py-1.5 [&_input]:text-xs"
                />
                <Button
                  variant="icon"
                  size="sm"
                  onClick={() => selectedSession && onLoadLogContent(selectedSession)}
                  title="Refresh"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 text-(--dim) ${loadingContent ? "animate-spin" : ""}`}
                  />
                </Button>
                <Button variant="icon" size="sm" onClick={onDownloadLog} title="Download">
                  <Download className="h-3.5 w-3.5 text-(--dim)" />
                </Button>
              </div>
            </div>

            {/* Log Content */}
            <div
              ref={logRef}
              className="flex-1 overflow-auto p-2 sm:p-4 font-mono text-[10px] sm:text-xs bg-(--surface) leading-relaxed"
            >
              {loadingContent ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-2 text-(--dim)">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Loading...</span>
                  </div>
                </div>
              ) : hasLogContent ? (
                onRenderLogs()
              ) : (
                <div className="text-center text-(--dim)">No log content</div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <Button variant="secondary" onClick={() => onSidebarToggle(true)} className="md:hidden">
              <Menu className="h-4 w-4" />
              View Sessions
            </Button>
            <div className="text-center text-(--dim)">
              <p className="text-sm">Select a log session to view</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
