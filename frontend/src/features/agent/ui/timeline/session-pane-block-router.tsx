import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ChevronRight, Copy, GitFork } from "@/ui/icon-registry";
import type {
  AssistantBlock,
  ChatMessage,
  ChatMessageAttachment,
  EventBlock,
  TextBlock,
  ThinkingBlock,
  ToolBlock,
} from "@/features/agent/messages";
import { useReasoningVisible } from "@/features/agent/messages/use-reasoning-visible";
import { traceAgentReasoning } from "@/features/agent/trace-reasoning";
import { AssistantMarkdown } from "@/features/agent/ui/assistant-markdown";
import { ToolBlockView } from "@/features/agent/ui/timeline/tool-block-view";
import {
  classifyTool,
  compactToolText,
  toolArg,
  toolVerb,
} from "@/features/agent/ui/timeline/tool-metadata";

type ActivitySegment =
  | { kind: "reasoning"; id: string; blocks: ThinkingBlock[] }
  | { kind: "tools"; id: string; blocks: ToolBlock[] };

type RoutedBlock =
  | { kind: "activity-group"; id: string; segments: ActivitySegment[] }
  | { kind: "content"; block: TextBlock }
  | { kind: "event"; block: EventBlock };

// Every run of thinking + tool blocks between two content/event blocks folds
// into ONE activity-group whose segments stay in chronological order. The group
// renders as a single Codex-style "Worked for…" disclosure — reasoning never
// gets its own top-level row, so the chat alternates cleanly between answer text
// and one collapsible work summary. Ids derive from the first underlying block
// so collapse state survives snapshot rebuilds and ordering normalization.
export function groupAssistantBlocks(blocks: AssistantBlock[]): RoutedBlock[] {
  const routed: RoutedBlock[] = [];
  let segments: ActivitySegment[] = [];
  let reasoning: ThinkingBlock[] = [];
  let tools: ToolBlock[] = [];

  const flushReasoning = () => {
    if (reasoning.length === 0) return;
    segments.push({
      kind: "reasoning",
      id: `reasoning-seg-${reasoning[0]?.id ?? segments.length}`,
      blocks: reasoning,
    });
    reasoning = [];
  };
  const flushTools = () => {
    if (tools.length === 0) return;
    segments.push({
      kind: "tools",
      id: `tools-seg-${tools[0]?.id ?? segments.length}`,
      blocks: tools,
    });
    tools = [];
  };
  const flushActivity = () => {
    flushReasoning();
    flushTools();
    if (segments.length === 0) return;
    routed.push({
      kind: "activity-group",
      id: `activity-${segments[0]?.id ?? routed.length}`,
      segments,
    });
    segments = [];
  };

  for (const block of blocks) {
    if (block.kind === "tool") {
      flushReasoning();
      tools.push(block);
      continue;
    }
    if (block.kind === "thinking") {
      flushTools();
      reasoning.push(block);
      continue;
    }
    if (block.kind === "text" && block.text.trim() === "") {
      // Empty text blocks shouldn't split a run — keep the surrounding activity together.
      continue;
    }
    flushActivity();
    if (block.kind === "text") {
      routed.push({ kind: "content", block });
    } else {
      routed.push({ kind: "event", block });
    }
  }
  flushActivity();

  return routed;
}

// Per-content-block memo. `appendDelta` preserves the reference of every
// non-trailing text block during streaming, so prior content blocks skip
// re-rendering entirely once the assistant moves on past them.
const MemoContentBlock = memo(function MemoContentBlock({ block }: { block: TextBlock }) {
  return <AssistantMarkdown text={block.text} />;
});

const MemoEventBlock = memo(function MemoEventBlock({ block }: { block: EventBlock }) {
  return <EventBlockView block={block} />;
});

function SessionPaneBlockRouterInner({
  message,
  live,
  running,
  onForkSession,
}: {
  message: ChatMessage;
  live: boolean;
  running: boolean;
  onForkSession?: () => void;
}) {
  if (message.role === "user") {
    return <UserMessage message={message} />;
  }

  return (
    <AssistantBlocks
      blocks={message.blocks ?? EMPTY_BLOCKS}
      live={live}
      running={running}
      onForkSession={onForkSession}
    />
  );
}

