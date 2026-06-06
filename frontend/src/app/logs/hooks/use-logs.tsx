"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import api from "@/lib/api";
import { getApiKey } from "@/lib/api-key";
import type { LogSession } from "@/lib/types";

const MAX_RENDERED_LINES = 20_000;

export function useLogs() {
  const [sessions, setSessions] = useState<LogSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [contentFilter, setContentFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.getLogSessions();
      setSessions(data.sessions || []);
      if (data.sessions?.length > 0 && !selectedSession) setSelectedSession(data.sessions[0].id);
    } catch (e) {
      console.error("Failed to load log sessions:", e);
    } finally {
      setLoading(false);
    }
  }, [selectedSession]);

  const loadLogContent = useCallback(async (sessionId: string, silent = false) => {
    if (!silent) setLoadingContent(true);
    try {
      const data = await api.getLogs(sessionId, 2000);
      const lines = Array.isArray(data.logs) ? data.logs : [];
      setLogLines(lines);
    } catch (e) {
      console.error("Failed to load log content:", e);
      setLogLines(["Failed to load log content"]);
    } finally {
      if (!silent) setLoadingContent(false);
    }
  }, []);

  const subscribeLogSessions = useCallback(
    (_notify: () => void) => {
      void loadSessions();
      return () => {};
    },
    [loadSessions],
  );

  const subscribeLogContent = useCallback(
    (_notify: () => void) => {
      if (selectedSession) void loadLogContent(selectedSession);
      return () => {};
    },
    [loadLogContent, selectedSession],
  );

  const subscribeLogStream = useCallback(
    (_notify: () => void) => {
      if (!autoRefresh || !selectedSession) {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        return () => {};
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      const apiKey = getApiKey();
      const base = `/api/proxy/logs/${encodeURIComponent(selectedSession)}/stream`;
      const url = apiKey
        ? `${base}?tail=0&api_key=${encodeURIComponent(apiKey)}`
        : `${base}?tail=0`;

      const es = new EventSource(url);
      eventSourceRef.current = es;

      const onLog = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data) as {
            data?: { session_id?: unknown; line?: unknown };
          };
          const sessionId =
            typeof payload.data?.session_id === "string" ? payload.data.session_id : null;
          const line = typeof payload.data?.line === "string" ? payload.data.line : null;
          if (!line) return;
          if (sessionId && sessionId !== selectedSession) return;
          setLogLines((prev) => {
            const next = prev.length ? [...prev, line] : [line];
            return next.length > MAX_RENDERED_LINES ? next.slice(-MAX_RENDERED_LINES) : next;
          });
        } catch {
          // Ignore malformed events.
        }
      };

      es.addEventListener("log", onLog as unknown as EventListener);
      es.onerror = () => {
        // EventSource will auto-reconnect; avoid noisy console output.
      };

      return () => {
        es.close();
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      };
    },
    [autoRefresh, selectedSession],
  );

  const subscribeLogAutoscroll = useCallback(
    (_notify: () => void) => {
      if (autoScroll && logRef.current) {
        logRef.current.scrollTop = logRef.current.scrollHeight;
      }
      return () => {};
    },
    [logLines.length, autoScroll],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === "controller") {
        alert("Controller logs cannot be deleted.");
        return;
      }
      if (!confirm("Delete this log session?")) return;
      try {
        await api.deleteLogSession(sessionId);
        if (selectedSession === sessionId) {
          setSelectedSession(null);
          setLogLines([]);
        }
        await loadSessions();
      } catch (e) {
        alert("Failed to delete: " + (e as Error).message);
      }
    },
    [loadSessions, selectedSession],
  );

  const downloadLog = useCallback(() => {
    if (!selectedSession || logLines.length === 0) return;
    const blob = new Blob([logLines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedSession}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logLines, selectedSession]);

  const filteredSessions = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter(
      (session) =>
        session.model?.toLowerCase().includes(query) || session.id.toLowerCase().includes(query),
    );
  }, [filter, sessions]);

  const subscribeSelectedSession = useCallback(
    (_notify: () => void) => {
      if (filteredSessions.length === 0) {
        if (selectedSession) {
          setSelectedSession(null);
          setLogLines([]);
        }
        return () => {};
      }
      if (!selectedSession || !filteredSessions.some((session) => session.id === selectedSession)) {
        setSelectedSession(filteredSessions[0]?.id ?? null);
      }
      return () => {};
    },
    [filteredSessions, selectedSession],
  );

  useSyncExternalStore(subscribeLogSessions, getLogsSnapshot, getLogsSnapshot);
  useSyncExternalStore(subscribeLogContent, getLogsSnapshot, getLogsSnapshot);
  useSyncExternalStore(subscribeLogStream, getLogsSnapshot, getLogsSnapshot);
  useSyncExternalStore(subscribeLogAutoscroll, getLogsSnapshot, getLogsSnapshot);
  useSyncExternalStore(subscribeSelectedSession, getLogsSnapshot, getLogsSnapshot);

  const formatDateTime = (dateValue: string) =>
    new Date(dateValue).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const getLogLineClass = (line: string) => {
    if (line.includes("ERROR") || line.includes("error")) return "text-(--err)";
    if (line.includes("WARNING") || line.includes("warn")) return "text-(--hl3)";
    if (line.includes("INFO")) return "text-(--hl1)";
    if (line.includes("loaded") || line.includes("started") || line.includes("success"))
      return "text-(--hl2)";
    return "text-(--dim)";
  };

  const renderLogs = useCallback(() => {
    const query = contentFilter.trim().toLowerCase();
    const visible = query
      ? logLines.filter((line) => line.toLowerCase().includes(query))
      : logLines;
    return visible.map((line, index) => (
      <div key={index} className={`${getLogLineClass(line)} hover:bg-(--surface) px-2 py-0.5`}>
        {line || "\u00A0"}
      </div>
    ));
  }, [contentFilter, logLines]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSession(sessionId);
    setSidebarOpen(false);
  }, []);

  return {
    sessions,
    filteredSessions,
    selectedSession,
    hasLogContent: logLines.length > 0,
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
    setSelectedSession,
  };
}

const getLogsSnapshot = (): number => 0;
