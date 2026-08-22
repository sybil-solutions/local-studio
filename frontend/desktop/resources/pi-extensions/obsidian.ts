// obsidian — the user's Obsidian vault, which is a folder of markdown files.
//
// That is the whole premise, and it is why this extension talks to no process
// and installs nothing on the Obsidian side: a vault has no server, no API and
// no lock. Obsidian is a viewer over a directory. Reading and writing the files
// directly is not a workaround, it is the supported shape — the app picks the
// changes up on its own.
//
// What a naive file-reader gets wrong, and what the code below therefore knows:
//
//   [[wikilinks]]   resolve by note NAME across the entire vault, not by
//                   relative path, and `[[Note|alias]]` / `[[Note#Heading]]`
//                   still point at `Note`. A link is a lookup, not a filename.
//   frontmatter     the `---` block at the top is metadata, not prose. Matching
//                   a query against it and calling that a body hit is wrong;
//                   the tags and aliases in it are worth exposing on their own.
//   #tags           also live inline in the body, so a note's tags are the
//                   union of both places.
//   .obsidian/      is the app's configuration — themes, hotkeys, workspace
//                   layout. It is never searched, never read as a note, and
//                   never written into.
//
// Writing to someone's notes is the part that has to be conservative. There is
// no delete tool and no overwrite tool: `obsidian_create` opens with the `wx`
// flag so the filesystem itself refuses an existing path, and `obsidian_append`
// refuses a path that does not exist. Every path a model supplies is resolved
// against the vault root and re-checked after symlinks, so no argument can
// reach a file outside the vault.
//
// Vault discovery is the runtime's job: it reads Obsidian's own obsidian.json
// and injects the result as LOCAL_STUDIO_OBSIDIAN_VAULTS, so this extension and
// the gate that decided to load it always agree on the same list. The env var
// is read at REGISTRATION, not import: pi caches the module per project
// directory and registers it per session, and a vault list pinned at import
// would survive the user switching vaults.

import { appendFile, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ToolResult } from "./bridge.ts";
import { Type, type Static, type TSchema } from "./schema.ts";

type Vault = {
  path: string;
  name: string;
  open: boolean;
  lastOpened: string | null;
};

const NOTE_EXT = ".md";
// A vault of a few thousand notes scans in well under a second; these bounds
// exist so a vault of a hundred thousand cannot stall a turn or bury the
// answer, and every tool that hits one says so in its result.
const MAX_NOTES = 5_000;
const MAX_NOTE_BYTES = 512 * 1024;
const MAX_OUTPUT_CHARS = 60_000;
const MAX_BODY_CHARS = 100_000;
const EXCERPTS_PER_NOTE = 3;
const EXCERPT_RADIUS = 70;

// ─── vault discovery ──────────────────────────────────────────────────────

