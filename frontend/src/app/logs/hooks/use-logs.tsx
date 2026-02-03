// CRITICAL
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import type { LogSession } from "@/lib/types";

export function useLogs() {
  const [sessions, setSessions] = useState<LogSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [contentFilter, setContentFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

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
      const data = await api.getLogContent(sessionId, 2000);
      setLogContent(data.content || "");
    } catch (e) {
      console.error("Failed to load log content:", e);
      setLogContent("Failed to load log content");
    } finally {
      if (!silent) setLoadingContent(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (selectedSession) loadLogContent(selectedSession);
  }, [loadLogContent, selectedSession]);

  useEffect(() => {
    if (autoRefresh && selectedSession) {
      intervalRef.current = setInterval(() => loadLogContent(selectedSession, true), 2000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, loadLogContent, selectedSession]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logContent, autoScroll]);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!confirm("Delete this log session?")) return;
      try {
        await api.deleteLogSession(sessionId);
        if (selectedSession === sessionId) {
          setSelectedSession(null);
          setLogContent("");
        }
        await loadSessions();
      } catch (e) {
        alert("Failed to delete: " + (e as Error).message);
      }
    },
    [loadSessions, selectedSession],
  );

  const downloadLog = useCallback(() => {
    if (!selectedSession || !logContent) return;
    const blob = new Blob([logContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedSession}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logContent, selectedSession]);

  const filteredSessions = filter
    ? sessions.filter(
        (session) =>
          session.model?.toLowerCase().includes(filter.toLowerCase()) ||
          session.id.toLowerCase().includes(filter.toLowerCase()),
      )
    : sessions;

  const formatDateTime = (dateValue: string) =>
    new Date(dateValue).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const getLogLineClass = (line: string) => {
    if (line.includes("ERROR") || line.includes("error")) return "text-[#c97a6b]";
    if (line.includes("WARNING") || line.includes("warn")) return "text-[#c9a66b]";
    if (line.includes("INFO")) return "text-[#6b9ac9]";
    if (line.includes("loaded") || line.includes("started") || line.includes("success"))
      return "text-[#7d9a6a]";
    return "text-[#9a9088]";
  };

  const renderLogs = useCallback(() => {
    const lines = logContent.split("\n");
    const query = contentFilter.trim().toLowerCase();
    const visible = query ? lines.filter((line) => line.toLowerCase().includes(query)) : lines;
    return visible.map((line, index) => (
      <div key={index} className={`${getLogLineClass(line)} hover:bg-[#2a2826] px-2 py-0.5`}>
        {line || "\u00A0"}
      </div>
    ));
  }, [contentFilter, logContent]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSession(sessionId);
    setSidebarOpen(false);
  }, []);

  return {
    sessions,
    filteredSessions,
    selectedSession,
    logContent,
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
