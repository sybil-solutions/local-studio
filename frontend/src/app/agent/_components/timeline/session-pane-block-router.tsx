import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type {
  AssistantBlock,
  ChatMessage,
  ChatMessageAttachment,
  EventBlock,
  TextBlock,
  ThinkingBlock,
  ToolBlock,
} from "@/lib/agent/session";
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
  const content: RoutedBlock[] = [];
  const activitySegments: ActivitySegment[] = [];
  let reasoningGroup: ThinkingBlock[] = [];
  let toolGroup: ToolBlock[] = [];

  const flushReasoningSegment = () => {
    if (reasoningGroup.length === 0) return;
    activitySegments.push({
      kind: "reasoning",
      id: `reasoning-${reasoningGroup[0]?.id ?? content.length}`,
      blocks: reasoningGroup,
    });
    reasoningGroup = [];
  };

  const flushToolSegment = () => {
    if (toolGroup.length === 0) return;
    activitySegments.push({
      kind: "tools",
      id: `tools-${toolGroup[0]?.id ?? content.length}`,
      blocks: toolGroup,
    });
    toolGroup = [];
  };

  const flushActivityGroup = () => {
    flushReasoningSegment();
    flushToolSegment();
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
    flushActivityGroup();
    if (block.kind === "text") {
      content.push({ kind: "content", block });
    } else {
      content.push({ kind: "event", block });
    }
  }
  flushActivityGroup();

  return activitySegments.length > 0
    ? [
        {
          kind: "activity-group",
          id: `activity-${activitySegments[0]?.id ?? 0}`,
          segments: activitySegments,
        },
        ...content,
      ]
    : content;
}

export function SessionPaneBlockRouter({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <article className="flex justify-end">
        <div className="max-w-[72%] rounded-xl bg-(--surface) px-3.5 py-2 text-sm leading-6 text-(--fg)">
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

  const routedBlocks = groupAssistantBlocks(message.blocks ?? []);
  return (
    <article className="min-w-0">
      {routedBlocks.length === 0 ? (
        <div className="text-sm leading-6 text-(--dim)">…</div>
      ) : (
        <div className="flex flex-col gap-3">
          {routedBlocks.map((item) => {
            if (item.kind === "activity-group") {
              return <AssistantActivityGroup key={item.id} segments={item.segments} />;
            }
            if (item.kind === "content") {
              return <AssistantMarkdown key={item.block.id} text={item.block.text} />;
            }
            return <EventBlockView key={item.block.id} block={item.block} />;
          })}
        </div>
      )}
    </article>
  );
}

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
        <object data={attachment.previewUrl} type="application/pdf" className="h-72 w-full">
          <span className="block p-3 text-xs text-(--dim)">PDF preview unavailable.</span>
        </object>
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

function AssistantActivityGroup({ segments }: { segments: ActivitySegment[] }) {
  const hasActiveTool = segments.some(
    (segment) =>
      segment.kind === "tools" && segment.blocks.some((block) => block.status === "running"),
  );
  const isMixed =
    segments.some((segment) => segment.kind === "reasoning") &&
    segments.some((segment) => segment.kind === "tools");
  const [expanded, setExpanded] = useState(isMixed || hasActiveTool);
  const open = hasActiveTool || expanded;

  return (
    <details className="group min-w-0" open={open}>
      <summary
        className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-(--fg) hover:bg-(--hover) [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault();
          setExpanded((value) => !value);
        }}
      >
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-(--fg)/70 transition-transform ${open ? "rotate-180" : ""}`}
        />
        <span className="shrink-0 font-medium text-(--fg)/90">{activityLabel(segments)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-(--fg)/75">
          {activityPreview(segments)}
        </span>
        {hasActiveTool ? (
          <span className="shrink-0 text-[10px] text-(--accent)">running</span>
        ) : null}
      </summary>
      {open ? (
        <div className="ml-[0.8rem] mt-1.5 flex min-w-0 flex-col gap-2 border-l border-(--border)/70 pl-3">
          {segments.map((segment) => (
            <ActivitySegmentView key={segment.id} segment={segment} />
          ))}
        </div>
      ) : null}
    </details>
  );
}

function ActivitySegmentView({ segment }: { segment: ActivitySegment }) {
  if (segment.kind === "reasoning") return <ReasoningLeaf blocks={segment.blocks} />;
  return (
    <div className="grid gap-1.5">
      {segment.blocks.map((block) => (
        <ToolBlockView key={block.id} block={block} />
      ))}
    </div>
  );
}

function ReasoningLeaf({ blocks }: { blocks: ThinkingBlock[] }) {
  const text = blocks.map((block) => block.text).join("\n\n");
  return (
    <div className="text-xs">
      <div className="text-[11px] italic text-(--dim)">
        Reasoning{blocks.length > 1 ? ` · ${blocks.length}` : ""}
      </div>
      <pre className="mt-1 max-w-full whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-(--dim) [overflow-wrap:anywhere]">
        {text}
      </pre>
    </div>
  );
}

function EventBlockView({ block }: { block: EventBlock }) {
  return (
    <div className="flex items-center gap-3 py-1 text-[11px] text-(--dim)">
      <span className="h-px flex-1 bg-(--border)" />
      <span>{block.text}</span>
      <span className="h-px flex-1 bg-(--border)" />
    </div>
  );
}

function activityLabel(segments: ActivitySegment[]): string {
  const reasoningCount = segments
    .filter((segment) => segment.kind === "reasoning")
    .reduce((count, segment) => count + segment.blocks.length, 0);
  const toolCount = segments
    .filter((segment) => segment.kind === "tools")
    .reduce((count, segment) => count + segment.blocks.length, 0);
  const pieces = [];
  if (reasoningCount > 0)
    pieces.push(reasoningCount === 1 ? "Reasoning" : `${reasoningCount} reasoning`);
  if (toolCount > 0) pieces.push(toolCount === 1 ? "1 tool" : `${toolCount} tools`);
  return pieces.join(" + ");
}

function activityPreview(segments: ActivitySegment[]): string {
  const tools = segments.flatMap((segment) => (segment.kind === "tools" ? segment.blocks : []));
  if (tools.length > 0) return toolGroupPreview(tools);
  const reasoning = segments
    .flatMap((segment) => (segment.kind === "reasoning" ? segment.blocks : []))
    .map((block) => compactToolText(block.text, 72))
    .filter(Boolean);
  return reasoning.join(" · ");
}

function toolGroupPreview(blocks: ToolBlock[]): string {
  const previewItems = blocks.slice(0, 4).map(toolPreview);
  const remaining = blocks.length - previewItems.length;
  return `${previewItems.join(" · ")}${remaining > 0 ? ` · +${remaining} more` : ""}`;
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
