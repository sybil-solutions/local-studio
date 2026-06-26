// Discover prompt templates (.md files with a name/description front matter)
// that we expose alongside skills and plugins in the composer. Templates are
// passed to the SDK runtime via `resourceLoaderOptions.additionalPromptTemplatePaths`,
// so the agent can expand them like `/template-name` shortcuts. This mirrors
// the layout used by the Pi CLI and Claude Code so dropping a file in
// `<dataDir>/pi-agent/prompts/` or `~/.claude/prompts/` makes it discoverable
// without code changes.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";

export type PromptTemplateRow = {
  id: string;
  name: string;
  source: string;
  path: string;
  description?: string;
  argumentHint?: string;
};

export type PromptTemplateSource = {
  source: string;
  dir: string;
};

export function defaultPromptTemplateSources(): PromptTemplateSource[] {
  const home = homedir();
  return [
    { source: "local-studio", dir: path.join(resolveDataDir(), "pi-agent", "prompt-templates") },
    { source: "local-studio", dir: path.join(resolveDataDir(), "pi-agent", "prompts") },
    { source: "~/.pi", dir: path.join(home, ".pi", "prompts") },
    { source: "~/.pi", dir: path.join(home, ".pi", "agent", "prompts") },
    { source: "~/.claude", dir: path.join(home, ".claude", "prompts") },
    { source: "~/.codex", dir: path.join(home, ".codex", "prompts") },
  ];
}

function parseFrontMatter(content: string): {
  name?: string;
  description?: string;
  argumentHint?: string;
} {
  // Cheap YAML-like front matter parser — only supports the few keys we care
  // about, matches both `---\nname: ...\n---` and a single-line markdown
  // heading fallback.
  const match = /^---\s*\n([\s\S]*?)\n---/.exec(content);
  const result: { name?: string; description?: string; argumentHint?: string } = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line.trim());
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      const value = kv[2].trim().replace(/^"|"$/g, "");
      if (key === "name") result.name = value;
      else if (key === "description") result.description = value;
      else if (key === "argument-hint" || key === "argumenthint") result.argumentHint = value;
    }
  }
  return result;
}

function templateRowFromFile(
  filePath: string,
  source: string,
  defaultName?: string,
): PromptTemplateRow | null {
  if (!filePath.endsWith(".md")) return null;
  let raw = "";
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const meta = parseFrontMatter(raw);
  const baseName = defaultName ?? path.basename(filePath, ".md");
  const name = meta.name?.trim() || baseName;
  return {
    id: `${source}:${name.toLowerCase()}`,
    name,
    source,
    path: filePath,
    description: meta.description,
    argumentHint: meta.argumentHint,
  };
}

export function discoverPromptTemplates(
  sources: PromptTemplateSource[] = defaultPromptTemplateSources(),
): PromptTemplateRow[] {
  const byKey = new Map<string, PromptTemplateRow>();
  for (const { source, dir } of sources) {
    if (!existsSync(dir)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(dir, entry);
      try {
        if (!statSync(candidate).isFile()) continue;
      } catch {
        continue;
      }
      const row = templateRowFromFile(candidate, source);
      if (row && !byKey.has(row.id)) byKey.set(row.id, row);
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadPromptTemplateInstructions(
  templatePath: string,
  sources: PromptTemplateSource[] = defaultPromptTemplateSources(),
  maxChars = 6000,
): (PromptTemplateRow & { instructions: string }) | null {
  const resolved = path.resolve(templatePath);
  const match = sources.find((source) => {
    const dir = path.resolve(source.dir);
    const relative = path.relative(dir, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  if (!match) return null;
  const row = templateRowFromFile(resolved, match.source);
  if (!row) return null;
  try {
    const instructions = readFileSync(resolved, "utf8").slice(0, maxChars).trim();
    return { ...row, instructions };
  } catch {
    return null;
  }
}