const EMPTY_BLOCKS: AssistantBlock[] = [];

// `AssistantBlocks` isolates the (memoised) routed-block computation so that
// re-renders triggered by non-block message fields (e.g. `text`, `timestamp`,
// `attachments`) don't redo `groupAssistantBlocks`. Re-runs only on a new
// `blocks` array identity — which `appendDelta` only produces when the
// assistant actually mutates a block.
const AssistantBlocks = memo(function AssistantBlocks({
  blocks,
  live,
  running,
  onForkSession,
}: {
  blocks: AssistantBlock[];
  live: boolean;
  running: boolean;
  onForkSession?: () => void;
}) {
  const routedBlocks = useMemo(() => groupAssistantBlocks(blocks), [blocks]);
  traceAgentReasoning("render.blocks", { blocks, routedBlocks });
  const copyText = useMemo(() => assistantContentCopyText(blocks), [blocks]);
  const lastContentIndex = useMemo(
    () => routedBlocks.findLastIndex((item) => item.kind === "content"),
    [routedBlocks],
  );
  const showActions = !running && copyText.trim().length > 0 && lastContentIndex >= 0;
  const hasActivity = routedBlocks.some((item) => item.kind === "activity-group");
  // The work phase ends the moment the final response starts streaming.
  const working = live && lastContentIndex === -1;

  if (routedBlocks.length === 0) {
    return <article className="min-w-0" />;
  }

  const nodes: ReactNode[] = [];
  routedBlocks.forEach((item, index) => {
    if (index === lastContentIndex && hasActivity) {
      nodes.push(
        <WorkedForDivider key="turn-divider" working={working} hasActivity={hasActivity} />,
      );
    }
    if (item.kind === "activity-group") {
      nodes.push(
        <AssistantActivityGroup
          key={item.id}
          segments={item.segments}
          live={live && index === routedBlocks.length - 1}
        />,
      );
      return;
    }
    if (item.kind === "content") {
      nodes.push(
        <div key={item.block.id} className="min-w-0">
          <MemoContentBlock block={item.block} />
          {showActions && index === lastContentIndex ? (
            <AssistantMessageActions copyText={copyText} onForkSession={onForkSession} />
          ) : null}
        </div>,
      );
      return;
    }
    nodes.push(<MemoEventBlock key={item.block.id} block={item.block} />);
  });
  // No content yet: the divider ticks "Working for…" below the activity.
  if (lastContentIndex === -1 && live && hasActivity) {
    nodes.push(<WorkedForDivider key="turn-divider" working={working} hasActivity={hasActivity} />);
  }

  return (
    <article className="min-w-0">
      <div className="flex flex-col gap-3">{nodes}</div>
    </article>
  );
});

export const SessionPaneBlockRouter = memo(SessionPaneBlockRouterInner);
SessionPaneBlockRouter.displayName = "SessionPaneBlockRouter";

/* ── Turn status divider ──────────────────────────────────────────────────
   Codex separates agent activity from the final response with a labeled rule:
   "Working for 1m 23s" while streaming, frozen to "Worked for 1m 23s" once the
   response begins. Durations only exist for turns observed live in this mount —
   history reloads render without the divider, matching Codex's own fallback. */

