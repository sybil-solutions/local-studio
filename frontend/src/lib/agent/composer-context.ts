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
  appConfigPath?: string;
  appIds?: string[];
  appPath?: string;
};

export type ComposerSkillRef = {
  id: string;
  name: string;
  source?: string;
  path?: string;
  instructions?: string;
};

export type ComposerMention = {
  kind: "plugin" | "skill";
  query: string;
  start: number;
  end: number;
};

export function activeComposerPlugins(plugins: ComposerPluginRef[] = []): ComposerPluginRef[] {
  return plugins.filter((plugin) => plugin.enabled !== false);
}

export function detectComposerMention(value: string, caret = value.length): ComposerMention | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const beforeCaret = value.slice(0, safeCaret);
  const match = /(^|\s)([@$])([^\n@$]{0,80})$/.exec(beforeCaret);
  if (!match) return null;
  const token = `${match[2]}${match[3] ?? ""}`;
  return {
    kind: match[2] === "@" ? "plugin" : "skill",
    query: (match[3] ?? "").trimStart(),
    start: safeCaret - token.length,
    end: safeCaret,
  };
}

export function replaceComposerMention(
  value: string,
  mention: ComposerMention,
  label: string,
): string {
  const before = value.slice(0, mention.start);
  const after = value.slice(mention.end);
  const prefix = before && !/\s$/.test(before) ? `${before} ` : before;
  const suffix = after && !/^\s/.test(after) ? ` ${after}` : after;
  return `${prefix}${mention.kind === "plugin" ? "@" : "$"}${label} ${suffix}`.trimStart();
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
  return [
    "Preserve this selected composer context after compaction.",
    ...lines,
  ].join("\n");
}

function selectedContextLines(
  plugins: ComposerPluginRef[] = [],
  skills: ComposerSkillRef[] = [],
): string[] {
  const lines: string[] = [];
  const enabledPlugins = activeComposerPlugins(plugins);
  if (enabledPlugins.length) {
    lines.push(`Enabled plugins: ${enabledPlugins.map(pluginRefLabel).join(", ")}.`);
    for (const plugin of enabledPlugins) {
      const label = pluginRefLabel(plugin);
      const summary = plugin.shortDescription ?? plugin.description;
      if (summary) lines.push(`Plugin ${label}: ${summary}`);
      if (plugin.capabilities?.length) {
        lines.push(`Plugin ${label} capabilities: ${plugin.capabilities.join(", ")}`);
      }
      if (plugin.defaultPrompts?.length) {
        lines.push(
          `Plugin ${label} default prompts: ${plugin.defaultPrompts.slice(0, 2).join(" | ")}`,
        );
      }
      if (plugin.appIds?.length) {
        lines.push(`Plugin ${label} declares app connectors: ${plugin.appIds.join(", ")}`);
      }
    }
    if (enabledPlugins.some((plugin) => plugin.name.includes("browser-use"))) {
      lines.push("Browser-use is enabled; use browser tools when the task requires page control.");
    }
    if (enabledPlugins.some((plugin) => plugin.name.includes("computer-use"))) {
      lines.push(
        "Computer-use is selected; call mcp_plugin_status before desktop control and use computer-use tools only if the MCP status is ready.",
      );
    }
  }
  if (skills.length) {
    lines.push("Loaded skills:");
    for (const skill of skills) {
      const label = `$${skill.name}${skill.path ? ` (${skill.path})` : ""}`;
      lines.push(skill.instructions ? `${label}\n${skill.instructions}` : label);
    }
  }
  return lines;
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
