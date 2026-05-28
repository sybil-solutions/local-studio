"use client";

import { LogsView } from "./_components/logs-view";
import { useLogs } from "./hooks/use-logs";

export default function LogsPage() {
  const {
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
    setFilter,
    setContentFilter,
    setAutoScroll,
    setAutoRefresh,
    setSidebarOpen,
    loadLogContent,
    deleteSession,
    downloadLog,
    renderLogs,
    handleSelectSession,
    formatDateTime,
  } = useLogs();

  return (
    <LogsView
      sessions={sessions}
      filteredSessions={filteredSessions}
      selectedSession={selectedSession}
      hasLogContent={hasLogContent}
      filter={filter}
      contentFilter={contentFilter}
      loading={loading}
      loadingContent={loadingContent}
      autoScroll={autoScroll}
      autoRefresh={autoRefresh}
      sidebarOpen={sidebarOpen}
      logRef={logRef}
      onFilterChange={setFilter}
      onContentFilterChange={setContentFilter}
      onAutoScrollChange={setAutoScroll}
      onAutoRefreshChange={setAutoRefresh}
      onSidebarToggle={setSidebarOpen}
      onLoadLogContent={loadLogContent}
      onDeleteSession={deleteSession}
      onDownloadLog={downloadLog}
      onRenderLogs={renderLogs}
      onSelectSession={handleSelectSession}
      formatDateTime={formatDateTime}
    />
  );
}