function useNowTicker(active: boolean): number {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!active) return () => undefined;
      const id = window.setInterval(onStoreChange, 1_000);
      return () => window.clearInterval(id);
    },
    [active],
  );
  return useSyncExternalStore(
    subscribe,
    () => (active ? Math.floor(Date.now() / 1_000) : 0),
    () => 0,
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

function WorkedForDivider({ working, hasActivity }: { working: boolean; hasActivity: boolean }) {
  // Refs (not state) so the start/end capture never triggers extra renders;
  // both are write-once per mount.
  const startRef = useRef<number | null>(null);
  const endRef = useRef<number | null>(null);
  if (working && startRef.current === null) startRef.current = Date.now();
  if (!working && startRef.current !== null && endRef.current === null) {
    endRef.current = Date.now();
  }
  useNowTicker(working);

  if (startRef.current === null) return null;
  const elapsedMs = (endRef.current ?? Date.now()) - startRef.current;
  if (!hasActivity && elapsedMs < 2_000) return null;
  const label = working
    ? `Working for ${formatElapsed(elapsedMs)}`
    : `Worked for ${formatElapsed(elapsedMs)}`;

  return (
    <div className="flex items-center gap-3 py-1 text-[length:var(--fs-sm)] text-(--fg)/35">
      <span className="h-px flex-1 bg-(--border)/60" />
      <span className={working ? "codex-shimmer-text" : undefined}>{label}</span>
      <span className="h-px flex-1 bg-(--border)/60" />
    </div>
  );
}

function UserAttachmentPreview({ attachment }: { attachment: ChatMessageAttachment }) {
  const size = formatAttachmentSize(attachment.size);
  const title = `${attachment.name} · ${attachment.type} · ${size}${attachment.path ? ` · ${attachment.path}` : ""}`;
  if (attachment.previewKind === "image" && attachment.previewUrl) {
    return (
      <figure
        className="overflow-hidden rounded-md border border-(--border) bg-black/40 p-0"
        title={title}
      >
        <img
          src={attachment.previewUrl}
          alt={attachment.name}
          // Reserve vertical space so the async image decode doesn't grow from
          // 0 → up to 288px and shove the whole transcript below it (the scroller
          // runs overflow-anchor:none, so nothing absorbs that reflow).
          className="max-h-72 min-h-40 w-full object-contain"
        />
        <figcaption className="truncate px-2 py-1 font-mono text-[length:var(--fs-xs)] text-(--dim)">
          {attachment.name} · {size}
        </figcaption>
      </figure>
    );
  }
  if (attachment.previewKind === "video" && attachment.previewUrl) {
    return (
      <figure
        className="overflow-hidden rounded-md border border-(--border) bg-black/40 p-0"
        title={title}
      >
        <video src={attachment.previewUrl} className="max-h-72 w-full" controls />
        <figcaption className="truncate px-2 py-1 font-mono text-[length:var(--fs-xs)] text-(--dim)">
          {attachment.name} · {size}
        </figcaption>
      </figure>
    );
  }
  if (attachment.previewKind === "audio" && attachment.previewUrl) {
    return (
      <figure className="rounded-md border border-(--border) bg-black/30 p-2" title={title}>
        <audio src={attachment.previewUrl} className="w-full" controls />
        <figcaption className="truncate pt-1 font-mono text-[length:var(--fs-xs)] text-(--dim)">
          {attachment.name} · {size}
        </figcaption>
      </figure>
    );
  }
  if (attachment.previewKind === "pdf" && attachment.previewUrl) {
    return (
      <div
        className="overflow-hidden rounded-md border border-(--border) bg-black/40 p-0"
        title={title}
      >
        <iframe
          src={attachment.previewUrl}
          title={attachment.name}
          className="h-72 w-full border-0 bg-(--bg)"
        />
        <div className="truncate px-2 py-1 font-mono text-[length:var(--fs-xs)] text-(--dim)">
          {attachment.name} · {size}
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-md border border-(--border) bg-black/30 px-2 py-1 font-mono text-[length:var(--fs-xs)] text-(--dim)"
      title={title}
    >
      <span className="truncate">{attachment.name}</span>
      <span className="shrink-0">{size}</span>
    </div>
  );
}

function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ── Activity rendering ───────────────────────────────────────────────────
   Codex shows agent actions inline as one-line rows rather than hiding them
   behind a single summary. Reasoning bursts become "Thinking"/"Thought"
   disclosures; consecutive reads and searches compact into one "Explored"
   accordion; everything else (commands, edits) stands on its own row. */

type ActivityItem =
  | { kind: "reasoning"; id: string; block: ThinkingBlock }
  | { kind: "tool"; id: string; block: ToolBlock }
  | { kind: "explore"; id: string; blocks: ToolBlock[] };

// A reasoning segment is one continuous burst of model chain-of-thought (no
// tools between). Some backends stream it as MANY tiny thinking blocks, and a
// reasoning model can leak stub fragments (e.g. a lone "The") or empty parts,
// which previously rendered as a stack of duplicate, nested "Thought" rows.
// Collapse the whole burst into ONE disclosure: drop empties and consecutive
// duplicates, then join the distinct fragments.
function mergeReasoningBlocks(blocks: ThinkingBlock[]): ThinkingBlock | null {
  const parts: string[] = [];
  for (const block of blocks) {
    const text = block.text.trim();
    if (!text || parts[parts.length - 1] === text) continue;
    parts.push(text);
  }
  if (parts.length === 0) return null;
  return { kind: "thinking", id: blocks[0]?.id ?? "reasoning", text: parts.join("\n\n") };
}

function buildActivityItems(segments: ActivitySegment[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const segment of segments) {
    if (segment.kind === "reasoning") {
      const merged = mergeReasoningBlocks(segment.blocks);
      if (merged) items.push({ kind: "reasoning", id: merged.id, block: merged });
      continue;
    }
    let run: ToolBlock[] = [];
    const flushRun = () => {
      if (run.length >= 2) {
        items.push({ kind: "explore", id: `explore-${run[0]?.id}`, blocks: run });
      } else {
        for (const block of run) items.push({ kind: "tool", id: block.id, block });
      }
      run = [];
    };
    for (const block of segment.blocks) {
      const kind = classifyTool(block);
      if (kind === "read" || kind === "search") {
        run.push(block);
        continue;
      }
      flushRun();
      items.push({ kind: "tool", id: block.id, block });
    }
    flushRun();
  }
  return items;
}

/* Every run of thoughts+tools between two content blocks collapses into ONE
   disclosure. Collapsed it reads as a Codex-style summary ("Ran 6 commands ·
   read 3 files"); while streaming it shows a shimmering "Working" plus a live
   preview of the current action. Expanding reveals the individual rows. */
const AssistantActivityGroup = memo(function AssistantActivityGroup({
  segments,
  live,
}: {
  segments: ActivitySegment[];
  // `live`: this group is the actively streaming block (drives the "Working"
  // shimmer + live preview).
  live: boolean;
}) {
  // Global "show reasoning" preference: when off, drop reasoning segments so the
  // group shows tools only (and disappears entirely for thinking-only turns).
  const showReasoning = useReasoningVisible();
  const visibleSegments = useMemo(
    () => (showReasoning ? segments : segments.filter((segment) => segment.kind !== "reasoning")),
    [segments, showReasoning],
  );
  const items = useMemo(() => buildActivityItems(visibleSegments), [visibleSegments]);
  // Keep live work collapsed by default. Streaming reasoning/tool previews can
  // grow by hundreds of pixels and update every token; auto-opening them makes
  // the transcript visibly jump and flicker. The summary row stays one line and
  // users can still expand details explicitly.
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? false;
  const working =
    live &&
    visibleSegments.some(
      (segment) =>
        segment.kind === "tools" && segment.blocks.some((block) => block.status === "running"),
    );
  const summary = useMemo(() => summarizeActivity(visibleSegments), [visibleSegments]);
  const preview = live ? activityPreview(visibleSegments) : null;

  // Reasoning hidden + nothing else to show → render nothing. The turn's
  // "Working for…"/"Worked for…" divider still signals that the model worked.
  if (items.length === 0) return null;

  // A reasoning-only burst (no tools) needs no "Worked for…" wrapper, which
  // would nest a "Thought" summary around a "Thought" disclosure. Render the
  // single merged thought directly so the chat shows one clean, top-level row.
  if (items.every((item) => item.kind === "reasoning")) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        {items.map((item) =>
          item.kind === "reasoning" ? (
            <ReasoningDisclosure key={item.id} block={item.block} active={working || live} />
          ) : null,
        )}
      </div>
    );
  }

  return (
    <details className="group min-w-0" open={expanded}>
      <summary
        className="flex min-h-6 min-w-0 cursor-pointer list-none items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-(--hover) [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault();
          setUserExpanded(!expanded);
        }}
      >
        <span
          className={`shrink-0 text-[13px] font-medium leading-5 ${
            working || live ? "codex-shimmer-text" : "text-(--fg)/55"
          }`}
        >
          {working || live ? "Working" : summary}
        </span>
        {!expanded && (working || live) && preview ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--codex-chat-code-font-size)] leading-5 text-(--dim)/70">
            {preview}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <ChevronRight className="h-3 w-3 shrink-0 text-(--dim)/50 transition-transform group-open:rotate-90" />
      </summary>
      {expanded ? (
        <div className="mb-1.5 ml-2 mt-1 flex min-w-0 flex-col gap-0.5 border-l border-(--border)/50 pl-2">
          {items.map((item, index) => {
            const isLastItem = index === items.length - 1;
            if (item.kind === "reasoning") {
              return (
                <ReasoningDisclosure key={item.id} block={item.block} active={live && isLastItem} />
              );
            }
            if (item.kind === "explore") {
              return <ExploreAccordion key={item.id} blocks={item.blocks} live={live} />;
            }
            return <ToolBlockView key={item.id} block={item.block} />;
          })}
        </div>
      ) : null}
    </details>
  );
});

