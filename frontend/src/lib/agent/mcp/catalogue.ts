// Curated, trusted MCP server catalogue. These are the vetted servers a user
// can one-click add (filling in any required secrets). Each entry is a fixed,
// reviewed launch line — users only supply env values, never arbitrary
// commands (that's what "Add custom" is for). Keep this list small and trusted.
//
// All entries launch via `npx -y <package>` (stdio) so no global install is
// needed; Node ships with the desktop runtime.

import type { McpCatalogueEntry } from "./types";

export const MCP_CATALOGUE: McpCatalogueEntry[] = [
  {
    id: "catalogue:filesystem",
    name: "filesystem",
    displayName: "Filesystem",
    description:
      "Read, write, and search files within directories you explicitly allow. Pass allowed roots as arguments.",
    shortDescription: "Local file access",
    category: "Files",
    tags: ["local", "files", "reference"],
    registry: "curated",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    requiresTargetArg: true,
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "catalogue:fetch",
    name: "fetch",
    displayName: "Fetch",
    description: "Fetch a URL and return its content as markdown or raw text.",
    shortDescription: "Fetch web content",
    category: "Web",
    tags: ["web", "reference"],
    registry: "curated",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
  },
  {
    id: "catalogue:git",
    name: "git",
    displayName: "Git",
    description:
      "Inspect and operate on a local Git repository (status, log, diff, branches). Pass the repo path as an argument.",
    shortDescription: "Local Git operations",
    category: "Engineering",
    tags: ["git", "local", "reference"],
    registry: "curated",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git"],
    requiresTargetArg: true,
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
  },
  {
    id: "catalogue:sqlite",
    name: "sqlite",
    displayName: "SQLite",
    description:
      "Query and explore a local SQLite database. Pass the database path as an argument.",
    shortDescription: "SQLite database access",
    category: "Data",
    tags: ["database", "local", "reference"],
    registry: "curated",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite"],
    requiresTargetArg: true,
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
  },
  {
    id: "catalogue:time",
    name: "time",
    displayName: "Time",
    description: "Current time and timezone conversions.",
    shortDescription: "Time & timezones",
    category: "Utilities",
    tags: ["time", "reference"],
    registry: "curated",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-time"],
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
  },
  {
    id: "catalogue:github",
    name: "github",
    displayName: "GitHub",
    description:
      "Interact with GitHub: repos, issues, pull requests, and code search. Requires a personal access token.",
    shortDescription: "GitHub API access",
    category: "Engineering",
    tags: ["github", "official", "remote"],
    registry: "curated",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
    requiredEnv: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
  },
];

export function findCatalogueEntry(id: string): McpCatalogueEntry | null {
  return MCP_CATALOGUE.find((entry) => entry.id === id) ?? null;
}
