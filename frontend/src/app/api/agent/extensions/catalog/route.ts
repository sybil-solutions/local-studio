import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pi packages are tagged on npm with the `pi-package` keyword. We use the
// public npm registry search API so we don't need a Pi-specific backend.
const NPM_SEARCH = "https://registry.npmjs.org/-/v1/search";

type NpmSearchObject = {
  package: {
    name: string;
    version: string;
    description?: string;
    keywords?: string[];
    publisher?: { username?: string };
    date?: string;
    links?: { npm?: string; homepage?: string; repository?: string };
  };
  score?: { final?: number };
  searchScore?: number;
  downloads?: { weekly?: number; monthly?: number };
};

type NpmSearchResponse = {
  total: number;
  objects: NpmSearchObject[];
};

export type CatalogEntry = {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  author: string;
  date: string;
  npm: string;
  repo?: string;
  homepage?: string;
  weeklyDownloads: number;
  kind: "extension" | "skill" | "prompt" | "theme" | "package";
};

function classify(keywords: string[]): CatalogEntry["kind"] {
  const set = new Set(keywords.map((k) => k.toLowerCase()));
  if (set.has("pi-extension")) return "extension";
  if (set.has("pi-skill")) return "skill";
  if (set.has("pi-prompt") || set.has("pi-prompt-template")) return "prompt";
  if (set.has("pi-theme")) return "theme";
  return "package";
}

function mapObject(obj: NpmSearchObject): CatalogEntry {
  const pkg = obj.package;
  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description ?? "",
    keywords: pkg.keywords ?? [],
    author: pkg.publisher?.username ?? "",
    date: pkg.date ?? "",
    npm: pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
    repo: pkg.links?.repository,
    homepage: pkg.links?.homepage,
    weeklyDownloads: obj.downloads?.weekly ?? 0,
    kind: classify(pkg.keywords ?? []),
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const size = Math.min(Number(url.searchParams.get("size") ?? 50), 100);
  const from = Math.max(Number(url.searchParams.get("from") ?? 0), 0);
  // npm search joins terms with AND; combine the keyword filter with the user
  // query so installs/skills/prompts/themes all share the same endpoint.
  const text = [query, "keywords:pi-package"].filter(Boolean).join(" ");
  const searchUrl = `${NPM_SEARCH}?text=${encodeURIComponent(text)}&size=${size}&from=${from}`;
  try {
    const response = await fetch(searchUrl, { headers: { accept: "application/json" } });
    if (!response.ok) {
      return NextResponse.json(
        { error: `npm registry returned ${response.status}` },
        { status: 502 },
      );
    }
    const payload = (await response.json()) as NpmSearchResponse;
    const entries = payload.objects.map(mapObject);
    return NextResponse.json({ total: payload.total, entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "catalog fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
