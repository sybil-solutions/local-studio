export type ComposerPluginRef = {
  id: string;
  name: string;
  displayName?: string;
  version?: string;
  path?: string;
  enabled?: boolean;
  description?: string;
  shortDescription?: string;
  source?: string;
  category?: string;
  capabilities?: string[];
  defaultPrompts?: string[];
  brandColor?: string;
  iconPath?: string;
  skillPath?: string;
  mcpConfigPath?: string;
  instructions?: string;
};

export type ComposerSkillRef = {
  id: string;
  name: string;
  source?: string;
  path?: string;
  instructions?: string;
};

export type ComposerPromptTemplateRef = {
  id: string;
  name: string;
  source?: string;
  path?: string;
  description?: string;
  argumentHint?: string;
};

export type ComposerMention = {
  kind: "plugin" | "skill" | "promptTemplate";
  query: string;
  start: number;
  end: number;
};

export function activeComposerPlugins(plugins: ComposerPluginRef[] = []): ComposerPluginRef[] {
  return plugins.filter((plugin) => plugin.enabled !== false);
}

export function activateComposerPlugin(plugin: ComposerPluginRef): ComposerPluginRef {
  return { ...plugin, enabled: true };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && Boolean(item));
  return strings.length ? strings : undefined;
}

export function sanitizeComposerPlugins(value: unknown): ComposerPluginRef[] {
  if (!Array.isArray(value)) return [];
  return activeComposerPlugins(
    value.flatMap((item): ComposerPluginRef[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const plugin: ComposerPluginRef = {
        id: stringField(record, "id") ?? "",
        name: stringField(record, "name") ?? "",
        displayName: stringField(record, "displayName"),
        version: stringField(record, "version"),
        path: stringField(record, "path"),
        enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
        description: stringField(record, "description"),
        shortDescription: stringField(record, "shortDescription"),
        source: stringField(record, "source"),
        category: stringField(record, "category"),
        capabilities: stringArrayField(record, "capabilities"),
        defaultPrompts: stringArrayField(record, "defaultPrompts"),
        brandColor: stringField(record, "brandColor"),
        iconPath: stringField(record, "iconPath"),
        skillPath: stringField(record, "skillPath"),
        mcpConfigPath: stringField(record, "mcpConfigPath"),
        instructions: stringField(record, "instructions"),
      };
      return plugin.name || plugin.id || plugin.path ? [plugin] : [];
    }),
  );
}

export function sanitizeComposerSkills(value: unknown): ComposerSkillRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ComposerSkillRef[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const skill: ComposerSkillRef = {
      id: stringField(record, "id") ?? "",
      name: stringField(record, "name") ?? "",
      source: stringField(record, "source"),
      path: stringField(record, "path"),
      instructions: stringField(record, "instructions"),
    };
    return skill.name || skill.id || skill.path ? [skill] : [];
  });
}

export function sanitizeComposerPromptTemplates(value: unknown): ComposerPromptTemplateRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ComposerPromptTemplateRef[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const template: ComposerPromptTemplateRef = {
      id: stringField(record, "id") ?? "",
      name: stringField(record, "name") ?? "",
      source: stringField(record, "source"),
      path: stringField(record, "path"),
      description: stringField(record, "description"),
      argumentHint: stringField(record, "argumentHint"),
    };
    return template.name || template.id || template.path ? [template] : [];
  });
}

export function detectComposerMention(value: string, caret = value.length): ComposerMention | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const beforeCaret = value.slice(0, safeCaret);
  // `/` only triggers a prompt-template mention when it appears at the very
  // start of the composer (mirrors slash-command semantics from the Pi CLI /
  // Claude Code editors). This avoids false positives on prose like "and/or".
  const slashMatch = /^\/([^\n/]{0,80})$/.exec(beforeCaret);
  if (slashMatch) {
    const token = `/${slashMatch[1] ?? ""}`;
    return {
      kind: "promptTemplate",
      query: (slashMatch[1] ?? "").trimStart(),
      start: safeCaret - token.length,
      end: safeCaret,
    };
  }
  const match = /(^|\s)([@$])([^\n@$]{0,80})$/.exec(beforeCaret);
  if (!match) return null;
  const token = `${match[2]}${match[3] ?? ""}`;
  const kind: ComposerMention["kind"] = match[2] === "@" ? "plugin" : "skill";
  return {
    kind,
    query: (match[3] ?? "").trimStart(),
    start: safeCaret - token.length,
    end: safeCaret,
  };
}

export function consumeComposerMention(value: string, mention: ComposerMention): string {
  const before = value.slice(0, mention.start).replace(/[ \t]+$/, "");
  const after = value.slice(mention.end).replace(/^[ \t]+/, "");
  if (!before) return after;
  if (!after) return before;
  return `${before} ${after}`;
}

