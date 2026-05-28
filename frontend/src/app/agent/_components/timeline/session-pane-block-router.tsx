import { memo, useMemo, useState } from "react";
import { Search } from "lucide-react";
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

  const flushReasoningSegment = () => {
    if (reasoningGroup.length === 0) return;
    activitySegments.push({
      kind: "reasoning",
      id: `reasoning-${reasoningGroup[0]?.id ?? routed.length}`,
      blocks: reasoningGroup,
    });
    reasoningGroup = [];
  };

  const flushToolSegment = () => {
    if (toolGroup.length === 0) return;
    activitySegments.push({
      kind: "tools",
      id: `tools-${toolGroup[0]?.id ?? routed.length}`,
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

function SessionPaneBlockRouterInner({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <article className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-(--surface-2)/70 px-3.5 py-2 text-[10.4px] leading-[1.55] tracking-normal text-(--fg)/95">
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

  return <AssistantBlocks blocks={message.blocks ?? EMPTY_BLOCKS} />;
}

const EMPTY_BLOCKS: AssistantBlock[] = [];

// `AssistantBlocks` isolates the (memoised) routed-block computation so that
// re-renders triggered by non-block message fields (e.g. `text`, `timestamp`,
// `attachments`) don't redo `groupAssistantBlocks`. Re-runs only on a new
// `blocks` array identity — which `appendDelta` only produces when the
// assistant actually mutates a block.
const AssistantBlocks = memo(function AssistantBlocks({ blocks }: { blocks: AssistantBlock[] }) {
  const routedBlocks = useMemo(() => groupAssistantBlocks(blocks), [blocks]);
  traceAgentReasoning("render.blocks", { blocks, routedBlocks });

  return (
    <article className="min-w-0">
      {routedBlocks.length === 0 ? (
        <div className="text-[10.4px] leading-[16.8px] text-(--dim)">…</div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {routedBlocks.map((item) => {
            if (item.kind === "activity-group") {
              return <AssistantActivityGroup key={item.id} segments={item.segments} />;
            }
            if (item.kind === "content") {
              return <MemoContentBlock key={item.block.id} block={item.block} />;
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
        className="overflow-hidden rounded-md border border-(--border) bg-black/40"
        title={title}
      >
        <img
          src={attachment.previewUrl}
          alt={attachment.name}
          className="max-h-72 w-full object-contain"
        />
        <figcaption className="truncate px-2 py-1 font-mono text-[10px] text-(--dim)">
          {attachment.name} · {size}
        </figcaption>
      </figure>
    );
  }
  if (attachment.previewKind === "video" && attachment.previewUrl) {
    return (
      <figure
        className="overflow-hidden rounded-md border border-(--border) bg-black/40"
        title={title}
      >
        <video src={attachment.previewUrl} className="max-h-72 w-full" controls />
        <figcaption className="truncate px-2 py-1 font-mono text-[10px] text-(--dim)">
          {attachment.name} · {size}
        </figcaption>
      </figure>
    );
  }
  if (attachment.previewKind === "pdf" && attachment.previewUrl) {
    return (
      <div
        className="overflow-hidden rounded-md border border-(--border) bg-black/40"
        title={title}
      >
        <iframe
          src={attachment.previewUrl}
          title={attachment.name}
          className="h-72 w-full border-0 bg-(--bg)"
        />
        <div className="truncate px-2 py-1 font-mono text-[10px] text-(--dim)">
          {attachment.name} · {size}
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-md border border-(--border) bg-black/30 px-2 py-1 font-mono text-[10px] text-(--dim)"
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
}: {
  segments: ActivitySegment[];
}) {
  const hasActiveTool = segments.some(
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
        className="flex min-h-7 min-w-0 cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 text-[9.6px] leading-4 text-(--dim)/75 transition-colors hover:bg-(--hover) hover:text-(--fg)/80 [&::-webkit-details-marker]:hidden"
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
          <span className="shrink-0 text-[8.8px] font-medium text-(--accent)/60">running</span>
        ) : null}
      </summary>
      {expanded ? (
        <div className="ml-3 mt-2 flex min-w-0 flex-col gap-1.5 border-l border-(--border)/50 pl-3">
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
  return <ToolBlockView block={item.block} />;
}

function ReasoningLeaf({ block }: { block: ThinkingBlock }) {
  return (
    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap rounded-lg bg-(--surface)/40 px-3 py-2 font-mono text-[9.6px] leading-[1.6] text-(--dim)/80">
      {block.text}
    </pre>
  );
}

function EventBlockView({ block }: { block: EventBlock }) {
  return (
    <div className="flex items-center gap-3 py-2 text-[8.8px] text-(--dim)/70">
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
