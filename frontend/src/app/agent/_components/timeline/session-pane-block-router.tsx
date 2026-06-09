import { memo, useMemo, useState, type ReactNode } from "react";
import { Copy, GitFork, Search } from "lucide-react";
import type {
  AssistantBlock,
  ChatMessage,
  ChatMessageAttachment,
  EventBlock,
  TextBlock,
  ThinkingBlock,
  ToolBlock,
} from "@/lib/agent/session";
import { traceAgentReasoning } from "@/lib/agent/trace-reasoning";
import { AssistantMarkdown } from "../assistant-markdown";
import { ToolBlockView } from "./tool-block-view";
import {
  classifyTool,
  compactToolText,
  fileBasename,
  humanizeToolName,
  toolArg,
} from "./tool-metadata";

type ActivitySegment =
  | { kind: "reasoning"; id: string; blocks: ThinkingBlock[] }
  | { kind: "tools"; id: string; blocks: ToolBlock[] };

type RoutedBlock =
  | { kind: "activity-group"; id: string; segments: ActivitySegment[] }
  | { kind: "content"; block: TextBlock }
  | { kind: "event"; block: EventBlock };

export function groupAssistantBlocks(blocks: AssistantBlock[]): RoutedBlock[] {
  const routed: RoutedBlock[] = [];
  const activitySegments: ActivitySegment[] = [];
  let reasoningGroup: ThinkingBlock[] = [];
  let toolGroup: ToolBlock[] = [];

  // Segment ids come from underlying block ids so collapsed reasoning state
  // survives snapshot rebuilds and ordering normalization during long streams.
  const flushReasoningSegment = () => {
    if (reasoningGroup.length === 0) return;
    activitySegments.push({
      kind: "reasoning",
      id: `reasoning-${reasoningGroup[0]?.id ?? activitySegments.length}`,
      blocks: reasoningGroup,
    });
    reasoningGroup = [];
  };

  const flushToolSegment = () => {
    if (toolGroup.length === 0) return;
    activitySegments.push({
      kind: "tools",
      id: `tools-${toolGroup[0]?.id ?? activitySegments.length}`,
      blocks: toolGroup,
    });
    toolGroup = [];
  };

  const flushActivityGroup = () => {
    flushReasoningSegment();
    flushToolSegment();
    if (activitySegments.length === 0) return;
    routed.push({
      kind: "activity-group",
      id: `activity-${activitySegments[0]?.id ?? routed.length}`,
      segments: activitySegments.splice(0),
    });
  };

  for (const block of blocks) {
    if (block.kind === "tool") {
      flushReasoningSegment();
      toolGroup.push(block);
      continue;
    }
    if (block.kind === "thinking") {
      flushToolSegment();
      reasoningGroup.push(block);
      continue;
    }
    if (block.kind === "text" && block.text.trim() === "") {
      // Empty text blocks shouldn't split an activity group — keep reasoning+tools together.
      continue;
    }
    flushActivityGroup();
    if (block.kind === "text") {
      routed.push({ kind: "content", block });
    } else {
      routed.push({ kind: "event", block });
    }
  }
  flushActivityGroup();

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
    return (
      <article className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-(--surface-2)/70 px-3.5 py-2 text-[length:var(--fs-xs)] leading-[1.55] tracking-normal text-(--fg)/95">
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

  return (
    <article className="min-w-0">
      {routedBlocks.length === 0 ? null : (
        <div className="flex flex-col gap-3.5">
          {routedBlocks.map((item, index) => {
            if (item.kind === "activity-group") {
              return <AssistantActivityGroup key={item.id} segments={item.segments} live={live} />;
            }
            if (item.kind === "content") {
              return (
                <div key={item.block.id} className="min-w-0">
                  <MemoContentBlock block={item.block} />
                  {showActions && index === lastContentIndex ? (
                    <AssistantMessageActions copyText={copyText} onForkSession={onForkSession} />
                  ) : null}
                </div>
              );
            }
            return <MemoEventBlock key={item.block.id} block={item.block} />;
          })}
        </div>
      )}
    </article>
  );
});

export const SessionPaneBlockRouter = memo(SessionPaneBlockRouterInner);
SessionPaneBlockRouter.displayName = "SessionPaneBlockRouter";

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
          className="max-h-72 w-full object-contain"
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

