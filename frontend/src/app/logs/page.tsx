"use client";

import { LogsView } from "./logs-view";
import { useLogs } from "./use-logs";

export default function LogsPage() {
  const { sessions, selectedSession, logs, loading, loadingLogs, selectSession, refresh } = useLogs();

  return (
    <LogsView
      sessions={sessions}
      selectedSession={selectedSession}
      logs={logs}
      loading={loading}
      loadingLogs={loadingLogs}
      onSelect={selectSession}
      onRefresh={refresh}
    />
  );
}
