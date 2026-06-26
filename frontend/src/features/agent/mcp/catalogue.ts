// Curated, trusted MCP server catalogue. These are the vetted servers a user
// can one-click add (filling in any required secrets). Each entry is a fixed,
// reviewed launch line — users only supply env values, never arbitrary
// commands (that's what "Add custom" is for). Keep this list small and trusted.
//
// All entries launch via `npx -y <package>` (stdio) so no global install is
// needed; Node ships with the desktop runtime.

import type { McpCatalogueEntry } from "@/features/agent/mcp/types";
import { existsSync } from "node:fs";
import path from "node:path";

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
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-time"],
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
  },
  {
    id: "catalogue:github",
    name: "github",
    displayName: "GitHub",
    description:
      "GitHub repositories, issues, pull requests, and code search through the official remote MCP endpoint. Connect GitHub once with OAuth; Local Studio injects the token into mcp-remote.",
    shortDescription: "GitHub via OAuth",
    category: "Engineering",
    tags: ["github", "oauth", "remote", "curated"],
    command: "npx",
    args: [
      "-y",
      "mcp-remote",
      "https://api.githubcopilot.com/mcp/",
      "--transport",
      "http-only",
      "--header",
      "Authorization:Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}",
    ],
    oauthProvider: "github",
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
    homepage: "https://github.com/github/github-mcp-server",
  },
  {
    id: "catalogue:gmail",
    name: "gmail",
    displayName: "Gmail",
    description:
      "Gmail tools from the Google Workspace MCP server. Connect Google once; the server receives fresh Gmail OAuth values at launch.",
    shortDescription: "Gmail via Google OAuth",
    category: "Google",
    tags: ["google", "gmail", "oauth", "curated"],
    command: "npx",
    args: ["-y", "mcp-server-google-workspace"],
    oauthProvider: "google",
    env: googleOAuthEnv(),
    tools: {
      include: [
        "gmail_list_emails",
        "gmail_read_email",
        "gmail_search_emails",
        "gmail_send_email",
        "get_user_email",
      ],
    },
    homepage: "https://github.com/iskifogl/mcp-server-google-workspace",
  },
  {
    id: "catalogue:calendar",
    name: "calendar",
    displayName: "Calendar",
    description:
      "Google Calendar tools from the Google Workspace MCP server. Uses the same connected Google OAuth account as Gmail.",
    shortDescription: "Calendar via Google OAuth",
    category: "Google",
    tags: ["google", "calendar", "oauth", "curated"],
    command: "npx",
    args: ["-y", "mcp-server-google-workspace"],
    oauthProvider: "google",
    env: googleOAuthEnv(),
    tools: {
      include: ["calendar_list_calendars", "calendar_list_events", "calendar_create_event"],
    },
    homepage: "https://github.com/iskifogl/mcp-server-google-workspace",
  },
  {
    id: "catalogue:huggingface",
    name: "huggingface",
    displayName: "Hugging Face",
    description:
      "Official Hugging Face Hub MCP server for models, datasets, Spaces, and paper discovery. Connect Hugging Face once; Local Studio injects the token into mcp-remote.",
    shortDescription: "Hugging Face via OAuth",
    category: "AI",
    tags: ["huggingface", "oauth", "models", "datasets", "remote", "curated"],
    command: "npx",
    args: [
      "-y",
      "mcp-remote",
      "https://huggingface.co/mcp",
      "--header",
      "Authorization:Bearer ${HF_TOKEN}",
    ],
    oauthProvider: "huggingface",
    env: { HF_TOKEN: "" },
    homepage: "https://huggingface.co/settings/mcp",
  },
  {
    id: "catalogue:sitegeist",
    name: "sitegeist",
    displayName: "Sitegeist",
    description:
      "Local Sitegeist browser relay from ~/ai/sitegeist. Start the relay and connect the Brave extension, then expose browser navigation, text, HTML, screenshot, click, fill, and tab tools.",
    shortDescription: "Brave/Sitegeist browser relay",
    category: "Browser",
    tags: ["sitegeist", "brave", "browser", "local", "curated"],
    command: "node",
    args: [sitegeistMcpBridgePath()],
    env: {
      SITEGEIST_RELAY_URL: "http://127.0.0.1:7717",
    },
    homepage: "file:///Users/sero/ai/sitegeist/relay/README.md",
  },
  {
    id: "catalogue:cua-try-us",
    name: "computer-use",
    displayName: "CUA Try Us",
    description:
      "The bundled Codex Computer Use MCP server. It launches SkyComputerUseClient from the installed Codex computer-use plugin cache.",
    shortDescription: "Local computer-use MCP",
    category: "Computer",
    tags: ["computer-use", "cua", "local", "curated"],
    command:
      "./Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
    args: ["mcp"],
    cwd: "${HOME}/.codex/plugins/cache/openai-bundled/computer-use/1.0.857",
    homepage: "file:///Users/sero/.codex/plugins/cache/openai-bundled/computer-use/1.0.857",
  },
];

export function findCatalogueEntry(id: string): McpCatalogueEntry | null {
  return MCP_CATALOGUE.find((entry) => entry.id === id) ?? null;
}

function googleOAuthEnv(): Record<string, string> {
  return {
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    GOOGLE_REFRESH_TOKEN: "",
    GOOGLE_ACCESS_TOKEN: "",
  };
}

function sitegeistMcpBridgePath(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    return path.join(resourcesPath, "desktop", "resources", "mcp", "sitegeist-relay.mjs");
  }
  const candidates = [
    path.resolve(process.cwd(), "desktop", "resources", "mcp", "sitegeist-relay.mjs"),
    path.resolve(process.cwd(), "frontend", "desktop", "resources", "mcp", "sitegeist-relay.mjs"),
    path.resolve(
      process.cwd(),
      "..",
      "frontend",
      "desktop",
      "resources",
      "mcp",
      "sitegeist-relay.mjs",
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}