/* Codex's collapsed-turn summary: tool counts joined with " · ", first segment
   capitalized — "Ran 3 commands · edited 2 files · searched 4 times". */
function summarizeActivity(segments: ActivitySegment[]): string {
  let thoughts = 0;
  const counts: Record<string, number> = {};
  for (const segment of segments) {
    if (segment.kind === "reasoning") {
      thoughts += segment.blocks.length;
      continue;
    }
    for (const block of segment.blocks) {
      const kind = classifyTool(block);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  const pieces: string[] = [];
  const add = (count: number | undefined, verb: string, singular: string, plural: string) => {
    if (!count) return;
    pieces.push(`${verb} ${count} ${count === 1 ? singular : plural}`);
  };
  add(counts["exec"], "ran", "command", "commands");
  add(counts["edit"], "edited", "file", "files");
  add(counts["read"], "read", "file", "files");
  add(counts["search"], "searched", "time", "times");
  add(counts["browser"], "browsed", "page", "pages");
  add(counts["generic"], "called", "tool", "tools");
  if (pieces.length === 0) return thoughts > 0 ? "Thought" : "Worked";
  const joined = pieces.join(" · ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/* Latest in-flight action, for the live preview in the collapsed summary.
   Reasoning is deliberately excluded — model chain-of-thought should never
   leak into the visible chat, even as a one-line preview; the user can still
   expand the activity group to read it if they want. */
function activityPreview(segments: ActivitySegment[]): string | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!segment || segment.kind === "reasoning") continue;
    const runningTool = [...segment.blocks].reverse().find((block) => block.status === "running");
    const latestTool = runningTool ?? segment.blocks[segment.blocks.length - 1];
    if (latestTool) {
      const detail = toolArg(latestTool, ["cmd", "command", "path", "file_path", "query", "url"]);
      return [toolVerb(latestTool), compactToolText(detail, 72)].filter(Boolean).join(" ");
    }
  }
  return null;
}

/* Each thinking block is its own collapsible disclosure, shown inline between
   tool calls inside the activity group. It stays collapsed by default even while
   live so streaming thought text doesn't continuously resize the transcript. */
function ReasoningDisclosure({ block, active }: { block: ThinkingBlock; active: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? false;
  return (
    <details className="group min-w-0" open={open}>
      <summary
        className="flex min-h-6 cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-(--hover) [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault();
          setUserOpen(!open);
        }}
      >
        <span
          className={`text-[13px] font-medium leading-5 ${
            active ? "codex-shimmer-text" : "text-(--fg)/55"
          }`}
        >
          {active ? "Thinking" : "Thought"}
        </span>
        <ChevronRight className="h-3 w-3 text-(--dim)/50 transition-transform group-open:rotate-90" />
      </summary>
      {open ? (
        <div className="mb-1.5 ml-1.5 mt-1 max-h-[320px] min-w-0 overflow-auto whitespace-pre-wrap border-l-2 border-(--border) pl-3 text-[13px] leading-[1.6] text-(--fg)/60">
          {block.text}
        </div>
      ) : null}
    </details>
  );
}

