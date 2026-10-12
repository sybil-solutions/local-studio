import { NextRequest } from "next/server";
import path from "node:path";
import { Readable } from "node:stream";
import type { FileHandle } from "node:fs/promises";
import { openReadableFile } from "@/features/agent/fs-store";
import { requireApiAccess } from "@/lib/auth/guard";
import { errorMessage, jsonError, requireAbsoluteCwd } from "@/app/api/_lib/route-helpers";
import { parseByteRange } from "./byte-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INLINE_TYPES: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".ogv": "video/ogg",
  ".webm": "video/webm",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".wave": "audio/wav",
};

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const result = requireAbsoluteCwd(request);
  if (result.response) return result.response;
  const relPath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!relPath) return jsonError("path is required");
  let file: FileHandle | undefined;
  try {
    const opened = await openReadableFile(result.cwd, relPath);
    file = opened.file;
    const { size, modifiedAt } = opened;
    const name = path.basename(relPath);
    const inlineType = INLINE_TYPES[path.extname(relPath).toLowerCase()];
    const range = parseByteRange(request.headers.get("range"), size);
    if (range === null) {
      await file.close();
      file = undefined;
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}`, "accept-ranges": "bytes" },
      });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, size - 1);
    const stream = size > 0 ? Readable.toWeb(file.createReadStream({ start, end })) : null;
    if (stream) file = undefined;
    else {
      await file.close();
      file = undefined;
    }
    const headers: Record<string, string> = {
      "content-type": inlineType ?? "application/octet-stream",
      "content-length": String(size === 0 ? 0 : end - start + 1),
      "content-disposition": inlineType
        ? `inline; filename="${encodeURIComponent(name)}"`
        : `attachment; filename="${encodeURIComponent(name)}"`,
      "last-modified": modifiedAt.toUTCString(),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "accept-ranges": "bytes",
      "cross-origin-resource-policy": "same-origin",
    };
    if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    if (inlineType === "image/svg+xml") {
      headers["content-security-policy"] =
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";
    }
    return new Response(stream as ReadableStream<Uint8Array> | null, {
      status: range ? 206 : 200,
      headers: {
        ...headers,
      },
    });
  } catch (error) {
    await file?.close().catch(() => undefined);
    return jsonError(errorMessage(error, "Read failed"), 404);
  }
}
