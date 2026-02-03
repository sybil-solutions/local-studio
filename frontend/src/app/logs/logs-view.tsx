// CRITICAL
import type { LogSession } from "@/lib/types";

interface LogsViewProps {
  sessions: LogSession[];
  selectedSession: LogSession | null;
  logs: string[];
  loading: boolean;
  loadingLogs: boolean;
  onSelect: (sessionId: string) => void;
  onRefresh: () => void;
}

export function LogsView({
  sessions,
  selectedSession,
  logs,
  loading,
  loadingLogs,
  onSelect,
  onRefresh,
}: LogsViewProps) {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Logs</h1>
        <button className="text-xs text-(--accent)" onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="border border-(--border) rounded-lg p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-(--muted-foreground)/60">Sessions</div>
          {loading ? (
            <div className="text-xs text-(--muted-foreground)/60">Loading...</div>
          ) : sessions.length === 0 ? (
            <div className="text-xs text-(--muted-foreground)/60">No log sessions</div>
          ) : (
            <div className="space-y-1">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onSelect(session.id)}
                  className={`w-full text-left text-xs px-2 py-1 rounded ${
                    selectedSession?.id === session.id ? "bg-(--accent)/10" : "hover:bg-(--muted)/20"
                  }`}
                >
                  <div className="font-medium truncate">{session.recipe_name || session.id}</div>
                  <div className="text-[10px] text-(--muted-foreground)/60">{session.status}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="border border-(--border) rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-(--muted-foreground)/60 mb-2">
            {selectedSession ? `Session ${selectedSession.id}` : "Logs"}
          </div>
          {loadingLogs ? (
            <div className="text-xs text-(--muted-foreground)/60">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="text-xs text-(--muted-foreground)/60">No logs available</div>
          ) : (
            <div className="max-h-[60vh] overflow-auto font-mono text-[11px] leading-relaxed space-y-0.5">
              {logs.map((line, index) => (
                <div
                  key={`${selectedSession?.id ?? "logs"}-${index}`}
                  className={line.includes("ERROR") ? "text-(--error)/70" : "text-(--muted-foreground)/70"}
                >
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
