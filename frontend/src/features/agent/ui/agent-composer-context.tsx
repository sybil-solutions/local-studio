"use client";

import {
  AtSign,
  Boxes,
  CircleDot,
  Download,
  FilePenLine,
  FileText,
  Gauge,
  GitFork,
  Globe,
  Slash,
  Sparkles,
  TerminalSquare,
} from "@/ui/icon-registry";
import type {
  ComposerMention,
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { ComposerCommand } from "@/features/agent/composer/command-types";
import { CloseIcon } from "@/ui/icons";

export type FileMentionRow = {
  id: string;
  name: string;
  rel: string;
  path: string;
  source: string;
};

export type MentionRow =
  | { kind: "skill"; row: ComposerSkillRef }
  | { kind: "command"; row: ComposerCommand }
  | { kind: "file"; row: FileMentionRow };

export type LoadedContextKind = "skill" | "promptTemplate";

export function AgentLoadedContextTabs({
  skills,
  promptTemplates,
  onRemove,
}: {
  skills: ComposerSkillRef[];
  promptTemplates: ComposerPromptTemplateRef[];
  onRemove: (kind: LoadedContextKind, id: string) => void;
}) {
  if (skills.length + promptTemplates.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 pt-2 text-[length:var(--fs-sm)]">
      {skills.map((skill) => (
        <LoadedContextTab
          key={`skill-${skill.id}`}
          prefix="$"
          label={skill.name}
          title={skill.path}
          onRemove={() => onRemove("skill", skill.id)}
        />
      ))}
      {promptTemplates.map((template) => (
        <LoadedContextTab
          key={`template-${template.id}`}
          prefix="/"
          label={template.name}
          title={template.description ?? template.path}
          onRemove={() => onRemove("promptTemplate", template.id)}
        />
      ))}
    </div>
  );
}

export function AgentMentionPicker({
  mention,
  rows,
  activeIndex,
  onSelect,
}: {
  mention: ComposerMention | null;
  rows: MentionRow[];
  activeIndex: number;
  onSelect: (entry: MentionRow) => void;
}) {
  if (!mention) return null;

  return (
    <div className="px-1.5">
      {rows.length ? (
        <div className="grid gap-1">
          {rows.map((entry, index) => (
            <MentionRowItem
              key={entry.row.id}
              entry={entry}
              active={index === activeIndex}
              onSelect={() => onSelect(entry)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-(--border) px-3 py-3 text-center text-[length:var(--fs-sm)] text-(--dim)">
          No {emptyMentionLabel(mention.kind)} match{" "}
          <span className="font-mono text-(--fg)">{mention.query || "…"}</span>
        </div>
      )}
    </div>
  );
}

function LoadedContextTab({
  prefix,
  label,
  title,
  onRemove,
}: {
  prefix: "$" | "/";
  label: string;
  title?: string;
  onRemove: () => void;
}) {
  const meta = LOADED_TAB_META[prefix];
  return (
    <span
      className={`inline-flex max-w-[240px] items-center gap-1.5 rounded border px-2 py-1 text-[length:var(--fs-sm)] shadow-sm shadow-black/5 ${meta.classes}`}
      title={title ?? label}
    >
      <meta.Icon className="h-3 w-3 shrink-0" />
      <span className="truncate text-(--fg)">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="-mr-1 ml-0.5 rounded p-0.5 text-(--dim) hover:bg-black/10 hover:text-(--fg)"
        aria-label={`Unload ${prefix}${label}`}
        title={`Unload ${prefix}${label}`}
      >
        <CloseIcon className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

function MentionRowItem({
  entry,
  active,
  onSelect,
}: {
  entry: MentionRow;
  active: boolean;
  onSelect: () => void;
}) {
  // Command rows follow the Codex menu layout: title on the left, dim
  // right-aligned description filling the row.
  if (entry.kind === "command") {
    const Icon = BUILTIN_COMMAND_ICONS[entry.row.name] ?? COMMAND_ICONS[entry.row.icon];
    return (
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSelect}
        className={`flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-[7px] text-left ${
          active
            ? "bg-(--hover) text-(--fg)"
            : "text-(--dim) hover:bg-(--hover)/60 hover:text-(--fg)"
        }`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-(--dim)" />
        <span className="shrink-0 text-[length:var(--fs-base)] text-(--fg)/85">
          {entry.row.title}
        </span>
        {entry.row.description ? (
          <span className="ml-auto min-w-0 truncate pl-6 text-right text-[length:var(--fs-base)] text-(--fg)/45">
            {entry.row.description}
          </span>
        ) : null}
      </button>
    );
  }
  const kindMeta = MENTION_KIND_META[entry.kind];
  const Icon = entry.kind === "file" ? FileText : kindMeta.Icon;
  const accent = entry.kind === "file" ? "text-(--dim)" : kindMeta.accentClass;
  const title = entry.kind === "file" ? entry.row.rel : entry.row.name;
  const description = entry.kind === "file" ? entry.row.path : undefined;
  const source = entry.kind !== "file" ? (entry.row.source ?? "") : "";
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={`flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-[7px] text-left ${
        active ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:bg-(--hover)/60 hover:text-(--fg)"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${accent}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-[length:var(--fs-base)] text-(--fg)/85">{title}</span>
        </span>
        {description ? (
          <span className="block truncate text-[length:var(--fs-xs)] text-(--dim)">
            {description}
          </span>
        ) : null}
      </span>
      {source ? (
        <span
          className="hidden truncate font-mono text-[length:var(--fs-2xs)] uppercase tracking-wide text-(--dim) sm:inline"
          title={source}
        >
          {source}
        </span>
      ) : null}
    </button>
  );
}

function emptyMentionLabel(kind: ComposerMention["kind"]) {
  if (kind === "file") return "files";
  if (kind === "skill") return "skills";
  return "commands";
}

const COMMAND_ICONS: Record<ComposerCommand["icon"], typeof Slash> = {
  command: Slash,
  template: FileText,
  skill: Sparkles,
};

// Codex leads each command row with a semantic glyph, not a uniform slash.
const BUILTIN_COMMAND_ICONS: Record<string, typeof Slash> = {
  compact: CircleDot,
  status: Gauge,
  browser: Globe,
  canvas: FilePenLine,
  plugins: Boxes,
  terminal: TerminalSquare,
  fork: GitFork,
  export: Download,
};

const LOADED_TAB_META: Record<"$" | "/", { Icon: typeof AtSign; classes: string }> = {
  $: {
    Icon: Sparkles,
    classes: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  "/": {
    Icon: Slash,
    classes: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  },
};

const MENTION_KIND_META: Record<
  "file" | "skill" | "command",
  {
    title: string;
    hint: string;
    Icon: typeof AtSign;
    accentClass: string;
  }
> = {
  file: {
    title: "Files",
    hint: "Type to filter · Enter to attach",
    Icon: AtSign,
    accentClass: "text-sky-300",
  },
  skill: {
    title: "Skills",
    hint: "Pick a skill to instruct the agent",
    Icon: Sparkles,
    accentClass: "text-violet-300",
  },
  command: {
    title: "Commands",
    hint: "Run a command · load a template or skill",
    Icon: Slash,
    accentClass: "text-amber-300",
  },
};
