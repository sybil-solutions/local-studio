// CRITICAL
import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import type { LogSession } from "@/lib/types";

export function useLogs() {
  const [sessions, setSessions] = useState<LogSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getLogSessions();
      const list = data.sessions ?? [];
      setSessions(list);
      setSelectedId((current) => {
        if (current && list.some((item) => item.id === current)) {
          return current;
        }
        const preferred = list.find((item) => item.status === "running") ?? list[0];
        return preferred?.id ?? null;
      });
      if (list.length === 0) {
        setLogs([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async (sessionId: string) => {
    setLoadingLogs(true);
    try {
      const data = await api.getLogs(sessionId, 200);
      setLogs(data.logs ?? []);
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (selectedId) {
      loadLogs(selectedId);
    }
  }, [selectedId, sessions, loadLogs]);

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === selectedId) ?? null,
    [sessions, selectedId],
  );

  return {
    sessions,
    selectedSession,
    logs,
    loading,
    loadingLogs,
    selectSession: setSelectedId,
    refresh: loadSessions,
  };
}