const AssistantActivityGroup = memo(function AssistantActivityGroup({
  segments,
  live,
}: {
  segments: ActivitySegment[];
  live: boolean;
}) {
  // A tool only counts as "active" while the session is actually streaming.
  // Once the turn ends, a block left in "running" (e.g. an errored call, or a
  // stream that dropped its tool_execution_end) must not show a perpetual badge.
  const hasActiveTool =
    live &&
    segments.some(
      (segment) =>
        segment.kind === "tools" && segment.blocks.some((block) => block.status === "running"),
    );
  // Default collapsed: tool calls + reasoning are progress detail, not the
  // primary signal. The summary row already shows what happened ("Explored 1
  // search, read 2 files") plus a live "running" badge while a tool is in
  // flight, so the timeline stays scannable. Users can click to expand.
  const [expanded, setExpanded] = useState(false);
  const preview = activityPreview(segments);

  return (
    <details className="group min-w-0 overflow-hidden" open={expanded}>
      <summary
        className="flex min-h-7 min-w-0 cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 text-[length:var(--fs-xs)] leading-4 text-(--dim)/75 transition-colors hover:bg-(--hover) hover:text-(--fg)/80 [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault();
          setExpanded((value) => !value);
        }}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-(--dim)/50" />
        <span className="shrink-0 font-medium text-(--fg)/50">{activityLabel(segments)}</span>
        {!expanded ? (
          <span
            className={`agent-activity-preview min-w-0 flex-1 truncate text-(--dim)/50 ${hasActiveTool ? "agent-activity-preview-running" : ""}`}
            data-preview={preview}
          >
            {preview}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {hasActiveTool ? (
          <span className="shrink-0 text-[length:var(--fs-2xs)] font-medium text-(--accent)/60">
            running
          </span>
        ) : null}
      </summary>
      {expanded ? (
        <div
          className="ml-3 mt-2 flex min-w-0 cursor-pointer flex-col gap-1.5 border-l border-(--border)/50 pl-3"
          onClick={(event) => {
            // Collapse when the user clicks anywhere in the reasoning area, but
            // not when clicking a tool section (kept interactive) or when they
            // were selecting text.
            if (window.getSelection()?.toString()) return;
            if ((event.target as HTMLElement).closest("[data-activity-tool]")) return;
            setExpanded(false);
          }}
        >
          {segments.flatMap(activitySegmentItems).map((item) => (
            <ActivityTreeItem key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </details>
  );
});

type ActivityTreeItem =
  | { kind: "reasoning"; id: string; block: ThinkingBlock }
  | { kind: "tool"; id: string; block: ToolBlock };

function activitySegmentItems(segment: ActivitySegment): ActivityTreeItem[] {
  if (segment.kind === "reasoning") {
    return segment.blocks.map((block) => ({ kind: "reasoning", id: block.id, block }));
  }
  return segment.blocks.map((block) => ({ kind: "tool", id: block.id, block }));
}

function ActivityTreeItem({ item }: { item: ActivityTreeItem }) {
  if (item.kind === "reasoning") return <ReasoningLeaf block={item.block} />;
  // Tool sections stay interactive: clicks here must not collapse the group.
  return (
    <div data-activity-tool onClick={(event) => event.stopPropagation()}>
      <ToolBlockView block={item.block} />
    </div>
  );
}

function ReasoningLeaf({ block }: { block: ThinkingBlock }) {
  return (
    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap px-3 py-1.5 font-mono text-[length:var(--fs-xs)] leading-[1.6] text-(--dim)/80">
      {block.text}
    </pre>
  );
}

function assistantContentCopyText(blocks: AssistantBlock[]): string {
  return blocks
    .map((block) => (block.kind === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");
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
        label="Fork session"
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
    <div className="flex items-center gap-3 py-2 text-[length:var(--fs-2xs)] text-(--dim)/70">
      <span className="h-px flex-1 bg-(--border)/50" />
      <span className="font-medium">{block.text}</span>
      <span className="h-px flex-1 bg-(--border)/50" />
    </div>
  );
}

function activityLabel(segments: ActivitySegment[]): string {
  const reasoningCount = segments
    .filter((segment) => segment.kind === "reasoning")
    .reduce((count, segment) => count + segment.blocks.length, 0);
  const tools = segments
    .filter((segment) => segment.kind === "tools")
    .flatMap((segment) => segment.blocks);
  const toolCount = tools.length;
  const toolSummary = summarizeTools(tools);
  const pieces = [];
  if (reasoningCount > 0)
    pieces.push(reasoningCount === 1 ? "Reasoned" : `${reasoningCount} reasoning`);
  if (toolSummary) pieces.push(toolSummary);
  if (!toolSummary && toolCount > 0) pieces.push(toolCount === 1 ? "1 tool" : `${toolCount} tools`);
  return pieces.join(", ");
}

function summarizeTools(blocks: ToolBlock[]): string {
  const counts = blocks.reduce<Record<string, number>>((acc, block) => {
    const kind = classifyTool(block);
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});
  return [
    pluralAction(counts.search, "Explored", "search", "searches"),
    pluralAction(counts.read, "read", "file", "files"),
    pluralAction(counts.exec, "ran", "command", "commands"),
    pluralAction(counts.edit, "edited", "file", "files"),
    pluralAction(counts.browser, "used", "browser", "browser"),
  ]
    .filter(Boolean)
    .join(", ");
}

function pluralAction(
  count: number | undefined,
  verb: string,
  singular: string,
  plural: string,
): string | null {
  if (!count) return null;
  return `${verb} ${count} ${count === 1 ? singular : plural}`;
}

function activityPreview(segments: ActivitySegment[]): string {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!segment) continue;
    if (segment.kind === "tools") {
      const runningTool = [...segment.blocks].reverse().find((block) => block.status === "running");
      const latestTool = runningTool ?? segment.blocks[segment.blocks.length - 1];
      if (latestTool) return toolPreview(latestTool);
      continue;
    }
    const latestReasoning = segment.blocks[segment.blocks.length - 1];
    const preview = latestReasoning ? compactToolText(latestReasoning.text, 96) : null;
    if (preview) return preview;
  }
  return "";
}

function toolPreview(block: ToolBlock): string {
  const path = toolArg(block, [
    "path",
    "file_path",
    "filePath",
    "file",
    "filename",
    "target_file",
    "uri",
    "ref_id",
  ]);
  const query = toolArg(block, ["query", "q", "pattern", "search", "search_query", "needle"]);
  const command = toolArg(block, ["cmd", "command", "script", "shell", "input"]);
  const basename = fileBasename(path);

  switch (classifyTool(block)) {
    case "edit":
      return basename ? `edit ${basename}` : humanizeToolName(block.name);
    case "read":
      return basename ? `read ${basename}` : humanizeToolName(block.name);
    case "search":
      return compactToolText(query, 42) ? `search ${compactToolText(query, 42)}` : "search";
    case "exec":
      return compactToolText(command, 42) ?? "command";
    case "browser":
      return "browser";
    default:
      return humanizeToolName(block.name);
  }
}
