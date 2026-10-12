import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/api/http";
import type { HuggingFaceModelCardPayload } from "@/lib/huggingface";
import { isRecord } from "@/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HF_API = "https://huggingface.co/api/models";
const HF_RAW = "https://huggingface.co";
const TIMEOUT_MS = 10_000;
const MAX_README_CHARS = 12_000;

export async function GET(request: NextRequest) {
  const modelId = request.nextUrl.searchParams.get("modelId")?.trim() ?? "";
  if (!isValidModelId(modelId)) {
    return NextResponse.json({ error: "Invalid model id." }, { status: 400 });
  }

  try {
    const [metadata, readme] = await Promise.all([
      fetchJson(modelApiUrl(modelId)),
      fetchReadme(modelId),
    ]);
    const record = isRecord(metadata) ? metadata : {};
    const payload: HuggingFaceModelCardPayload = {
      modelId,
      author: stringValue(record.author),
      sha: stringValue(record.sha),
      downloads: numberValue(record.downloads),
      likes: numberValue(record.likes),
      tags: stringArray(record.tags),
      pipeline_tag: stringValue(record.pipeline_tag),
      library_name: stringValue(record.library_name),
      createdAt: stringValue(record.createdAt),
      lastModified: stringValue(record.lastModified),
      cardData: record.cardData && isRecord(record.cardData) ? record.cardData : undefined,
      siblings: Array.isArray(record.siblings)
        ? record.siblings.flatMap((sibling): Array<{ rfilename?: string; size?: number }> => {
            if (!isRecord(sibling)) return [];
            return [
              {
                rfilename: stringValue(sibling.rfilename),
                size: numberValue(sibling.size),
              },
            ];
          })
        : undefined,
      readme,
      url: `https://huggingface.co/${modelId}`,
    };
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load model card.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function isValidModelId(modelId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(modelId);
}

function modelApiUrl(modelId: string): string {
  return `${HF_API}/${modelId.split("/").map(encodeURIComponent).join("/")}?full=true&blobs=true`;
}

function readmeUrl(modelId: string): string {
  return `${HF_RAW}/${modelId.split("/").map(encodeURIComponent).join("/")}/raw/main/README.md`;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetchWithTimeout(
    url,
    { headers: { accept: "application/json" } },
    TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`Hugging Face returned ${response.status}.`);
  return response.json();
}

async function fetchReadme(modelId: string): Promise<string | undefined> {
  const response = await fetchWithTimeout(
    readmeUrl(modelId),
    {
      headers: { accept: "text/plain" },
    },
    TIMEOUT_MS,
  );
  if (!response.ok) return undefined;
  const text = await response.text();
  return text.slice(0, MAX_README_CHARS);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === "string");
  return out.length ? out : undefined;
}
