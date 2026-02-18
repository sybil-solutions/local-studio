// CRITICAL
"use client";

import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import type { JobRecord } from "@/lib/api/jobs";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";

const STATUS_COLORS: Record<string, string> = {
  pending: "text-foreground/40",
  running: "text-blue-400",
  completed: "text-(--hl2)",
  failed: "text-(--err)",
  cancelled: "text-foreground/50",
};

export function JobsPanel() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const snap = useRealtimeStatusStore();

  const fetchJobs = useCallback(async () => {
    try {
      const { jobs: list } = await api.listJobs(50);
      setJobs(list);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  // Refresh on job_updated events via realtime store
  useEffect(() => {
    if (snap.jobs.length > 0) {
      void fetchJobs();
    }
  }, [snap.jobs, fetchJobs]);

  if (loading) {
    return <div className="text-xs text-foreground/40 font-mono">Loading jobs…</div>;
  }

  if (jobs.length === 0) {
    return <div className="text-xs text-foreground/40 font-mono">No jobs yet.</div>;
  }

  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}

function JobCard({ job }: { job: JobRecord }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = STATUS_COLORS[job.status] ?? "text-foreground/40";
  const logs = Array.isArray(job.logs) ? job.logs : [];

  return (
    <div className="border border-foreground/10 rounded px-3 py-2 text-xs font-mono">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-foreground/60">{job.type}</span>
          <span className={statusColor}>{job.status}</span>
          {job.status === "running" && (
            <span className="text-blue-400">{Math.round(job.progress)}%</span>
          )}
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-foreground/30 hover:text-foreground/60"
        >
          {expanded ? "▾" : "▸"}
        </button>
      </div>

      {/* Progress bar */}
      {job.status === "running" && (
        <div className="mt-1 h-1 bg-foreground/10 rounded overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${job.progress}%` }}
          />
        </div>
      )}

      {expanded && (
        <div className="mt-2 space-y-1">
          <div className="text-foreground/30">id: {job.id}</div>
          {job.error && <div className="text-(--err)">error: {job.error}</div>}
          {logs.length > 0 && (
            <div className="mt-1 max-h-32 overflow-y-auto bg-black/20 rounded p-1.5">
              {logs.slice(-20).map((line, i) => (
                <div key={i} className="text-foreground/50 leading-tight">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
