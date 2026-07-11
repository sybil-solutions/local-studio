"use client";

import { AtSign, FileText, Plug, Slash, Sparkles } from "@/ui/icon-registry";
import type {
  ComposerMention,
  ComposerPluginRef,
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
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
  | { kind: "promptTemplate"; row: ComposerPromptTemplateRef }
  | { kind: "file"; row: FileMentionRow };

export type LoadedContextKind = "skill" | "promptTemplate" | "plugin";

export function AgentLoadedContextTabs({
  skills,
  promptTemplates,
  plugins,
  onRemove,
}: {
  skills: ComposerSkillRef[];
  promptTemplates: ComposerPromptTemplateRef[];
  plugins: ComposerPluginRef[];
  onRemove: (kind: LoadedContextKind, id: string) => void;
}) {
  if (skills.length + promptTemplates.length + plugins.length === 0) return null;

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
      {plugins.map((plugin) => (
        <LoadedContextTab
          key={`plugin-${plugin.id}`}
          prefix="#"
          label={plugin.name}
          title={plugin.description ?? plugin.name}
          onRemove={() => onRemove("plugin", plugin.id)}
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
    <div className="px-4 pt-2">
      <MentionPickerHeader kind={mention.kind} query={mention.query} />
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
  prefix: "$" | "/" | "#";
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

function MentionPickerHeader({
  kind,
  query,
}: {
  kind: "file" | "skill" | "promptTemplate";
  query: string;
}) {
  const meta = MENTION_KIND_META[kind];
  return (
    <div className="mb-1.5 flex items-center gap-2 border-b border-(--border)/60 pb-1.5 text-[length:var(--fs-sm)]">
      <meta.Icon className={`h-3.5 w-3.5 ${meta.accentClass}`} />
      <span className="font-medium text-(--fg)">{meta.title}</span>
      {query ? (
        <span className="font-mono text-[length:var(--fs-xs)] text-(--dim)">
          {query.length > 24 ? `${query.slice(0, 24)}…` : query}
        </span>
      ) : null}
      <span className="ml-auto truncate text-[length:var(--fs-xs)] text-(--dim)">{meta.hint}</span>
    </div>
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
  const kindMeta = MENTION_KIND_META[entry.kind];
  const Icon = entry.kind === "file" ? FileText : kindMeta.Icon;
  const accent = entry.kind === "file" ? "text-(--dim)" : kindMeta.accentClass;
  const title = mentionRowTitle(entry);
  const description = mentionRowDescription(entry);
  const source = entry.kind !== "file" ? (entry.row.source ?? "") : "";
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left ${
        active ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:bg-(--hover)/60 hover:text-(--fg)"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${accent}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-[length:var(--fs-md)] text-(--fg)">{title}</span>
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

function mentionRowTitle(entry: MentionRow): string {
  if (entry.kind === "file") return entry.row.rel;
  return entry.row.name;
}

function mentionRowDescription(entry: MentionRow): string | undefined {
  if (entry.kind === "file") return entry.row.path;
  if (entry.kind === "promptTemplate") return entry.row.description;
  return undefined;
}

function emptyMentionLabel(kind: ComposerMention["kind"]) {
  if (kind === "file") return "files";
  if (kind === "skill") return "skills";
  return "slash commands";
}

const LOADED_TAB_META: Record<"$" | "/" | "#", { Icon: typeof AtSign; classes: string }> = {
  $: {
    Icon: Sparkles,
    classes: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  "/": {
    Icon: Slash,
    classes: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  },
  "#": {
    Icon: Plug,
    classes: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  },
};

const MENTION_KIND_META: Record<
  "file" | "skill" | "promptTemplate",
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
  promptTemplate: {
    title: "Slash commands",
    hint: "Pick a prompt template",
    Icon: Slash,
    accentClass: "text-amber-300",
  },
};
