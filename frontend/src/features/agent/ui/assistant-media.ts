import { resolveFileOpenTarget } from "@/features/agent/ui/filesystem-panel-effects";

export type AssistantMediaKind = "image" | "video" | "audio";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

const IMAGE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);
const VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "mpeg", "mpg", "ogv", "webm"]);
const AUDIO_EXTENSIONS = new Set([
  "aac",
  "flac",
  "m4a",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
  "wave",
]);
const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS].join("|");
const MEDIA_TOKEN_PATTERN = new RegExp(
  `(^|[\\s([{\"'])([^\\s\\x60'\")<>]+\\.(?:${MEDIA_EXTENSIONS}))(?=$|[\\s)\\]}\",.!?;:])`,
  "gi",
);
const SKIPPED_MARKDOWN_NODES = new Set(["code", "inlineCode", "link", "image"]);

export function cleanFileReference(value: string): string {
  let clean = value.trim().replace(/^`+|`+$/g, "");
  if (/^file:\/\//i.test(clean)) {
    try {
      clean = decodeURIComponent(new URL(clean).pathname);
    } catch {
      clean = clean.replace(/^file:\/\//i, "");
    }
  } else {
    try {
      clean = decodeURIComponent(clean);
    } catch {
      return clean.replace(/:\d+(?::\d+)?$/, "");
    }
  }
  return clean.replace(/:\d+(?::\d+)?$/, "");
}

export function assistantMediaKind(value: string | undefined): AssistantMediaKind | null {
  if (!value || /^(?:https?|data|blob):/i.test(value.trim())) return null;
  const clean = cleanFileReference(value).split(/[?#]/, 1)[0] ?? "";
  const extension = /\.([A-Za-z0-9]+)$/.exec(clean)?.[1]?.toLowerCase();
  if (!extension) return null;
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return null;
}

export function assistantMediaSource(reference: string, cwd: string | null): string | null {
  if (!assistantMediaKind(reference)) return null;
  const target = resolveFileOpenTarget(cleanFileReference(reference), cwd);
  if (!target || target.kind !== "file") return null;
  return `/api/agent/fs/raw?cwd=${encodeURIComponent(target.root)}&path=${encodeURIComponent(target.rel)}`;
}

export function assistantMediaName(reference: string): string {
  const clean = cleanFileReference(reference).replace(/\/+$/, "");
  return clean.slice(clean.lastIndexOf("/") + 1) || clean;
}

function splitMediaReferences(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  MEDIA_TOKEN_PATTERN.lastIndex = 0;
  for (
    let match = MEDIA_TOKEN_PATTERN.exec(value);
    match;
    match = MEDIA_TOKEN_PATTERN.exec(value)
  ) {
    const prefix = match[1] ?? "";
    const reference = match[2] ?? "";
    if (!assistantMediaKind(reference)) continue;
    const start = match.index + prefix.length;
    if (start > cursor) nodes.push({ type: "text", value: value.slice(cursor, start) });
    nodes.push({
      type: "link",
      url: reference,
      children: [{ type: "text", value: reference }],
    });
    cursor = start + reference.length;
  }
  if (cursor === 0) return [{ type: "text", value }];
  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes;
}

function transformMarkdownNode(node: MarkdownNode): void {
  if (!node.children || SKIPPED_MARKDOWN_NODES.has(node.type)) return;
  node.children = node.children.flatMap((child) =>
    child.type === "text" && child.value ? splitMediaReferences(child.value) : [child],
  );
  for (const child of node.children) transformMarkdownNode(child);
}

export function remarkLocalMediaReferences() {
  return (tree: MarkdownNode) => transformMarkdownNode(tree);
}
