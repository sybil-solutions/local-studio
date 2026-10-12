import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { matchSource, readCapped, sortedRows } from "./discovery-core";
import { resolveBundledPluginDirectory } from "./plugin-resources";

export type SkillRow = {
  id: string;
  name: string;
  source: string;
  path: string;
  instructions?: string;
};

export type SkillSource = {
  source: string;
  dir: string;
};

export function defaultSkillSources(): SkillSource[] {
  const home = homedir();
  const bundled = resolveBundledPluginDirectory();
  return [
    ...(bundled ? [{ source: "Local Studio", dir: bundled }] : []),
    { source: "~/.claude", dir: path.join(home, ".claude", "skills") },
    { source: "~/.claude", dir: path.join(home, ".claude", "plugins", "cache") },
    { source: "~/.pi", dir: path.join(home, ".pi", "skills") },
    { source: "~/.pi", dir: path.join(home, ".pi", "agent", "skills") },
    { source: "~/.codex", dir: path.join(home, ".codex", "skills") },
    { source: "~/.codex", dir: path.join(home, ".codex", "plugins", "cache") },
    { source: "~/.codex", dir: path.join(home, ".codex", "vendor_imports", "skills") },
    { source: "~/.factory", dir: path.join(home, ".factory", "skills") },
    { source: "~/.factory", dir: path.join(home, ".factory", "plugins", "cache") },
    { source: "~/.factory", dir: path.join(home, ".factory", "plugins") },
    { source: "~/.opencode", dir: path.join(home, ".opencode", "skills") },
    ...codexAppSkillSources(),
  ];
}

export function codexAppSkillSources(): SkillSource[] {
  return ["openai-bundled", "openai-curated", "openai-primary-runtime"].flatMap((source) => [
    {
      source,
      dir: path.join("/Applications", "Codex.app", "Contents", "Resources", "plugins", source),
    },
    {
      source,
      dir: path.join(
        "/Applications",
        "Codex.app",
        "Contents",
        "Resources",
        "plugins",
        source,
        "plugins",
      ),
    },
  ]);
}

function skillNameFromDir(dir: string): string {
  const parts = dir.split(path.sep);
  const skillsIndex = parts.lastIndexOf("skills");
  if (skillsIndex > 3 && parts.includes("plugins") && parts.includes("cache")) {
    const plugin = parts[skillsIndex - 2];
    const skill = parts[skillsIndex + 1] ?? path.basename(dir);
    if (plugin && skill) return `${plugin}:${skill.replace(/[-_]+/g, " ")}`.trim();
  }
  return path.basename(dir).replace(/[-_]+/g, " ").trim() || path.basename(dir);
}

export function loadSkillInstructions(
  skillPath: string,
  sources: SkillSource[] = defaultSkillSources(),
  maxChars = 6000,
): SkillRow | null {
  const resolved = path.resolve(skillPath);
  const source = matchSource(resolved, sources);
  if (!source) return null;
  const file = path.join(resolved, "SKILL.md");
  if (!existsSync(file)) return null;
  const instructions = readCapped(file, maxChars);
  if (instructions === null) return null;
  return {
    id: `${source.source}:${skillNameFromDir(resolved).toLowerCase()}`,
    name: skillNameFromDir(resolved),
    source: source.source,
    path: resolved,
    instructions,
  };
}

export function discoverSkills(
  sources: SkillSource[] = defaultSkillSources(),
  options: { maxDepth?: number } = {},
): SkillRow[] {
  const maxDepth = options.maxDepth ?? 9;
  const byName = new Map<string, SkillRow>();

  const visit = (dir: string, source: string, depth: number) => {
    if (depth > maxDepth || !existsSync(dir)) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes("SKILL.md")) {
      const name = skillNameFromDir(dir);
      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, { id: `${source}:${key}`, name, source, path: dir });
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") && depth > 0) continue;
      const candidate = path.join(dir, entry);
      try {
        if (statSync(candidate).isDirectory()) visit(candidate, source, depth + 1);
      } catch {}
    }
  };

  for (const { source, dir } of sources) visit(dir, source, 0);
  return sortedRows(byName);
}
