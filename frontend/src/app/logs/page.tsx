'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, RefreshCw, Trash2, Download, ChevronRight, ChevronLeft, Menu } from 'lucide-react';
import api from '@/lib/api';
import type { LogSession } from '@/lib/types';

export default function LogsPage() {
  const [sessions, setSessions] = useState<LogSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string>('');
  const [filter, setFilter] = useState('');
  const [contentFilter, setContentFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) loadLogContent(selectedSession);
  }, [selectedSession]);

  useEffect(() => {
    if (autoRefresh && selectedSession) {
      intervalRef.current = setInterval(() => loadLogContent(selectedSession, true), 2000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, selectedSession]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logContent, autoScroll]);

  const loadSessions = async () => {
    try {
      const data = await api.getLogSessions();
      setSessions(data.sessions || []);
      if (data.sessions?.length > 0 && !selectedSession) setSelectedSession(data.sessions[0].id);
    } catch (e) {
      console.error('Failed to load log sessions:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadLogContent = async (sessionId: string, silent = false) => {
    if (!silent) setLoadingContent(true);
    try {
      const data = await api.getLogContent(sessionId, 2000);
      setLogContent(data.content || '');
    } catch (e) {
      console.error('Failed to load log content:', e);
      setLogContent('Failed to load log content');
    } finally {
      if (!silent) setLoadingContent(false);
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (!confirm('Delete this log session?')) return;
    try {
      await api.deleteLogSession(sessionId);
      if (selectedSession === sessionId) { setSelectedSession(null); setLogContent(''); }
      await loadSessions();
    } catch (e) {
      alert('Failed to delete: ' + (e as Error).message);
    }
  };

  const downloadLog = () => {
    if (!selectedSession || !logContent) return;
    const blob = new Blob([logContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${selectedSession}.log`; a.click();
    URL.revokeObjectURL(url);
  };

  const filteredSessions = filter ? sessions.filter(s =>
    s.model?.toLowerCase().includes(filter.toLowerCase()) || s.id.toLowerCase().includes(filter.toLowerCase())
  ) : sessions;

  const formatDateTime = (d: string) => new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const getLogLineClass = (line: string) => {
    if (line.includes('ERROR') || line.includes('error')) return 'text-[#c97a6b]';
    if (line.includes('WARNING') || line.includes('warn')) return 'text-[#c9a66b]';
    if (line.includes('INFO')) return 'text-[#6b9ac9]';
    if (line.includes('loaded') || line.includes('started') || line.includes('success')) return 'text-[#7d9a6a]';
    return 'text-[#9a9088]';
  };

  const renderLogs = () => {
    const lines = logContent.split('\n');
    const q = contentFilter.trim().toLowerCase();
    const visible = q ? lines.filter(l => l.toLowerCase().includes(q)) : lines;
    return visible.map((line, i) => (
      <div key={i} className={`${getLogLineClass(line)} hover:bg-[#2a2826] px-2 py-0.5`}>
        {line || '\u00A0'}
      </div>
    ));
  };

  // Close sidebar when selecting a session on mobile
  const handleSelectSession = (sessionId: string) => {
    setSelectedSession(sessionId);
    setSidebarOpen(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full bg-[#1b1b1b]">
      <div className="flex items-center gap-2 text-[#9a9088]">
        <RefreshCw className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading logs...</span>
      </div>
    </div>
  );

  return (
    <div className="flex h-full bg-[#1b1b1b] text-[#f0ebe3] relative">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - hidden on mobile by default, shown when sidebarOpen */}
      <div className={`
        fixed md:relative inset-y-0 left-0 z-30
        w-72 border-r border-[#363432] flex flex-col bg-[#1b1b1b]
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="p-4 border-b border-[#363432]">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-sm font-medium text-[#9a9088] uppercase tracking-wider">Log Sessions</h1>
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden p-1 hover:bg-[#2a2826] rounded"
            >
              <ChevronLeft className="h-4 w-4 text-[#9a9088]" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9a9088]" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter..."
              className="w-full pl-9 pr-3 py-2 bg-[#1e1e1e] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] placeholder-[#9a9088]/50 focus:outline-none focus:border-[#8b7355]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredSessions.length === 0 ? (
            <div className="p-4 text-center text-[#9a9088] text-sm">No log files found</div>
          ) : (
            filteredSessions.map((s) => (
              <button
                key={s.id}
                onClick={() => handleSelectSession(s.id)}
                className={`w-full text-left p-3 border-b border-[#363432]/50 transition-colors group ${
                  selectedSession === s.id ? 'bg-[#2a2826]' : 'hover:bg-[#1e1e1e]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#f0ebe3] truncate">
                      {s.model || s.id}
                    </div>
                    <div className="text-[11px] text-[#9a9088] mt-1">
                      {formatDateTime(s.created_at)}
                    </div>
                    {s.backend && (
                      <span className={`inline-block mt-1.5 px-1.5 py-0.5 rounded text-[10px] ${
                        s.backend === 'vllm' ? 'bg-[#6b9ac9]/10 text-[#6b9ac9]' : 'bg-[#9a6bc9]/10 text-[#9a6bc9]'
                      }`}>
                        {s.backend}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                    className="p-1 text-[#9a9088] opacity-0 group-hover:opacity-100 hover:text-[#c97a6b] transition-all"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="p-3 border-t border-[#363432] text-[11px] text-[#9a9088]">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedSession ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-[#363432] gap-2">
              <div className="flex items-center gap-2 text-sm min-w-0 flex-1">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="md:hidden p-1 hover:bg-[#2a2826] rounded flex-shrink-0"
                >
                  <Menu className="h-4 w-4 text-[#9a9088]" />
                </button>
                <ChevronRight className="h-3.5 w-3.5 text-[#9a9088] hidden sm:block flex-shrink-0" />
                <span className="text-[#f0ebe3] font-mono truncate text-xs sm:text-sm">{selectedSession}</span>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                <label className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#9a9088] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="rounded border-[#363432] bg-[#1e1e1e] text-[#7d9a6a] focus:ring-0 focus:ring-offset-0"
                  />
                  Auto-refresh
                </label>
                <label className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#9a9088] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="rounded border-[#363432] bg-[#1e1e1e] text-[#7d9a6a] focus:ring-0 focus:ring-offset-0"
                  />
                  Auto-scroll
                </label>
                <div className="w-px h-4 bg-[#363432] hidden sm:block" />
                <input
                  type="text"
                  value={contentFilter}
                  onChange={(e) => setContentFilter(e.target.value)}
                  placeholder="Filter..."
                  className="px-2.5 py-1.5 text-xs bg-[#1e1e1e] border border-[#363432] rounded text-[#f0ebe3] placeholder-[#9a9088]/50 focus:outline-none focus:border-[#8b7355] w-24 sm:w-40"
                />
                <button
                  onClick={() => loadLogContent(selectedSession!)}
                  className="p-1.5 hover:bg-[#2a2826] rounded transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className={`h-3.5 w-3.5 text-[#9a9088] ${loadingContent ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={downloadLog}
                  className="p-1.5 hover:bg-[#2a2826] rounded transition-colors"
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5 text-[#9a9088]" />
                </button>
              </div>
            </div>

            {/* Log Content */}
            <div
              ref={logRef}
              className="flex-1 overflow-auto p-2 sm:p-4 font-mono text-[10px] sm:text-xs bg-[#1b1b1b] leading-relaxed"
            >
              {loadingContent ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-2 text-[#9a9088]">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Loading...</span>
                  </div>
                </div>
              ) : logContent ? (
                renderLogs()
              ) : (
                <div className="text-center text-[#9a9088]">No log content</div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden flex items-center gap-2 px-4 py-2 bg-[#363432] rounded-lg text-[#f0ebe3] text-sm"
            >
              <Menu className="h-4 w-4" />
              View Sessions
            </button>
            <div className="text-center text-[#9a9088]">
              <p className="text-sm">Select a log session to view</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
