export const HARNESSES = ["dsh", "claude", "codex", "codex-desktop", "claude-desktop"] as const;

export type Harness = (typeof HARNESSES)[number];

export const CLIENTS = ["dsh", "claude-code", "codex-cli", "codex-desktop", "claude-desktop", "pi", "omp", "ui", "peer", "api"] as const;

export type Client = (typeof CLIENTS)[number];

export const HARNESS_CLIENT: Record<Harness, Client> = {
  dsh: "dsh",
  claude: "claude-code",
  codex: "codex-cli",
  "codex-desktop": "codex-desktop",
  "claude-desktop": "claude-desktop",
};

export interface HarnessInfo {
  harness: Harness;
  installed: boolean;
  path: string | null;
  version: string | null;
  tier: 1 | 2;
  note: string;
}

export interface Workspace {
  id: string;
  name: string;
  dir: string;
  harness: Harness;
  model: string;
  flags: string[];
  createdAt: number;
  lastOpenAt: number | null;
}

export interface AgentLaunchResult {
  workspaceId: string;
  harness: Harness;
  how: "tmux" | "terminal" | "app" | "web";
  command: string;
  url: string | null;
  tmuxSession: string | null;
  attach: string | null;
  created?: boolean;
  resume?: boolean;
  note?: string;
  files?: string[];
  verify?: "by hand";
}

export interface BuiltLaunch {
  argv: string[];
  env: Record<string, string>;
  files: { path: string; content: string; mode: number }[];
  cwd: string;
}

export interface DshStatus {
  installed: boolean;
  version: string | null;
  running: boolean;
  port: number | null;
  url: string | null;
  providerId: string;
  home: string;
}

export interface ApiKeyInfo {
  id: string;
  client: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  admin: boolean;
  scope: "admin" | "client" | "federation";
  actions: boolean;
}
