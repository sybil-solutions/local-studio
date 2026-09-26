export const HARNESSES = ["dsh", "claude", "codex", "pi", "omp", "codex-desktop", "claude-desktop"] as const;

export type Harness = (typeof HARNESSES)[number];

export const CLIENTS = ["dsh", "claude-code", "codex-cli", "codex-desktop", "claude-desktop", "pi", "omp", "ui", "peer", "api"] as const;

export type Client = (typeof CLIENTS)[number];

export const HARNESS_CLIENT: Record<Harness, Client> = {
  dsh: "dsh",
  claude: "claude-code",
  codex: "codex-cli",
  pi: "pi",
  omp: "omp",
  "codex-desktop": "codex-desktop",
  "claude-desktop": "claude-desktop",
};

export interface HarnessJob {
  action: "install" | "update";
  state: "running" | "done" | "failed";
  startedAt: number;
  endedAt: number | null;
  detail: string;
  log: string[];
}

export interface HarnessInfo {
  harness: Harness;
  installed: boolean;
  path: string | null;
  version: string | null;
  managed: boolean;
  package: string | null;
  latest: string | null;
  job: HarnessJob | null;
  tier: 1 | 2;
  note: string;
}

export interface AgentSession {
  id: string;
  harness: Harness;
  model: string;
  dir: string;
  bin: string | null;
  startedAt: number;
  tmuxSession: string | null;
  attach: string | null;
  url: string | null;
}

export interface AgentLaunchResult {
  sessionId: string;
  harness: Harness;
  how: "tmux" | "terminal" | "app" | "web";
  bin: string | null;
  version: string | null;
  dir: string;
  command: string;
  url: string | null;
  tmuxSession: string | null;
  attach: string | null;
  running?: string | null;
  note?: string;
  files?: string[];
  verify?: "by hand";
}

export interface BuiltLaunch {
  argv: string[];
  env: Record<string, string>;
  files: { path: string; content: string; mode: number; keep?: boolean }[];
  cwd: string;
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