function readVaults(): Vault[] {
  const injected = process.env.LOCAL_STUDIO_OBSIDIAN_VAULTS?.trim();
  if (!injected) return [];
  try {
    const parsed = JSON.parse(injected) as Vault[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const NO_VAULT =
  "No Obsidian vault found on this machine. Obsidian is probably not installed, or has never opened a vault. Say that plainly — do not guess at a notes folder and do not create one.";

/** A refusal is an answer, not a failure: a message the model can act on. */
class Refusal extends Error {}

function selectVault(vaults: Vault[], requested: string | undefined): Vault {
  if (vaults.length === 0) throw new Refusal(NO_VAULT);
  const wanted = requested?.trim();
  if (!wanted) return vaults[0]!;
  const byPath = vaults.find((vault) => path.resolve(vault.path) === path.resolve(wanted));
  if (byPath) return byPath;
  const byName = vaults.filter((vault) => vault.name.toLowerCase() === wanted.toLowerCase());
  if (byName.length === 1) return byName[0]!;
  const known = vaults.map((vault) => `${vault.name} (${vault.path})`).join(", ");
  if (byName.length > 1) {
    throw new Refusal(
      `More than one vault is named "${wanted}". Pass its full path instead: ${known}.`,
    );
  }
  throw new Refusal(`No vault called "${wanted}". Known vaults: ${known}.`);
}

type OpenVault = { vault: Vault; root: string };

/**
 * Resolve the vault root through symlinks ONCE, so every later containment
 * check compares real paths against a real root.
 */
async function openVault(vaults: Vault[], requested: string | undefined): Promise<OpenVault> {
  const vault = selectVault(vaults, requested);
  try {
    return { vault, root: await realpath(vault.path) };
  } catch {
    throw new Refusal(
      `The vault "${vault.name}" is listed at ${vault.path}, but that directory cannot be read right now — an external or cloud volume is probably not mounted.`,
    );
  }
}

// ─── path safety ──────────────────────────────────────────────────────────

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * A model-supplied note reference becomes an absolute path inside the vault, or
 * it becomes a refusal. Traversal is rejected outright rather than clamped: a
 * request for `../../.ssh/id_rsa` is not a slightly-wrong note name, and
 * quietly rewriting it to something valid would hide that.
 */
async function notePath(root: string, input: string): Promise<string> {
  const raw = input.trim();
  if (!raw) throw new Refusal("`note` is empty. Pass a vault-relative path or a note name.");
  if (path.isAbsolute(raw) || raw.startsWith("~")) {
    throw new Refusal(
      `"${raw}" is an absolute path. These tools take vault-relative paths ("Projects/Roadmap.md") or bare note names ("Roadmap"); the vault root is implicit.`,
    );
  }
  const withExt = raw.toLowerCase().endsWith(NOTE_EXT) ? raw : `${raw}${NOTE_EXT}`;
  const target = path.resolve(root, withExt);
  if (!isInside(root, target)) {
    throw new Refusal(
      `"${raw}" resolves outside the vault. These tools only touch files inside it.`,
    );
  }
  const hidden = path
    .relative(root, target)
    .split(path.sep)
    .find((segment) => segment.startsWith("."));
  if (hidden) {
    throw new Refusal(
      `"${raw}" is inside "${hidden}", which is not notes — .obsidian is the app's own configuration, .trash is deleted notes. These tools never read or write there.`,
    );
  }
  await assertRealPathInside(root, target);
  return target;
}

/**
 * The textual check above is defeated by a symlinked folder inside the vault,
 * so re-check the deepest part of the path that actually exists after resolving
 * links. A note being created does not exist yet; its parent directory does.
 */
async function assertRealPathInside(root: string, target: string): Promise<void> {
  let probe = target;
  for (;;) {
    try {
      const real = await realpath(probe);
      if (!isInside(root, real)) {
        throw new Refusal(
          `"${path.relative(root, target)}" leaves the vault through a symlink (it resolves to ${real}). Refused.`,
        );
      }
      return;
    } catch (error) {
      if (error instanceof Refusal) throw error;
      const parent = path.dirname(probe);
      if (parent === probe) return;
      probe = parent;
    }
  }
}

// ─── the vault as notes ───────────────────────────────────────────────────

type NoteFile = { rel: string; abs: string; name: string; modified: string; bytes: number };

/**
 * Every note in the vault. Dot-directories are skipped whole (.obsidian is
 * config, .trash is deleted notes, .git is not the user's writing), and so are
 * symlinks — a link pointing out of the vault would otherwise be read as if it
 * were in it.
 */
async function listNotes(root: string): Promise<{ notes: NoteFile[]; truncated: boolean }> {
  const notes: NoteFile[] = [];
  const queue: string[] = [""];
  let truncated = false;
  while (queue.length > 0) {
    const relDir = queue.shift()!;
    const entries = await readdir(path.join(root, relDir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const rel = relDir ? path.join(relDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        queue.push(rel);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(NOTE_EXT)) continue;
      if (notes.length >= MAX_NOTES) {
        truncated = true;
        continue;
      }
      const abs = path.join(root, rel);
      const info = await stat(abs).catch(() => null);
      if (!info) continue;
      notes.push({
        rel,
        abs,
        name: entry.name.slice(0, -NOTE_EXT.length),
        modified: new Date(info.mtimeMs).toISOString(),
        bytes: info.size,
      });
    }
  }
  return { notes, truncated };
}

async function readNote(note: NoteFile): Promise<string | null> {
  if (note.bytes > MAX_NOTE_BYTES) return null;
  return readFile(note.abs, "utf8").catch(() => null);
}

type Frontmatter = { fields: Record<string, string | string[]>; body: string; present: boolean };

/** Split the leading `---` block off. Everything after it is the note's prose. */
function splitFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { fields: {}, body: text, present: false };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return { fields: {}, body: text, present: false };
  return {
    fields: parseFields(lines.slice(1, end)),
    body: lines.slice(end + 1).join("\n"),
    present: true,
  };
}

function unquote(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

/**
 * A deliberate subset of YAML: `key: value`, `key: [a, b]`, and `key:` followed
 * by `- item` lines. That covers what Obsidian's own property editor writes.
 * Nested maps are not parsed rather than half-parsed into something wrong.
 */
function parseFields(lines: string[]): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  let key: string | null = null;
  for (const line of lines) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key) {
      const current = fields[key];
      const value = unquote(item[1] ?? "");
      if (!value) continue;
      fields[key] = Array.isArray(current)
        ? [...current, value]
        : current
          ? [current, value]
          : [value];
      continue;
    }
    const pair = /^([A-Za-z0-9_.\- ]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    key = (pair[1] ?? "").trim();
    const raw = (pair[2] ?? "").trim();
    if (!raw) {
      fields[key] = [];
      continue;
    }
    fields[key] =
      raw.startsWith("[") && raw.endsWith("]")
        ? raw.slice(1, -1).split(",").map(unquote).filter(Boolean)
        : unquote(raw);
  }
  return fields;
}

function fieldList(fields: Record<string, string | string[]>, ...keys: string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const value = fields[key];
    if (Array.isArray(value)) out.push(...value);
    else if (typeof value === "string") out.push(...value.split(/[,\s]+/));
  }
  return out.map((entry) => entry.replace(/^#/, "").trim()).filter(Boolean);
}

// Inline tags: `#project/alpha` in the prose. The leading boundary keeps `#` in
// a URL fragment and a markdown heading (`# Title`, which has a space) out.
const INLINE_TAG = /(?:^|[\s(\[>])#([\p{L}\p{N}][\p{L}\p{N}_\-/]*)/gu;

/**
 * Obsidian requires a tag to contain at least one non-numeric character, which
 * is exactly what stops `PR #425` and a `#20` timestamp in someone's daily note
 * from being filed as tags. Reporting those back would invent structure the
 * vault does not have.
 */
function isTag(value: string): boolean {
  return value.length > 0 && !/^\d+$/.test(value);
}

/** A note's tags are the union of its frontmatter tags and its inline ones. */
function tagsOf(fields: Record<string, string | string[]>, body: string): string[] {
  const tags = new Set(fieldList(fields, "tags", "tag").filter(isTag));
  for (const match of body.matchAll(INLINE_TAG))
    if (match[1] && isTag(match[1])) tags.add(match[1]);
  return [...tags].sort((a, b) => a.localeCompare(b));
}

type Wikilink = {
  text: string;
  target: string;
  heading: string | null;
  alias: string | null;
  embed: boolean;
};

const WIKILINK = /(!?)\[\[([^\]\n]+)\]\]/g;

function linksOf(body: string): Wikilink[] {
  const links: Wikilink[] = [];
  for (const match of body.matchAll(WIKILINK)) {
    const inner = match[2] ?? "";
    const [beforeAlias, alias] = splitOnce(inner, "|");
    const [target, heading] = splitOnce(beforeAlias, "#");
    if (!target.trim()) continue;
    links.push({
      text: match[0],
      target: target.trim(),
      heading: heading?.trim() || null,
      alias: alias?.trim() || null,
      embed: match[1] === "!",
    });
  }
  return links;
}

function splitOnce(value: string, separator: string): [string, string | null] {
  const index = value.indexOf(separator);
  return index === -1 ? [value, null] : [value.slice(0, index), value.slice(index + 1)];
}

type NoteIndex = { byPath: Map<string, NoteFile>; byName: Map<string, NoteFile[]> };

function buildIndex(notes: NoteFile[]): NoteIndex {
  const byPath = new Map<string, NoteFile>();
  const byName = new Map<string, NoteFile[]>();
  for (const note of notes) {
    const relNoExt = note.rel.slice(0, -NOTE_EXT.length).split(path.sep).join("/");
    byPath.set(relNoExt.toLowerCase(), note);
    const key = note.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), note]);
  }
  return { byPath, byName };
}

type Resolution = { path: string | null; ambiguous?: string[] };

/**
 * Obsidian resolves a link by name across the whole vault, preferring an exact
 * path when the link contains one and the shortest path when several notes
 * share a name. Same order here, and an ambiguous name says so instead of
 * silently picking.
 */
function resolveLink(index: NoteIndex, target: string): Resolution {
  const cleaned = target.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.md$/i, "");
  const exact = index.byPath.get(cleaned.toLowerCase());
  if (exact) return { path: exact.rel };
  const base = cleaned.split("/").pop() ?? cleaned;
  const matches = [...(index.byName.get(base.toLowerCase()) ?? [])].sort(
    (a, b) => a.rel.length - b.rel.length || a.rel.localeCompare(b.rel),
  );
  if (matches.length === 0) return { path: null };
  const [best, ...rest] = matches;
  return rest.length > 0
    ? { path: best!.rel, ambiguous: rest.map((note) => note.rel) }
    : { path: best!.rel };
}

