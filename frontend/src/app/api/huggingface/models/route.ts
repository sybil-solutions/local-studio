import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HF_MODELS = "https://huggingface.co/api/models";
const TIMEOUT_MS = 12_000;

// HF /api/models supports these query params. `filter` and `tags` are
// repeatable (AND logic); the route forwards all of them. `pipeline_tag` and
// `config` are forwarded so callers can filter by task / fetch architecture
// metadata. `full=true` returns `siblings` (file list with sizes) used for
// accurate VRAM sizing. (`direction` is intentionally omitted — HF rejects it.)
const ALLOWED_PARAMS = new Set([
  "author",
  "config",
  "filter",
  "full",
  "library",
  "limit",
  "offset",
  "pipeline_tag",
  "search",
  "sort",
  "tags",
]);

export async function GET(request: NextRequest) {
  const source = new URL(request.url);
  const target = new URL(HF_MODELS);
  for (const [key, value] of source.searchParams) {
    if (ALLOWED_PARAMS.has(key) && value.trim()) target.searchParams.append(key, value);
  }
  if (!target.searchParams.has("limit")) target.searchParams.set("limit", "50");
  if (!target.searchParams.has("full")) target.searchParams.set("full", "false");

  try {
    const response = await fetchWithTimeout(
      target.toString(),
      { headers: { accept: "application/json" } },
      TIMEOUT_MS,
    );
    const text = await response.text();
    if (!response.ok) {
      return NextResponse.json(
        { error: `Hugging Face returned ${response.status}.`, detail: text.slice(0, 500) },
        { status: 502 },
      );
    }
    const payload = JSON.parse(text) as unknown;
    const data = Array.isArray(payload) ? payload.map(normalizeModel) : payload;
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Hugging Face models.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function normalizeModel(model: unknown): Record<string, unknown> {
  const record = model && typeof model === "object" ? (model as Record<string, unknown>) : {};
  const modelId = String(record.modelId ?? record.id ?? "");
  // Compute total weight-file size from siblings when present (full=true).
  // Used for accurate VRAM sizing instead of the name-regex estimate.
  const siblings = Array.isArray(record.siblings) ? record.siblings : [];
  const weightBytes = siblings.reduce((sum: number, file) => {
    if (file && typeof file === "object") {
      const f = file as Record<string, unknown>;
      const rfilename = String(f.rfilename ?? "");
      if (
        /\.(safetensors|bin|pt|gguf|ggml|ot|model|npz|msgpack)(\.index\.json)?$/.test(rfilename)
      ) {
        return sum + Number(f.size ?? 0);
      }
    }
    return sum;
  }, 0);
  return {
    ...record,
    _id: String(record._id ?? modelId),
    modelId,
    downloads: Number(record.downloads ?? 0),
    likes: Number(record.likes ?? 0),
    tags: Array.isArray(record.tags) ? record.tags : [],
    private: Boolean(record.private),
    weightBytes: weightBytes || undefined,
  };
}
