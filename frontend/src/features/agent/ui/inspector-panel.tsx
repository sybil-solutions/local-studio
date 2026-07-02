"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  Braces,
  FileCode2,
  FilePenLine,
  FileSearch,
  Filter,
  Globe2,
  Paperclip,
  TerminalSquare,
  Wrench,
  type LucideIcon,
} from "@/ui/icon-registry";
import type { Session } from "@/features/agent/runtime/types";
import {
  deriveTurnTimeline,
  type AttachmentEntry,
  type ToolCallRecord,
  type TurnRecord,
} from "@/features/agent/turn-timeline-model";
import { formatTokenCount } from "@/features/agent/messages/helpers";
import {
  humanizeToolName,
  toolKindNodeColor,
  type ToolKind,
} from "@/features/agent/ui/timeline/tool-metadata";

const KIND_ICONS: Record<ToolKind, LucideIcon> = {
  edit: FilePenLine,
  read: FileSearch,
  search: Braces,
  exec: TerminalSquare,
  browser: Globe2,
  generic: Wrench,
};

const STATUS_DOTS: Record<ToolCallRecord["status"], string> = {
  done: "bg-(--ok)",
  error: "bg-(--err)",
  running: "bg-(--accent) animate-pulse",
};

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

function AttachmentChip({ attachment }: { attachment: AttachmentEntry }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono bg-(--surface) text-(--dim)"
      title={`${attachment.name} (${attachment.type}, ${formatBytes(attachment.size)})`}
    >
      <Paperclip className="h-2.5 w-2.5 shrink-0" />
      <span className="max-w-[100px] truncate">{attachment.name}</span>
      <span className="opacity-60">{formatBytes(attachment.size)}</span>
    </span>
  );
}

const SPARKLINE_WIDTH = 60;
const SPARKLINE_HEIGHT = 14;
const MAX_SPARKLINE_SAMPLES = 30;
const EMPTY_SAMPLES: number[] = [];

function ContextSparkline({ samples }: { samples: number[] }) {
  if (samples.length < 2) {
    return (
      <svg
        width={SPARKLINE_WIDTH}
        height={SPARKLINE_HEIGHT}
        className="shrink-0 opacity-30"
        aria-label="Context usage sparkline (insufficient data)"
      >
        <line
          x1={0}
          y1={SPARKLINE_HEIGHT / 2}
          x2={SPARKLINE_WIDTH}
          y2={SPARKLINE_HEIGHT / 2}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      </svg>
    );
  }
  const stepX = SPARKLINE_WIDTH / (samples.length - 1);
  const points = samples
    .map((v, i) => `${i * stepX},${SPARKLINE_HEIGHT - (v / 100) * SPARKLINE_HEIGHT}`)
    .join(" ");
  const lastX = (samples.length - 1) * stepX;
  const lastY = SPARKLINE_HEIGHT - (samples[samples.length - 1] / 100) * SPARKLINE_HEIGHT;
  return (
    <svg
      width={SPARKLINE_WIDTH}
      height={SPARKLINE_HEIGHT}
      className="shrink-0"
      aria-label={`Context usage sparkline, current ${Math.round(samples[samples.length - 1])}%`}
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.7}
      />
      <circle cx={lastX} cy={lastY} r={1.5} fill="var(--accent)" />
    </svg>
  );
}

function sessionDurationMs(turns: TurnRecord[]): number | undefined {
  const firstStart = turns[0]?.startedAt ? new Date(turns[0].startedAt).getTime() : undefined;
  const latestTurn = turns[turns.length - 1];
  const lastEnd = latestTurn?.endedAt ? new Date(latestTurn.endedAt).getTime() : undefined;
  return firstStart && lastEnd && lastEnd > firstStart ? lastEnd - firstStart : undefined;
}