/** A note's title is its filename unless the frontmatter names another. */
function titleOf(name: string, fields: Record<string, string | string[]>): string {
  const title = fields.title;
  return typeof title === "string" && title ? title : name;
}

function excerptsFor(body: string, query: string): string[] {
  const haystack = body.toLowerCase();
  const needle = query.toLowerCase();
  const out: string[] = [];
  let from = 0;
  while (out.length < EXCERPTS_PER_NOTE) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    const start = Math.max(0, at - EXCERPT_RADIUS);
    const end = Math.min(body.length, at + needle.length + EXCERPT_RADIUS);
    const snippet = body.slice(start, end).replace(/\s+/g, " ").trim();
    out.push(`${start > 0 ? "…" : ""}${snippet}${end < body.length ? "…" : ""}`);
    from = at + needle.length;
  }
  return out;
}

// ─── result plumbing ──────────────────────────────────────────────────────

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[truncated at ${MAX_OUTPUT_CHARS} characters — narrow the query or lower the limit]`;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
}

function limitOf(value: number | undefined, fallback: number, max: number): number {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(requested)));
}

// ─── tools ────────────────────────────────────────────────────────────────

type ToolSpec<S extends TSchema> = {
  name: string;
  label: string;
  description: string;
  parameters: S;
  run: (params: Static<S>, vaults: Vault[]) => Promise<unknown>;
};

function define<S extends TSchema>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

const vaultParam = Type.Optional(
  Type.String({
    description:
      "Which vault, by folder name or full path. Omit for the vault open in Obsidian, or the most recently opened one.",
  }),
);
const noteParam = Type.String({
  description:
    'Vault-relative path ("Projects/Roadmap.md") or just the note name ("Roadmap"), resolved by name across the vault the way a [[wikilink]] is.',
});

const TOOLS = [
  define({
    name: "obsidian_vaults",
    label: "Obsidian: Vaults",
    description:
      "List the Obsidian vaults on this machine: path, folder name, whether each is open in Obsidian right now, when it was last opened, and how many notes it holds. The first is the default every other obsidian_* tool uses when no `vault` is given. Call it when the user has more than one vault, or when a note you were sure existed cannot be found — the usual cause is looking in the wrong vault, not a bad name.",
    parameters: Type.Object({}),
    run: async (_params, vaults) => {
      if (vaults.length === 0) throw new Refusal(NO_VAULT);
      const listed = await Promise.all(
        vaults.map(async (vault, index) => {
          const root = await realpath(vault.path).catch(() => null);
          if (!root) return { ...vault, default: index === 0, readable: false as const };
          const { notes, truncated } = await listNotes(root);
          return {
            ...vault,
            default: index === 0,
            readable: true as const,
            notes: notes.length,
            ...(truncated ? { notesTruncatedAt: MAX_NOTES } : {}),
          };
        }),
      );
      return { vaults: listed };
    },
  }),
  define({
    name: "obsidian_search",
    label: "Obsidian: Search",
    description:
      "Search the vault for notes by title, by content, or both, and return each hit's vault-relative path with the passages that matched. This is the way in: note paths are the user's own folder and naming habits, so search before you read rather than guessing a filename. Matching is case-insensitive substring. A query starting with `#` also matches tags declared in a note's YAML frontmatter, not only the inline ones in its text, and a match in frontmatter or in an alias is reported as such instead of being passed off as a passage from the note. `.obsidian/` is the app's own configuration and is never searched.",
    parameters: Type.Object({
      query: Type.String({ description: "Text to look for; `#tag` also matches frontmatter tags" }),
      vault: vaultParam,
      scope: Type.Optional(
        Type.Union([Type.Literal("both"), Type.Literal("title"), Type.Literal("content")], {
          description: "Where to look (default both)",
        }),
      ),
      folder: Type.Optional(
        Type.String({ description: 'Restrict to a vault-relative folder, e.g. "Daily Notes"' }),
      ),
      limit: Type.Optional(Type.Number({ description: "Maximum notes to return (default 20)" })),
    }),
    run: async (params, vaults) => {
      const query = params.query.trim();
      if (!query) throw new Refusal("`query` is empty.");
      const { vault, root } = await openVault(vaults, params.vault);
      const scope = params.scope ?? "both";
      const limit = limitOf(params.limit, 20, 100);
      const folder = params.folder?.trim().replace(/^\/+|\/+$/g, "");
      const { notes, truncated } = await listNotes(root);
      const needle = query.toLowerCase();
      const tagQuery = query.startsWith("#") ? query.slice(1).toLowerCase() : null;
      const scoped = folder
        ? notes.filter((note) =>
            note.rel.split(path.sep).join("/").toLowerCase().startsWith(`${folder.toLowerCase()}/`),
          )
        : notes;

      const matches: Array<Record<string, unknown>> = [];
      for (const note of scoped) {
        const titleHit = scope !== "content" && note.name.toLowerCase().includes(needle);
        const text = scope === "title" && !titleHit ? null : await readNote(note);
        if (text === null) {
          if (titleHit)
            matches.push({
              path: note.rel,
              title: note.name,
              modified: note.modified,
              matched: ["title"],
            });
          continue;
        }
        const { fields, body } = splitFrontmatter(text);
        const tags = tagsOf(fields, body);
        const aliases = fieldList(fields, "aliases", "alias");
        const title = titleOf(note.name, fields);
        const matched: string[] = [];
        if (scope !== "content" && (titleHit || title.toLowerCase().includes(needle)))
          matched.push("title");
        if (aliases.some((alias) => alias.toLowerCase().includes(needle))) matched.push("alias");
        if (tagQuery && tags.some((tag) => tag.toLowerCase().includes(tagQuery)))
          matched.push("tag");
        const excerpts = scope === "title" ? [] : excerptsFor(body, query);
        if (excerpts.length > 0) matched.push("body");
        if (matched.length === 0) continue;
        matches.push({
          path: note.rel,
          title,
          modified: note.modified,
          matched,
          ...(tags.length > 0 ? { tags } : {}),
          ...(aliases.length > 0 ? { aliases } : {}),
          ...(excerpts.length > 0 ? { excerpts } : {}),
        });
      }

      // Title hits first — a note called what you asked for is what you meant —
      // then the notes with the most passages, then the most recent.
      matches.sort((a, b) => {
        const titleDelta =
          Number((b.matched as string[]).includes("title")) -
          Number((a.matched as string[]).includes("title"));
        if (titleDelta !== 0) return titleDelta;
        const excerptDelta =
          ((b.excerpts as string[] | undefined)?.length ?? 0) -
          ((a.excerpts as string[] | undefined)?.length ?? 0);
        if (excerptDelta !== 0) return excerptDelta;
        return String(b.modified).localeCompare(String(a.modified));
      });

      return {
        vault: vault.name,
        query,
        scope,
        scanned: scoped.length,
        found: matches.length,
        ...(truncated ? { vaultTruncatedAt: MAX_NOTES } : {}),
        matches: matches.slice(0, limit),
      };
    },
  }),
  define({
    name: "obsidian_read",
    label: "Obsidian: Read Note",
    description:
      "Read one note: its body, its YAML frontmatter split out as metadata with tags and aliases pulled from it, the inline #tags in its text, and its [[wikilinks]] already resolved to the vault paths they point at. Takes a vault-relative path or a bare note name, so a link you saw in another note can be passed straight through. Frontmatter is returned as fields rather than left at the top of the body, because it is metadata — quoting it back as if the note opened with it misreads the note.",
    parameters: Type.Object({ note: noteParam, vault: vaultParam }),
    run: async (params, vaults) => {
      const { vault, root } = await openVault(vaults, params.vault);
      const { notes } = await listNotes(root);
      const index = buildIndex(notes);
      const resolved = resolveLink(index, params.note.trim());
      const rel = resolved.path;
      if (!rel) {
        // Fall back to the literal path so the error names the file the caller
        // actually asked for, and so traversal is refused rather than reported
        // as "not found".
        await notePath(root, params.note);
        throw new Refusal(
          `No note matching "${params.note}" in vault "${vault.name}". Search for it with obsidian_search — vault paths follow the user's own folder names.`,
        );
      }
      const abs = await notePath(root, rel);
      const text = await readFile(abs, "utf8").catch(() => null);
      if (text === null) throw new Refusal(`"${rel}" could not be read.`);
      const { fields, body, present } = splitFrontmatter(text);
      const links = linksOf(body).map((link) => {
        const target = resolveLink(index, link.target);
        return {
          text: link.text,
          target: link.target,
          ...(link.alias ? { alias: link.alias } : {}),
          ...(link.heading ? { heading: link.heading } : {}),
          ...(link.embed ? { embed: true } : {}),
          path: target.path,
          ...(target.ambiguous ? { alsoMatches: target.ambiguous } : {}),
          ...(target.path ? {} : { unresolved: true }),
        };
      });
      const info = notes.find((note) => note.rel === rel);
      return {
        vault: vault.name,
        path: rel,
        // Two notes can share a name in different folders. Say which one this
        // is, and which others answer to the same name, rather than letting the
        // caller assume the vault holds only one.
        ...(resolved.ambiguous ? { alsoMatches: resolved.ambiguous } : {}),
        title: titleOf(path.basename(rel, NOTE_EXT), fields),
        modified: info?.modified ?? null,
        frontmatter: present ? fields : null,
        tags: tagsOf(fields, body),
        aliases: fieldList(fields, "aliases", "alias"),
        links,
        body: body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body,
        ...(body.length > MAX_BODY_CHARS ? { bodyTruncatedAt: MAX_BODY_CHARS } : {}),
      };
    },
  }),
  define({
    name: "obsidian_recent",
    label: "Obsidian: Recent Notes",
    description:
      'List the notes modified most recently, newest first, with their paths, titles, tags and a first line of preview. The right first call when the user talks about their notes without naming one — it shows what they have actually been working on, which is usually what they mean by "my notes".',
    parameters: Type.Object({
      vault: vaultParam,
      limit: Type.Optional(Type.Number({ description: "Maximum notes to return (default 20)" })),
      folder: Type.Optional(Type.String({ description: "Restrict to a vault-relative folder" })),
    }),
    run: async (params, vaults) => {
      const { vault, root } = await openVault(vaults, params.vault);
      const limit = limitOf(params.limit, 20, 100);
      const folder = params.folder?.trim().replace(/^\/+|\/+$/g, "");
      const { notes, truncated } = await listNotes(root);
      const scoped = folder
        ? notes.filter((note) =>
            note.rel.split(path.sep).join("/").toLowerCase().startsWith(`${folder.toLowerCase()}/`),
          )
        : notes;
      const recent = [...scoped]
        .sort((a, b) => b.modified.localeCompare(a.modified))
        .slice(0, limit);
      const detailed = await Promise.all(
        recent.map(async (note) => {
          const text = await readNote(note);
          if (text === null)
            return { path: note.rel, title: note.name, modified: note.modified, bytes: note.bytes };
          const { fields, body } = splitFrontmatter(text);
          const preview =
            body
              .split(/\r?\n/)
              .map((line) => line.trim())
              .find((line) => line.length > 0) ?? "";
          const tags = tagsOf(fields, body);
          return {
            path: note.rel,
            title: titleOf(note.name, fields),
            modified: note.modified,
            bytes: note.bytes,
            ...(tags.length > 0 ? { tags } : {}),
            ...(preview ? { preview: preview.slice(0, 160) } : {}),
          };
        }),
      );
      return {
        vault: vault.name,
        total: scoped.length,
        ...(truncated ? { vaultTruncatedAt: MAX_NOTES } : {}),
        notes: detailed,
      };
    },
  }),
  define({
    name: "obsidian_backlinks",
    label: "Obsidian: Backlinks",
    description:
      "List the notes that link TO a given note, with the line each link sits on. Backlinks are how a vault is actually organised: Obsidian resolves [[wikilinks]] by note name across the whole vault, so a note's real neighbours are rarely the files next to it in a folder. Use it to find the context a note is used in before summarizing or changing it.",
    parameters: Type.Object({ note: noteParam, vault: vaultParam }),
    run: async (params, vaults) => {
      const { vault, root } = await openVault(vaults, params.vault);
      const { notes } = await listNotes(root);
      const index = buildIndex(notes);
      const resolved = resolveLink(index, params.note.trim());
      if (!resolved.path) {
        throw new Refusal(`No note matching "${params.note}" in vault "${vault.name}".`);
      }
      const targetRel = resolved.path;
      const backlinks: Array<Record<string, unknown>> = [];
      for (const note of notes) {
        if (note.rel === targetRel) continue;
        const text = await readNote(note);
        if (text === null) continue;
        const { body } = splitFrontmatter(text);
        const lines = body.split(/\r?\n/);
        const contexts: string[] = [];
        for (const line of lines) {
          const hit = linksOf(line).some(
            (link) => resolveLink(index, link.target).path === targetRel,
          );
          if (hit) contexts.push(line.trim().slice(0, 240));
          if (contexts.length >= EXCERPTS_PER_NOTE) break;
        }
        if (contexts.length > 0) backlinks.push({ path: note.rel, title: note.name, contexts });
      }
      return { vault: vault.name, note: targetRel, count: backlinks.length, backlinks };
    },
  }),
  define({
    name: "obsidian_create",
    label: "Obsidian: Create Note",
    description:
      "Create a NEW note in the vault. Refuses if anything already exists at that path — it will never overwrite a note, and the refusal names the existing file so you can obsidian_append to it or pick another name. Missing folders in the path are created. `tags` and `aliases` are written as YAML frontmatter at the top, which is where Obsidian reads metadata from; putting them in the body instead makes them invisible to its search and graph. Only ever create a note the user asked for, in the vault and folder they meant.",
    parameters: Type.Object({
      note: Type.String({
        description:
          'Vault-relative path for the new note, e.g. "Projects/Roadmap" or "Roadmap.md". Folders are created as needed.',
      }),
      content: Type.String({ description: "Markdown body of the note" }),
      vault: vaultParam,
      tags: Type.Optional(
        Type.Array(Type.String(), { description: "Frontmatter tags, without the leading #" }),
      ),
      aliases: Type.Optional(
        Type.Array(Type.String(), {
          description: "Frontmatter aliases — other names this note answers to",
        }),
      ),
    }),
    run: async (params, vaults) => {
      const { vault, root } = await openVault(vaults, params.vault);
      const abs = await notePath(root, params.note);
      const rel = path.relative(root, abs);
      const tags = (params.tags ?? []).map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean);
      const aliases = (params.aliases ?? []).map((alias) => alias.trim()).filter(Boolean);
      const frontmatter =
        tags.length === 0 && aliases.length === 0
          ? ""
          : `---\n${tags.length > 0 ? `tags: [${tags.join(", ")}]\n` : ""}${aliases.length > 0 ? `aliases: [${aliases.join(", ")}]\n` : ""}---\n\n`;
      const body = params.content.endsWith("\n") ? params.content : `${params.content}\n`;
      await mkdir(path.dirname(abs), { recursive: true });
      try {
        // "wx" makes the filesystem itself refuse an existing path. Checking for
        // the file first and then writing would still race, and losing someone's
        // note to a race is not a bug worth having.
        await writeFile(abs, `${frontmatter}${body}`, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
          throw new Refusal(
            `"${rel}" already exists in vault "${vault.name}" and was NOT touched. Add to it with obsidian_append, or create the note under a different name.`,
          );
        }
        throw error;
      }
      return { vault: vault.name, created: rel, bytes: Buffer.byteLength(`${frontmatter}${body}`) };
    },
  }),
  define({
    name: "obsidian_append",
    label: "Obsidian: Append to Note",
    description:
      "Append text to the end of an existing note, separated from what is already there by a blank line. Refuses when the note does not exist, so a mistyped name creates nothing — use obsidian_create for a new note. This is the only way these tools change a note that already exists: there is no overwrite, no edit-in-place, and no delete, because the vault is the user's own writing and a wrong edit is not recoverable from here.",
    parameters: Type.Object({
      note: noteParam,
      content: Type.String({ description: "Markdown to append" }),
      vault: vaultParam,
    }),
    run: async (params, vaults) => {
      const { vault, root } = await openVault(vaults, params.vault);
      const { notes } = await listNotes(root);
      const resolved = resolveLink(buildIndex(notes), params.note.trim());
      const abs = await notePath(root, resolved.path ?? params.note);
      const existing = await readFile(abs, "utf8").catch(() => null);
      if (existing === null) {
        throw new Refusal(
          `No note at "${path.relative(root, abs)}" in vault "${vault.name}", so nothing was appended. Create it with obsidian_create, or find the right note with obsidian_search.`,
        );
      }
      const addition = params.content.endsWith("\n") ? params.content : `${params.content}\n`;
      const separator = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
      await appendFile(abs, `${separator}${addition}`, "utf8");
      return {
        vault: vault.name,
        appended: path.relative(root, abs),
        bytes: Buffer.byteLength(`${separator}${addition}`),
      };
    },
  }),
];

// ─── registration ─────────────────────────────────────────────────────────

export default async function registerObsidianExtension(pi: ExtensionAPI) {
  // Resolved once per session. The runtime already refuses to load this
  // extension on a machine with no vault, so an empty list here means the
  // injected vault list is missing — every tool then answers with NO_VAULT,
  // which is a clear report rather than an ENOENT the model has to interpret.
  const vaults = readVaults();

  for (const tool of TOOLS) {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_id, params): Promise<ToolResult> {
        const detailBase = { tool: tool.name, params: (params ?? {}) as Record<string, unknown> };
        try {
          const data = await tool.run(params as never, vaults);
          return {
            content: [{ type: "text", text: truncate(asText(data)) }],
            details: { ...detailBase, data },
          };
        } catch (error) {
          if (error instanceof Refusal) {
            return {
              content: [{ type: "text", text: error.message }],
              details: { ...detailBase, refused: true, failed: true },
            };
          }
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `${tool.name} failed: ${message}` }],
            details: { ...detailBase, error: message, failed: true },
          };
        }
      },
    });
  }
}
