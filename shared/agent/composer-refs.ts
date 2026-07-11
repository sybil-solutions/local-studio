// Composer skill / prompt-template references and their sanitizers, plus the
// "selected context" prompt builders derived from them.
//
// Moved here from frontend/src/features/agent/composer-context.ts so the
// @local-studio/agent-runtime HTTP handlers (turn + compact) can share the
// exact sanitization logic with the frontend; the frontend module re-exports
// everything from this file for its client-side callers.

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

export type ComposerPluginRef = {
  id: string;
  name: string;
  description?: string;
  capabilities?: string[];
};

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
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

export function sanitizeComposerPlugins(value: unknown): ComposerPluginRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ComposerPluginRef[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const capabilities = Array.isArray(record.capabilities)
      ? record.capabilities.filter((entry): entry is string => typeof entry === "string")
      : undefined;
    const plugin: ComposerPluginRef = {
      id: stringField(record, "id") ?? "",
      name: stringField(record, "name") ?? "",
      description: stringField(record, "description"),
      capabilities,
    };
    return plugin.name || plugin.id ? [plugin] : [];
  });
}

export function selectedContextPrompt(
  text: string,
  skills: ComposerSkillRef[] = [],
  plugins: ComposerPluginRef[] = [],
): string {
  const lines = selectedContextLines(skills, plugins);
  if (!lines.length) return text;
  return [`Composer context:\n${lines.join("\n")}`, "User prompt:", text].join("\n\n");
}

export function selectedContextInstructions(
  skills: ComposerSkillRef[] = [],
  plugins: ComposerPluginRef[] = [],
): string | undefined {
  const lines = selectedContextLines(skills, plugins);
  if (!lines.length) return undefined;
  return ["Preserve this selected composer context after compaction.", ...lines].join("\n");
}

function selectedContextLines(
  skills: ComposerSkillRef[] = [],
  plugins: ComposerPluginRef[] = [],
): string[] {
  return [...selectedSkillContextLines(skills), ...selectedPluginContextLines(plugins)];
}

function selectedSkillContextLines(skills: ComposerSkillRef[] = []): string[] {
  if (!skills.length) return [];
  return ["Loaded skills:", ...skills.map(skillContextLine)];
}

function skillContextLine(skill: ComposerSkillRef): string {
  const label = `$${skill.name}${skill.path ? ` (${skill.path})` : ""}`;
  return skill.instructions ? `${label}\n${skill.instructions}` : label;
}

function selectedPluginContextLines(plugins: ComposerPluginRef[]): string[] {
  if (!plugins.length) return [];
  return [
    "Selected plugins:",
    ...plugins.map((plugin) => {
      const description = plugin.description?.replace(/[.!?]?$/, ".") ?? "Use its connected tools when relevant.";
      const capabilities = plugin.capabilities?.length
        ? ` Available capabilities: ${plugin.capabilities.join(", ")}.`
        : "";
      return `#${plugin.name}: ${description}${capabilities}`;
    }),
  ];
}