export function selectedContextPrompt(
  text: string,
  plugins: ComposerPluginRef[] = [],
  skills: ComposerSkillRef[] = [],
): string {
  const lines = selectedContextLines(plugins, skills);
  if (!lines.length) return text;
  return [`Composer context:\n${lines.join("\n")}`, "User prompt:", text].join("\n\n");
}

export function selectedContextInstructions(
  plugins: ComposerPluginRef[] = [],
  skills: ComposerSkillRef[] = [],
): string | undefined {
  const lines = selectedContextLines(plugins, skills);
  if (!lines.length) return undefined;
  return ["Preserve this selected composer context after compaction.", ...lines].join("\n");
}

function selectedContextLines(
  plugins: ComposerPluginRef[] = [],
  skills: ComposerSkillRef[] = [],
): string[] {
  return [...selectedPluginContextLines(plugins), ...selectedSkillContextLines(skills)];
}

function selectedPluginContextLines(plugins: ComposerPluginRef[] = []): string[] {
  const lines: string[] = [];
  const enabledPlugins = activeComposerPlugins(plugins);
  if (!enabledPlugins.length) return lines;
  lines.push(`Enabled plugins: ${enabledPlugins.map(pluginRefLabel).join(", ")}.`);
  for (const plugin of enabledPlugins) lines.push(...pluginContextLines(plugin));
  return lines;
}

function pluginContextLines(plugin: ComposerPluginRef): string[] {
  const label = pluginRefLabel(plugin);
  const lines: string[] = [];
  const summary = plugin.shortDescription ?? plugin.description;
  if (summary) lines.push(`Plugin ${label}: ${summary}`);
  if (plugin.capabilities?.length) {
    lines.push(`Plugin ${label} capabilities: ${plugin.capabilities.join(", ")}`);
  }
  if (plugin.defaultPrompts?.length) {
    lines.push(`Plugin ${label} default prompts: ${plugin.defaultPrompts.slice(0, 2).join(" | ")}`);
  }
  if (plugin.instructions) lines.push(`Plugin ${label} instructions:\n${plugin.instructions}`);
  const runtime = pluginRuntimeDetails(plugin);
  if (runtime.length) lines.push(`Plugin ${label} runtime: ${runtime.join("; ")}`);
  return lines;
}

function selectedSkillContextLines(skills: ComposerSkillRef[] = []): string[] {
  if (!skills.length) return [];
  return ["Loaded skills:", ...skills.map(skillContextLine)];
}

function skillContextLine(skill: ComposerSkillRef): string {
  const label = `$${skill.name}${skill.path ? ` (${skill.path})` : ""}`;
  return skill.instructions ? `${label}\n${skill.instructions}` : label;
}

function pluginRuntimeDetails(plugin: ComposerPluginRef): string[] {
  return [
    plugin.path ? `plugin=${plugin.path}` : null,
    plugin.skillPath ? `skills=${plugin.skillPath}` : null,
    plugin.mcpConfigPath ? `mcp=${plugin.mcpConfigPath}` : null,
  ].filter((value): value is string => Boolean(value));
}

function pluginRefLabel(plugin: ComposerPluginRef): string {
  return plugin.source ? `@${plugin.name} (${plugin.source})` : `@${plugin.name}`;
}

function searchableText(row: {
  name: string;
  displayName?: string;
  source?: string;
  category?: string;
  shortDescription?: string;
}): string[] {
  return [row.name, row.displayName, row.source, row.category, row.shortDescription].filter(
    (value): value is string => Boolean(value),
  );
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

export function byQuery<
  T extends {
    name: string;
    displayName?: string;
    source?: string;
    category?: string;
    shortDescription?: string;
  },
>(rows: T[], query: string, limit = 8): T[] {
  const q = query.trim().toLowerCase();
  const nq = normalized(q);
  const scored = rows
    .map((row) => {
      const fields = searchableText(row).map((value) => value.toLowerCase());
      const normalizedFields = fields.map(normalized);
      const primary = row.name.toLowerCase();
      const display = row.displayName?.toLowerCase();
      const score = !q
        ? 2
        : primary === q ||
            display === q ||
            normalized(primary) === nq ||
            normalized(display ?? "") === nq
          ? 0
          : primary.startsWith(q) ||
              Boolean(display?.startsWith(q)) ||
              normalized(primary).startsWith(nq) ||
              normalized(display ?? "").startsWith(nq)
            ? 1
            : fields.some((field) => field.includes(q)) ||
                normalizedFields.some((field) => field.includes(nq))
              ? 2
              : 9;
      return { row, score };
    })
    .filter((item) => item.score < 9)
    .sort((a, b) => a.score - b.score || a.row.name.localeCompare(b.row.name));
  return scored.slice(0, limit).map((item) => item.row);
}
