---
name: obsidian
description: The user's Obsidian vault — searching, reading, creating and appending to their markdown notes, with wikilinks, frontmatter and tags handled the way Obsidian means them. Load when the user mentions their notes, their vault, Obsidian, a daily note, a note by name, or asks you to write something down for them.
---

# obsidian

An Obsidian vault is a folder of markdown files. There is no Obsidian process to talk to, no API, and no plugin installed on the Obsidian side — the `obsidian_*` tools read and write the files directly, and Obsidian picks the changes up on its own. If it is open, the user will see your note appear.

The vault is the user's own writing. Treat it that way: read a lot, write only what they asked for, and never present a note's contents as your own summary without saying which note it came from.

## Tools

- `obsidian_vaults` — every vault on this machine, which one is open, which is the default.
- `obsidian_search` — find notes by title, content, or both. Returns paths plus the passages that matched.
- `obsidian_read` — one note: body, frontmatter as fields, tags, and its wikilinks resolved to paths.
- `obsidian_recent` — the notes modified most recently, with a preview line.
- `obsidian_backlinks` — the notes that link TO a note, and the line each link sits on.
- `obsidian_create` — a NEW note. Refuses to overwrite an existing one.
- `obsidian_append` — add to the end of an existing note. Refuses when it does not exist.

Every tool takes an optional `vault` (folder name or full path). Omit it for the vault open in Obsidian, or the most recently opened one.

## What Obsidian means, that a plain file reader gets wrong

- **`[[wikilinks]]` resolve by note NAME across the whole vault**, not by relative path. `[[Roadmap]]` in a note buried three folders deep points at whichever note is called `Roadmap`, wherever it lives. `[[Note|alias]]` and `[[Note#Heading]]` still point at `Note`. `obsidian_read` resolves them for you and gives you the path; pass that path, or the bare name, straight to the next call.
- **Frontmatter is metadata, not the opening paragraph.** The `---` block at the top holds `tags`, `aliases`, and whatever properties the user keeps. `obsidian_read` returns it as fields and the body separately. Do not quote it back as if the note began with it.
- **Tags live in two places.** `tags:` in frontmatter and `#tag` inline in the text. A note's tags are the union; searching for `#idea` covers both.
- **`.obsidian/` is not notes.** It is themes, hotkeys and workspace layout. The tools never search, read or write it. If the user asks about their Obsidian settings, say that these tools deliberately do not touch them.

## Protocol

1. Search before you read. Vault paths are the user's own folder and naming habits — `obsidian_search`, or `obsidian_recent` when they say "my notes" without naming one. Guessing a filename wastes a call and usually misses.
2. Read the note before summarizing it. Excerpts from search are fragments, not the note.
3. Follow the links. A note that reads thin is often an index; `obsidian_read` hands you resolved wikilinks and `obsidian_backlinks` hands you the notes that point at it. That is where the vault's structure actually is.
4. Ask before writing, unless the user clearly asked for a note. Where it goes matters as much as what it says — the folder and the vault are part of their system.
5. `obsidian_create` never overwrites. If it refuses, a note already exists at that path: read it, then `obsidian_append` or pick another name. Do not work around the refusal.
6. `obsidian_append` never creates. If it refuses, the note is not there — check the name with `obsidian_search` before deciding it needs creating.
7. There is no delete and no overwrite, by design. If the user wants a note removed or rewritten, tell them; do not simulate it by appending a correction they did not ask for.
8. Match the vault's conventions when you write. Look at a neighbouring note first: if its notes carry frontmatter tags, give yours tags; if they link to a hub note, link to it with `[[...]]`.
9. With more than one vault, name it. `obsidian_vaults` first, then pass `vault` explicitly rather than trusting the default to be the one the user means.
10. If a tool reports no vault, say exactly that. Obsidian is not installed or has never opened a vault — do not invent a notes folder and do not create one.