function SessionSummaryHeader({
  turns,
  contextSamples,
  toolOnly,
  onToggleToolOnly,
}: {
  turns: TurnRecord[];
  contextSamples: number[];
  toolOnly: boolean;
  onToggleToolOnly: () => void;
}) {
  const totalToolCalls = turns.reduce((sum, t) => sum + t.toolCalls.length, 0);
  const uniqueFiles = new Set(turns.flatMap((t) => t.filesTouched.map((f) => f.path)));
  const latestTurn = turns[turns.length - 1];
  const sessionTokens = latestTurn?.tokenTotal;
  const durationMs = sessionDurationMs(turns);

  return (
    <div className="shrink-0 border-b border-(--border) px-3 py-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[length:var(--fs-sm)] font-medium text-(--fg)/80">Inspector</h2>
        <button
          type="button"
          onClick={onToggleToolOnly}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
            toolOnly
              ? "bg-(--accent)/15 text-(--accent)"
              : "text-(--dim) hover:bg-(--surface) hover:text-(--fg)/75"
          }`}
          title={toolOnly ? "Show all turns" : "Show only turns with tool calls"}
        >
          <Filter className="h-3 w-3" />
          Tools only
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-(--dim)">
        <span>
          {turns.length} turn{turns.length !== 1 ? "s" : ""}
        </span>
        <span>
          {totalToolCalls} tool call{totalToolCalls !== 1 ? "s" : ""}
        </span>
        <span>
          {uniqueFiles.size} file{uniqueFiles.size !== 1 ? "s" : ""}
        </span>
        {durationMs != null ? (
          <span title="Session duration">{formatDuration(durationMs)}</span>
        ) : null}
        {sessionTokens != null ? (
          <span title="Session tokens">{formatTokenCount(sessionTokens)} tokens</span>
        ) : null}
        {latestTurn?.modelId ? <span className="font-mono">{latestTurn.modelId}</span> : null}
        <ContextSparkline samples={contextSamples} />
      </div>
    </div>
  );
}

function ToolCallRow({ call }: { call: ToolCallRecord }) {
  const Icon = KIND_ICONS[call.kind];
  return (
    <div className="flex items-center gap-1.5 py-0.5 pl-4 text-[11px] leading-5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOTS[call.status]}`} />
      <Icon className={`h-3 w-3 shrink-0 ${toolKindNodeColor(call.kind)}`} />
      <span className="min-w-0 truncate text-(--fg)/75">{humanizeToolName(call.name)}</span>
    </div>
  );
}

function ContextBar({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--surface)">
        <div
          className="h-full rounded-full bg-(--accent)/60 transition-all"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <span className="w-8 text-right text-[10px] tabular-nums text-(--dim)">
        {Math.round(percent)}%
      </span>
    </div>
  );
}