function ExploreAccordion({ blocks, live }: { blocks: ToolBlock[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const running = live && blocks.some((block) => block.status === "running");
  const counts = exploreCounts(blocks);
  return (
    <details className="group min-w-0" open={open}>
      <summary
        className="flex min-h-6 min-w-0 cursor-pointer list-none items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-(--hover) [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
        }}
      >
        <span
          className={`shrink-0 text-[13px] font-medium leading-5 ${
            running ? "codex-shimmer-text" : "text-(--fg)/55"
          }`}
        >
          {running ? "Exploring" : "Explored"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-(--dim)/80">
          {counts}
        </span>
        <ChevronRight className="h-3 w-3 shrink-0 text-(--dim)/50 transition-transform group-open:rotate-90" />
      </summary>
      {open ? (
        <div className="mb-1.5 ml-2 mt-1 flex min-w-0 flex-col gap-0.5 border-l border-(--border)/50 pl-2">
          {blocks.map((block) => (
            <ToolBlockView key={block.id} block={block} />
          ))}
        </div>
      ) : null}
    </details>
  );
}

function exploreCounts(blocks: ToolBlock[]): string {
  let files = 0;
  let searches = 0;
  for (const block of blocks) {
    if (classifyTool(block) === "search") searches += 1;
    else files += 1;
  }
  const pieces: string[] = [];
  if (files > 0) pieces.push(`${files} ${files === 1 ? "file" : "files"}`);
  if (searches > 0) pieces.push(`${searches} ${searches === 1 ? "search" : "searches"}`);
  return pieces.join(", ");
}

function assistantContentCopyText(blocks: AssistantBlock[]): string {
  return blocks
    .map((block) => (block.kind === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

function UserMessage({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!message.text.trim()) return;
    await navigator.clipboard.writeText(message.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_200);
  };
  // A quiet foreground-tinted block sized to its content, capped by the same
  // composer-width column and anchored to its right edge. A copy button reveals
  // on hover to the left of the bubble, mirroring the assistant's copy action.
  // A steer message shows dimmed the instant it's sent and brightens once the
  // runtime echoes it (the model is now seeing it). The transition makes that
  // hand-off read as "delivered" rather than a sudden pop-in.
  const pending = message.pending === true;
  return (
    <article className="group flex items-start justify-end gap-1">
      {message.text.trim() && !pending ? (
        <div className="mt-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <AssistantActionButton
            label={copied ? "Copied" : "Copy message"}
            onClick={() => void copy()}
          >
            <Copy className="h-3.5 w-3.5" />
          </AssistantActionButton>
        </div>
      ) : null}
      <div
        className={`min-w-0 max-w-full rounded-2xl bg-(--fg)/5 px-4 py-2.5 text-[length:var(--codex-chat-font-size)] leading-[1.625] text-(--fg)/90 transition-opacity duration-500 ${pending ? "opacity-45" : "opacity-100"}`}
      >
        <div className="whitespace-pre-wrap break-words">{message.text}</div>
        {message.attachments?.length ? (
          <div className="mt-2 grid gap-2">
            {message.attachments.map((attachment) => (
              <UserAttachmentPreview key={attachment.id} attachment={attachment} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function AssistantMessageActions({
  copyText,
  onForkSession,
}: {
  copyText: string;
  onForkSession?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!copyText.trim()) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_200);
  };
  return (
    <div className="mt-2 flex items-center gap-1 text-(--dim)/65">
      <AssistantActionButton
        label={copied ? "Copied" : "Copy response"}
        onClick={() => void copy()}
        disabled={!copyText.trim()}
      >
        <Copy className="h-3.5 w-3.5" />
      </AssistantActionButton>
      <AssistantActionButton
        label="Fork from this point"
        onClick={() => onForkSession?.()}
        disabled={!onForkSession}
      >
        <GitFork className="h-3.5 w-3.5" />
      </AssistantActionButton>
    </div>
  );
}

function AssistantActionButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-(--dim)/65 transition-colors hover:bg-(--surface) hover:text-(--fg)/85 disabled:pointer-events-none disabled:opacity-30"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function EventBlockView({ block }: { block: EventBlock }) {
  return (
    <div className="flex items-center gap-3 py-1 text-[length:var(--fs-sm)] text-(--fg)/35">
      <span className="h-px flex-1 bg-(--border)/60" />
      <span>{block.text}</span>
      <span className="h-px flex-1 bg-(--border)/60" />
    </div>
  );
}
