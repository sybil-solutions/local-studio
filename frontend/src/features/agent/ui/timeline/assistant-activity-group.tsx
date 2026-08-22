import { memo, useMemo, useState } from "react";
import { PreviewScroll } from "@/ui";
import { ChevronRight } from "@/ui/icon-registry";
import type { ThinkingBlock, ToolBlock } from "@/features/agent/messages";
import type { ToolKind } from "@/features/agent/ui/timeline/tool-metadata";
import { useReasoningVisible } from "@/features/agent/messages/session-prefs";
import { TOOL_ICONS, ToolBlockView } from "@/features/agent/ui/timeline/tool-block-view";
import {
  buildActivityItems,
  exploreCounts,
  summarizeActivity,
  summaryIconKind,
  activityPreview,
  type ActivitySegment,
} from "@/features/agent/ui/timeline/activity-grouping";

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
          className={`text-[length:var(--fs-base)] font-normal leading-5 ${
            active ? "codex-shimmer-text" : "text-(--fg)/48"
          }`}
        >
          {active ? "Thinking" : "Thought"}
        </span>
        <ChevronRight className="h-3 w-3 text-(--dim)/50 transition-transform group-open:rotate-90" />
      </summary>
      {open ? (
        <PreviewScroll className="mb-1.5 ml-1.5 mt-1 whitespace-pre-wrap border-l-2 border-(--border) pl-3 text-[length:var(--fs-base)] leading-[1.625] text-(--fg)/60">
          {block.text}
        </PreviewScroll>
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
          className={`shrink-0 text-[length:var(--fs-base)] font-normal leading-5 ${
            running ? "codex-shimmer-text" : "text-(--fg)/48"
          }`}
        >
          {running ? "Exploring" : "Explored"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[length:var(--fs-base)] leading-5 text-(--hl2)">
          {counts}
        </span>
        <ChevronRight className="h-3 w-3 shrink-0 text-(--dim)/50 transition-transform group-open:rotate-90" />
      </summary>
      {open ? (
        <div className="mb-1.5 ml-2 mt-1 flex min-w-0 flex-col gap-0.5 border-l border-(--separator) pl-2">
          {blocks.map((block) => (
            <ToolBlockView key={block.id} block={block} />
          ))}
        </div>
      ) : null}
    </details>
  );
}

/* Every run of thoughts+tools between two content blocks collapses into ONE
   disclosure. Collapsed it reads as a Codex-style summary ("Ran 6 commands ·
   read 3 files"); while streaming it shows a shimmering "Working" plus a live
   preview of the current action. Expanding reveals the individual rows. */
export const AssistantActivityGroup = memo(function AssistantActivityGroup({
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
  const busy = working || live;
  const summary = useMemo(() => summarizeActivity(visibleSegments), [visibleSegments]);
  // One kind of tool -> that tool's glyph; a mixed turn -> the terminal glyph.
  const summaryIcon = useMemo(() => summaryIconKind(visibleSegments), [visibleSegments]);
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
            <ReasoningDisclosure key={item.id} block={item.block} active={busy} />
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
        {/* "Working" is a fixed short word and must never shrink, but the
            collapsed summary grows with the turn ("Ran 20 commands · edited 13
            files · …") and will not fit a phone column — let it truncate
            instead of forcing the row wider than the thread. */}
        {!(busy) ? <SummaryGlyph kind={summaryIcon} /> : null}
        <span
          className={`text-[length:var(--fs-base)] font-normal leading-5 ${
            busy ? "codex-shimmer-text shrink-0" : "min-w-0 flex-1 truncate"
          } ${busy ? "" : "text-(--fg)/48"}`}
        >
          {busy ? "Working" : summary}
        </span>
        {!expanded && (busy) && preview ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-(--dim)/70">
            <PreviewGlyph kind={preview.kind} verb={preview.verb} />
            <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--codex-chat-code-font-size)] leading-5">
              {preview.detail || preview.verb}
            </span>
          </span>
        ) : busy ? (
          <span className="min-w-0 flex-1" />
        ) : null}
        <ChevronRight className="h-3 w-3 shrink-0 text-(--dim)/50 transition-transform group-open:rotate-90" />
      </summary>
      {expanded ? (
        <div className="mb-1.5 ml-2 mt-1 flex min-w-0 flex-col gap-0.5 border-l border-(--separator) pl-2">
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

/** Leading glyph for the collapsed summary: the single tool kind's icon, the
 *  terminal icon for a mixed turn, nothing for reasoning-only. */
function SummaryGlyph({ kind }: { kind: ToolKind | null }) {
  if (!kind) return null;
  const Icon = TOOL_ICONS[kind];
  return <Icon className="h-3.5 w-3.5 shrink-0 text-(--fg)/40" strokeWidth={1.6} />;
}

function PreviewGlyph({ kind, verb }: { kind: ToolKind; verb: string }) {
  const Icon = TOOL_ICONS[kind];
  return <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={1.6} aria-label={verb} />;
}
