// Skill/prompt-template refs, their sanitizers, and the selected-context
// prompt builders moved to shared/agent/composer-refs.ts so the agent runtime
// package's HTTP handlers (turn + compact) can share them; re-exported here
// for frontend callers. Mention detection and list filtering stay client-side.
export {
  sanitizeComposerSkills,
  sanitizeComposerPromptTemplates,
  selectedContextPrompt,
  selectedContextInstructions,
} from "@shared/agent/composer-refs";
export type { ComposerSkillRef, ComposerPromptTemplateRef } from "@shared/agent/composer-refs";

export type ComposerMention = {
  kind: "file" | "skill" | "command";
  query: string;
  start: number;
  end: number;
};

export function detectComposerMention(value: string, caret = value.length): ComposerMention | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const beforeCaret = value.slice(0, safeCaret);
  // `/` only triggers a command mention when it appears at the very start of
  // the composer (mirrors slash-command semantics from the Pi CLI / Claude
  // Code editors). This avoids false positives on prose like "and/or".
  const slashMatch = /^\/([^\n/]{0,80})$/.exec(beforeCaret);
  if (slashMatch) {
    const token = `/${slashMatch[1] ?? ""}`;
    return {
      kind: "command",
      query: (slashMatch[1] ?? "").trimStart(),
      start: safeCaret - token.length,
      end: safeCaret,
    };
  }
  const match = /(^|\s)([@$])([^\n@$]{0,80})$/.exec(beforeCaret);
  if (!match) return null;
  const token = `${match[2]}${match[3] ?? ""}`;
  const kind: ComposerMention["kind"] = match[2] === "@" ? "file" : "skill";
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
