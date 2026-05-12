export type GitDiffPayload = {
  isRepo?: boolean;
  branch?: string | null;
  status?: string[];
  diff?: string;
  error?: string;
};

export type DiffLineKind = "meta" | "context" | "add" | "del";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
};

export type DiffFile = {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
};

const DIFF_LINE_CLASS_NAMES: Record<DiffLineKind, string> = {
  add: "bg-emerald-500/10 text-emerald-100",
  context: "text-(--fg)",
  del: "bg-red-500/10 text-red-100",
  meta: "bg-(--surface) text-(--accent)",
};

const DIFF_LINE_PREFIXES: Record<DiffLineKind, string> = {
  add: "+",
  context: " ",
  del: "-",
  meta: "",
};

/**
 * Parse unified git diff text into display-ready files and line metadata.
 * @param diff - Raw unified diff text.
 * @returns Parsed diff files.
 */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      current = {
        path: match?.[2] ?? line.replace("diff --git ", ""),
        additions: 0,
        deletions: 0,
        lines: [],
      };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = Number(match?.[1] ?? 0);
      newLine = Number(match?.[2] ?? 0);
      current.lines.push({ kind: "meta", text: line });
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      current.lines.push({ kind: "meta", text: line });
      continue;
    }
    if (line.startsWith("+")) {
      current.additions += 1;
      current.lines.push({ kind: "add", text: line.slice(1), newLine });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      current.deletions += 1;
      current.lines.push({ kind: "del", text: line.slice(1), oldLine });
      oldLine += 1;
      continue;
    }
    current.lines.push({
      kind: "context",
      text: line.startsWith(" ") ? line.slice(1) : line,
      oldLine,
      newLine,
    });
    oldLine += 1;
    newLine += 1;
  }

  return files;
}

/**
 * Resolve header copy for the git diff panel.
 * @param payload - Loaded git diff payload, if any.
 * @param cwd - Active project directory.
 * @returns Header label text.
 */
export function gitDiffHeaderTitle(payload: GitDiffPayload | null, cwd: string | null): string {
  if (payload?.branch) {
    return payload.branch;
  }
  return cwd ? "Working tree diff" : "No directory";
}

/**
 * Resolve a diff line row class from the line kind.
 * @param kind - Diff line kind.
 * @returns CSS class names for the row state.
 */
export function diffLineClassName(kind: DiffLineKind): string {
  return DIFF_LINE_CLASS_NAMES[kind];
}

/**
 * Resolve a visible diff line prefix from the line kind.
 * @param kind - Diff line kind.
 * @returns Prefix shown before line text.
 */
export function diffLinePrefix(kind: DiffLineKind): string {
  return DIFF_LINE_PREFIXES[kind];
}
