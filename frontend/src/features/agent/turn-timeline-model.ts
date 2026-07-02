import type { ComposerSkillRef } from "@/features/agent/composer-context";
import type {
  AssistantBlock,
  ChatMessage,
  ChatMessageAttachment,
} from "@/features/agent/messages/types";
import type { Session } from "@/features/agent/runtime/types";
import {
  classifyTool,
  extractFromArgs,
  type ToolKind,
} from "@/features/agent/ui/timeline/tool-metadata";

export type ToolCallRecord = {
  name: string;
  kind: ToolKind;
  status: "running" | "done" | "error";
};

export type FileAccessMode = "read" | "write" | "both";

export type FileTouchedEntry = {
  path: string;
  mode: FileAccessMode;
};

export type AttachmentEntry = {
  id: string;
  name: string;
  type: string;
  size: number;
  previewKind?: ChatMessageAttachment["previewKind"];
  path?: string;
};

export type TurnRecord = {
  turnIndex: number;
  assistantMessageId: string;
  modelId?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  tokenTotal?: number;
  tokenDelta?: number;
  contextPercentAfter?: number | null;
  toolCalls: ToolCallRecord[];
  filesTouched: FileTouchedEntry[];
  attachments: AttachmentEntry[];
  activeSkills: ComposerSkillRef[];
};

const FILE_PATH_KEYS = ["path", "file_path", "filePath", "file", "filename"];

function isToolBlock(block: AssistantBlock): block is Extract<AssistantBlock, { kind: "tool" }> {
  return block.kind === "tool";
}

function extractFilesTouched(blocks: AssistantBlock[] | undefined): FileTouchedEntry[] {
  const byPath = new Map<string, FileAccessMode>();
  for (const block of blocks ?? []) {
    if (!isToolBlock(block)) continue;
    const path = extractFromArgs(block.args, block.argsText, FILE_PATH_KEYS);
    if (!path) continue;
    const mode: FileAccessMode = classifyTool(block) === "edit" ? "write" : "read";
    const existing = byPath.get(path);
    byPath.set(path, existing && existing !== mode ? "both" : mode);
  }
  return Array.from(byPath.entries()).map(([path, mode]) => ({ path, mode }));
}

function extractToolCalls(blocks: AssistantBlock[] | undefined): ToolCallRecord[] {
  const calls: ToolCallRecord[] = [];
  for (const block of blocks ?? []) {
    if (!isToolBlock(block)) continue;
    calls.push({
      name: block.name,
      kind: classifyTool(block),
      status: block.status,
    });
  }
  return calls;
}

function extractAttachments(msg: ChatMessage): AttachmentEntry[] {
  if (!msg.attachments?.length) return [];
  return msg.attachments.map((att) => ({
    id: att.id,
    name: att.name,
    type: att.type,
    size: att.size,
    previewKind: att.previewKind,
    path: att.path,
  }));
}

function parseTimestamp(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function attachLatestUsageSnapshot(turns: TurnRecord[], session: Session): void {
  const latestTurn = turns[turns.length - 1];
  if (!latestTurn) return;
  const tokenTotal = session.tokenStats?.current;
  latestTurn.tokenTotal = tokenTotal;
  if (turns.length === 1) latestTurn.tokenDelta = tokenTotal;
  latestTurn.contextPercentAfter = session.contextUsage?.percent ?? undefined;
}

export function deriveTurnTimeline(session: Session): TurnRecord[] {
  const assistantMessages = session.messages.filter(
    (msg): msg is ChatMessage & { role: "assistant" } => msg.role === "assistant",
  );

  const turns: TurnRecord[] = assistantMessages.map((msg, index) => {
    const nextMessage = session.messages[session.messages.indexOf(msg) + 1];
    const startedAt = parseTimestamp(msg.timestamp);
    const endedAt = nextMessage?.timestamp ? parseTimestamp(nextMessage.timestamp) : undefined;
    const durationMs = startedAt && endedAt ? endedAt.getTime() - startedAt.getTime() : undefined;

    return {
      turnIndex: index,
      assistantMessageId: msg.id,
      modelId: session.modelId,
      startedAt: msg.timestamp,
      endedAt: nextMessage?.timestamp,
      durationMs,
      toolCalls: extractToolCalls(msg.blocks),
      filesTouched: extractFilesTouched(msg.blocks),
      attachments: extractAttachments(msg),
      activeSkills: session.usedSkills ?? [],
    };
  });

  attachLatestUsageSnapshot(turns, session);
  return turns;
}