function scrollToMessage(messageId: string) {
  const el = document.querySelector(`[data-timeline-message-id="${messageId}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function isInteractiveChild(e: MouseEvent): boolean {
  return Boolean((e.target as HTMLElement).closest("a,button"));
}

function TurnRow({ turn }: { turn: TurnRecord }) {
  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (isInteractiveChild(e)) return;
      scrollToMessage(turn.assistantMessageId);
    },
    [turn.assistantMessageId],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        scrollToMessage(turn.assistantMessageId);
      }
    },
    [turn.assistantMessageId],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="group cursor-pointer rounded-lg border border-(--border)/40 bg-(--surface)/30 px-3 py-2.5 transition-colors hover:bg-(--surface)/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--accent)"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-(--surface) text-[10px] font-semibold tabular-nums text-(--dim)">
            {turn.turnIndex + 1}
          </span>
          <span className="min-w-0 truncate font-mono text-[11px] text-(--dim)">
            {turn.modelId ?? "—"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[10px] tabular-nums text-(--dim)">
          {turn.durationMs != null ? (
            <span title="Duration">{formatDuration(turn.durationMs)}</span>
          ) : null}
          {turn.tokenTotal != null ? (
            <span title="Total tokens">{formatTokenCount(turn.tokenTotal)}</span>
          ) : (
            <span className="opacity-40">—</span>
          )}
          {turn.tokenDelta != null ? (
            <span className="text-(--accent)" title="Token delta">
              +{formatTokenCount(turn.tokenDelta)}
            </span>
          ) : null}
        </div>
      </div>

      {turn.contextPercentAfter != null ? (
        <div className="mt-2">
          <ContextBar percent={turn.contextPercentAfter} />
        </div>
      ) : null}

      {turn.toolCalls.length > 0 ? (
        <div className="mt-1.5">
          {turn.toolCalls.map((call, i) => (
            <ToolCallRow key={`${call.name}-${i}`} call={call} />
          ))}
        </div>
      ) : null}

      {turn.filesTouched.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-4">
          {turn.filesTouched.map((file) => (
            <span
              key={file.path}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono ${
                file.mode === "write" || file.mode === "both"
                  ? "bg-(--ok)/10 text-(--ok)"
                  : "bg-(--surface) text-(--dim)"
              }`}
              title={`${file.mode}: ${file.path}`}
            >
              <FileCode2 className="h-2.5 w-2.5 shrink-0" />
              <span className="max-w-[120px] truncate">{file.path.split("/").pop()}</span>
            </span>
          ))}
        </div>
      ) : null}

      {turn.attachments.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-4">
          {turn.attachments.map((att) => (
            <AttachmentChip key={att.id} attachment={att} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function appendBoundedSample(samples: number[], value: number): number[] {
  return samples.length >= MAX_SPARKLINE_SAMPLES
    ? [...samples.slice(1), value]
    : [...samples, value];
}

function useContextSampleTrail(sessionId: string | null, latestPercent: number | null | undefined) {
  const samplesRef = useRef<number[]>([]);
  const prevContextRef = useRef<number | undefined>(undefined);
  const prevSessionIdRef = useRef<string | null>(null);

  const subscribe = useCallback(
    (_notify: () => void) => {
      if (sessionId !== prevSessionIdRef.current) {
        prevSessionIdRef.current = sessionId;
        prevContextRef.current = undefined;
        samplesRef.current = [];
      }
      if (latestPercent != null && latestPercent !== prevContextRef.current) {
        prevContextRef.current = latestPercent;
        samplesRef.current = appendBoundedSample(samplesRef.current, latestPercent);
      }
      return () => {};
    },
    [sessionId, latestPercent],
  );

  return useSyncExternalStore(
    subscribe,
    () => samplesRef.current,
    () => EMPTY_SAMPLES,
  );
}

export function InspectorPanel({ session }: { session: Session | null }) {
  const turns = useMemo(() => (session ? deriveTurnTimeline(session) : []), [session]);
  const [toolOnly, setToolOnly] = useState(false);
  const toggleToolOnly = useCallback(() => setToolOnly((v) => !v), []);

  const displayTurns = useMemo(
    () => (toolOnly ? turns.filter((t) => t.toolCalls.length > 0) : turns),
    [turns, toolOnly],
  );

  const latestContextPercent = turns[turns.length - 1]?.contextPercentAfter;
  const contextSamples = useContextSampleTrail(session?.id ?? null, latestContextPercent);

  if (!session) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center p-6">
        <span className="text-[length:var(--fs-sm)] text-(--dim)">No active session</span>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <SessionSummaryHeader
        turns={turns}
        contextSamples={contextSamples}
        toolOnly={toolOnly}
        onToggleToolOnly={toggleToolOnly}
      />
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {displayTurns.length === 0 ? (
          <div className="py-8 text-center text-[length:var(--fs-sm)] text-(--dim)">
            {turns.length === 0 ? "No turns yet" : "No turns with tool calls"}
          </div>
        ) : (
          displayTurns.map((turn) => <TurnRow key={turn.assistantMessageId} turn={turn} />)
        )}
      </div>
    </section>
  );
}
