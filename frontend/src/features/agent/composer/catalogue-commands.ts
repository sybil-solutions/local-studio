// Bridges the external content catalogues into slash commands. Prompt templates
// and skills are discovered by the agent runtime from plugin sources (Local
// Studio bundled plugins, ~/.claude, ~/.codex, Codex.app plugin caches, …), so
// these providers are how plugins reach the composer without the core
// processor knowing anything about plugins.
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { ComposerCommand, ComposerCommandProvider } from "./command-types";

function commandName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export function promptTemplateCommandProvider(options: {
  templates: ComposerPromptTemplateRef[];
  applyTemplate: (row: ComposerPromptTemplateRef) => Promise<void>;
}): ComposerCommandProvider {
  return {
    id: "prompt-templates",
    commands: () =>
      options.templates.map(
        (template): ComposerCommand => ({
          id: `template:${template.id}`,
          name: commandName(template.name),
          title: template.name,
          description: template.description ?? "Load this prompt template",
          source: template.source ?? "templates",
          icon: "template",
          run: async (args) => {
            await options.applyTemplate(template);
            return args ? { kind: "set-input", input: args } : { kind: "handled" };
          },
        }),
      ),
  };
}

export function skillCommandProvider(options: {
  skills: ComposerSkillRef[];
  applySkill: (row: ComposerSkillRef) => Promise<void>;
}): ComposerCommandProvider {
  return {
    id: "skills",
    commands: () =>
      options.skills.map(
        (skill): ComposerCommand => ({
          id: `skill:${skill.id}`,
          name: commandName(skill.name),
          title: skill.name,
          description: "Load this skill for the next message",
          source: skill.source ?? "skills",
          icon: "skill",
          run: async (args) => {
            await options.applySkill(skill);
            return args ? { kind: "set-input", input: args } : { kind: "handled" };
          },
        }),
      ),
  };
}
