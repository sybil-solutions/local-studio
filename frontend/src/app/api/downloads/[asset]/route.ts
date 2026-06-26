import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DownloadAsset = {
  contentType: string;
  pattern: RegExp;
};

const assets: Record<string, DownloadAsset> = {
  "mac-dmg": {
    contentType: "application/x-apple-diskimage",
    pattern: /^Local Studio-\d+\.\d+\.\d+-arm64\.dmg$/,
  },
  "mac-zip": {
    contentType: "application/zip",
    pattern: /^Local Studio-\d+\.\d+\.\d+-arm64-mac\.zip$/,
  },
};

async function findNewestAsset(asset: DownloadAsset): Promise<string | null> {
  const distDir = path.join(process.cwd(), "dist-desktop");
  let entries: string[];
  try {
    entries = await readdir(distDir);
  } catch {
    return null;
  }

  const matches = await Promise.all(
    entries
      .filter((entry) => asset.pattern.test(entry))
      .map(async (entry) => {
        const filePath = path.join(distDir, entry);
        const fileStat = await stat(filePath).catch(() => null);
        return fileStat?.isFile() ? { filePath, mtimeMs: fileStat.mtimeMs } : null;
      }),
  );

  return (
    matches
      .filter((match): match is { filePath: string; mtimeMs: number } => Boolean(match))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath ?? null
  );
}

export async function GET(_request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset: assetName } = await params;
  const asset = assets[assetName];
  if (!asset) {
    return NextResponse.json({ error: "Unknown download asset" }, { status: 404 });
  }

  const filePath = await findNewestAsset(asset);
  if (!filePath) {
    return NextResponse.json({ error: "Download artifact not found" }, { status: 404 });
  }

  const fileStat = await stat(filePath);
  const fileName = path.basename(filePath);
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;

  return new Response(stream, {
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(fileStat.size),
      "Content-Type": asset.contentType,
      "Cache-Control": "private, max-age=60",
    },
  });
}
