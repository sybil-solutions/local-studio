import { existsSync, readFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { listProjectsFromStore, resolveAllowedWorkspace } from "./projects-store";
import { hasEnabledConnectorsSync } from "./connectors-service";
import { githubCliPathSync, hasGithubCliSync } from "./github-cli";
import { hasObsidianVaultSync, listObsidianVaultsSync } from "./obsidian-vault";
import { resolveBundledResource } from "./plugin-resources";
import type {
  AgentBrowserBackend as BrowserBackend,
  AgentThinkingLevel,
  AgentToolAccess,
} from "../../../shared/agent/agent-turn";

type RuntimeSkillRef = {
  id?: string;
  name?: string;
  path?: string;
};

type RuntimePromptTemplateRef = {
  id?: string;
  name?: string;
  path?: string;
};

export type RuntimeStartOptions = {
  thinkingLevel?: AgentThinkingLevel;
  toolAccess?: AgentToolAccess;
  browserToolEnabled?: boolean;
  browserSessionId?: string;
  browserBackend?: BrowserBackend;
  skills?: RuntimeSkillRef[];
  promptTemplates?: RuntimePromptTemplateRef[];
};

type AgentSessionOptionsInput = {
  options: RuntimeStartOptions;
  /** Resolved session cwd, exported to extensions as LOCAL_STUDIO_CWD. */
  cwd?: string;
  processEnv?: NodeJS.ProcessEnv;
};

type AgentSessionOptions = {
  // Absolute filesystem paths to .ts/.js extension modules. The SDK's
  // resource-loader uses jiti to load these; we hand paths instead of
  // pre-imported factories so we never trigger webpack's static analyser on a
  // dynamic `import(variable)` in the Next runtime bundle.
  extensionPaths: string[];
  skills: string[];
  /** Absolute prompt-template file/dir paths; forwarded to the SDK. */
  promptTemplatePaths: string[];
  envInjections: Record<string, string>;
};

function resolveDefaultAgentCwd(): string {
  if (process.env.LOCAL_STUDIO_AGENT_CWD) return process.env.LOCAL_STUDIO_AGENT_CWD;

  try {
    const usable = listProjectsFromStore().find((entry) => entry.exists);
    if (usable) return usable.path;
  } catch {
    // The project registry is optional during first run.
  }

  const cwd = process.cwd();
  if (path.basename(cwd) === "frontend") return path.resolve(cwd, "..");
  if (cwd === "/" || cwd === "") return homedir();
  return cwd;
}

/**
 * Expand a leading tilde to the user's home directory: `~` alone, or a
 * `~` + `path.sep` prefix (so `~/` on POSIX). Every other value — including
 * `~user` forms and mid-string tildes — passes through unchanged. The single
 * tilde-expansion rule for this service; new path inputs that accept `~`
 * should call this rather than restate it.
 */
export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith(`~${path.sep}`)) return path.join(homedir(), value.slice(2));
  return value;
}

// Resolve user-facing cwd input into the concrete directory Pi should run in.
// The default keeps packaged Electron launches out of "/" by preferring the
// selected project registry, then repo root during dev, then the user home.
export function resolveAgentCwdEffect(input?: string): Effect.Effect<string, unknown> {
  const defaultCwd = resolveDefaultAgentCwd();
  const raw = input?.trim() || defaultCwd;
  const expanded = expandHome(raw);
  const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(defaultCwd, expanded);
  return Effect.gen(function* () {
    const resolved = yield* Effect.tryPromise({
      try: () => realpath(candidate),
      catch: (error) => error,
    });
    const info = yield* Effect.tryPromise({
      try: () => stat(resolved),
      catch: (error) => error,
    });
    if (!info.isDirectory()) {
      return yield* Effect.fail(new Error(`Agent cwd is not a directory: ${resolved}`));
    }
    return resolveAllowedWorkspace(resolved);
  });
}

// One resolver for every bundled resource (see plugin-resources) so the
// extension/skill lookup and the plugin lookup cannot drift apart again.
function resolveBundledResourcePath(kind: string, name: string, override?: string): string | null {
  if (override && existsSync(override)) return override;
  return resolveBundledResource(kind, name);
}

export function runtimeOptionsFingerprint(options: RuntimeStartOptions): string {
  const skills = (options.skills ?? [])
    .map((skill) => `${skill.name ?? ""}:${skill.path ?? ""}`)
    .sort();
  const promptTemplates = (options.promptTemplates ?? [])
    .map((template) => `${template.name ?? ""}:${template.path ?? ""}`)
    .sort();
  return JSON.stringify({
    thinkingLevel: options.thinkingLevel ?? "high",
    toolAccess: options.toolAccess ?? "full",
    browser: options.browserToolEnabled === true,
    browserBackend: browserBackend(options),
    browserSessionId: options.browserSessionId ?? "",
    skills,
    promptTemplates,
  });
}

function selectedSkillPaths(skills: RuntimeSkillRef[]): string[] {
  return uniqueExistingPaths(skills.map((skill) => skill.path));
}

function selectedPromptTemplatePaths(templates: RuntimePromptTemplateRef[]): string[] {
  return uniqueExistingPaths(templates.map((template) => template.path));
}

function uniqueExistingPaths(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || !existsSync(value)) return false;
    const resolved = path.resolve(value);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

function deriveFrontendBase(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

function shouldLoadBrowserTool(options: RuntimeStartOptions): boolean {
  return options.browserToolEnabled === true;
}

function browserBackend(options: RuntimeStartOptions): BrowserBackend {
  const backend = options.browserBackend ?? process.env.LOCAL_STUDIO_BROWSER_BACKEND;
  if (backend === "chrome") return "chrome";
  return "embedded";
}

/** The user's own browser is armed on top of the sandbox, never instead of it. */
function shouldLoadChromeTool(options: RuntimeStartOptions): boolean {
  return shouldLoadBrowserTool(options) && browserBackend(options) === "chrome";
}

function runtimeExtensionPaths(options: RuntimeStartOptions): string[] {
  return uniqueExistingPaths([
    resolveBundledResourcePath(
      "pi-extensions",
      "local-studio-timeouts.ts",
      process.env.LOCAL_STUDIO_TIMEOUT_EXTENSION_PATH,
    ),
    resolveBundledResourcePath(
      "pi-extensions",
      "local-studio-agent-policy.ts",
      process.env.LOCAL_STUDIO_AGENT_POLICY_EXTENSION_PATH,
    ),
    // cua = computer use: the headless throwaway browser this app launches and
    // renders in the Browser panel. Armed whenever the browser tool is on,
    // because it is the safe default and the only backend the panel can show.
    shouldLoadBrowserTool(options)
      ? resolveBundledResourcePath(
          "pi-extensions",
          "cua.ts",
          process.env.LOCAL_STUDIO_CUA_EXTENSION_PATH,
        )
      : null,
    // chrome = the user's OWN browser, reached through the local extension
    // relay. It is registered ALONGSIDE cua rather than instead of it: the two
    // drive different browsers under different names (`chrome_*` vs
    // `browser_*`), and a model that can see both picks per task — the user's
    // session for signed-in work, the sandbox for anonymous fetching. Replacing
    // one with the other would force the choice at composer time, before anyone
    // knows what the task needs.
    shouldLoadChromeTool(options)
      ? resolveBundledResourcePath(
          "pi-extensions",
          "chrome.ts",
          process.env.LOCAL_STUDIO_CHROME_EXTENSION_PATH,
        )
      : null,
    // github wraps the `gh` CLI, so it only loads where a gh binary exists.
    hasGithubCliSync()
      ? resolveBundledResourcePath(
          "pi-extensions",
          "github.ts",
          process.env.LOCAL_STUDIO_GITHUB_EXTENSION_PATH,
        )
      : null,
    // obsidian reads and writes a folder of markdown files, so it needs no
    // Obsidian process — but it does need a vault. Gated on Obsidian having
    // registered one, on the same principle as the gh binary above: seven note
    // tools on a machine that has never opened Obsidian are seven tools that
    // can only apologise.
    hasObsidianVaultSync()
      ? resolveBundledResourcePath(
          "pi-extensions",
          "obsidian.ts",
          process.env.LOCAL_STUDIO_OBSIDIAN_EXTENSION_PATH,
        )
      : null,
    hasEnabledConnectorsSync()
      ? resolveBundledResourcePath(
          "pi-extensions",
          "connectors.ts",
          process.env.LOCAL_STUDIO_CONNECTORS_EXTENSION_PATH,
        )
      : null,
    resolveBundledResourcePath(
      "pi-extensions",
      "subagents.ts",
      process.env.LOCAL_STUDIO_SUBAGENTS_EXTENSION_PATH,
    ),
    // Lets the agent create/list/delete scheduled automations.
    resolveBundledResourcePath(
      "pi-extensions",
      "automations.ts",
      process.env.LOCAL_STUDIO_AUTOMATIONS_EXTENSION_PATH,
    ),
    // NOTE: session-goal injection is no longer a bundled extension — it runs
    // in-process via createGoalPromptExtension (see pi-runtime.ts), keyed by the
    // canonical piSessionId. A bundled extension read the wrong id over RPC.
  ]);
}

function runtimeSkillPaths(options: RuntimeStartOptions): string[] {
  return uniqueExistingPaths([
    ...selectedSkillPaths(options.skills ?? []),
    // Bundled skill directories (each contains SKILL.md), searched only when
    // the matching tool surface is ON so they can be appended to the SDK skill
    // list and teach the model how/when to use those tools.
    shouldLoadBrowserTool(options)
      ? resolveBundledResourcePath("skills", "cua", process.env.LOCAL_STUDIO_CUA_SKILL_PATH)
      : null,
    shouldLoadChromeTool(options)
      ? resolveBundledResourcePath("skills", "chrome", process.env.LOCAL_STUDIO_CHROME_SKILL_PATH)
      : null,
    // Same rule as the automations skill below: the tools are registered, so
    // the guidance that says when to reach for them has to be there too.
    hasGithubCliSync()
      ? resolveBundledResourcePath("skills", "github", process.env.LOCAL_STUDIO_GITHUB_SKILL_PATH)
      : null,
    hasObsidianVaultSync()
      ? resolveBundledResourcePath(
          "skills",
          "obsidian",
          process.env.LOCAL_STUDIO_OBSIDIAN_SKILL_PATH,
        )
      : null,
    // Unconditional, because the automations extension is: the tools are always
    // registered, so the guidance that says when to reach for them has to be
    // there too. Skills are progressively disclosed — this costs one line in
    // the prompt until the model opens it.
    resolveBundledResourcePath(
      "skills",
      "automations",
      process.env.LOCAL_STUDIO_AUTOMATIONS_SKILL_PATH,
    ),
    // Same rule: the subagent tools are always registered, and without the
    // guidance most models never think to fan out.
    resolveBundledResourcePath(
      "skills",
      "subagents",
      process.env.LOCAL_STUDIO_SUBAGENTS_SKILL_PATH,
    ),
  ]);
}

function runtimeEnvInjections(
  options: RuntimeStartOptions,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Record<string, string> {
  const frontendBase = env.LOCAL_STUDIO_FRONTEND_BASE ?? deriveFrontendBase(env);
  const relay = readChromeRelayEnv(env);
  const githubCliPath = githubCliPathSync();
  // The vaults this runtime resolved, so the extension answers about the same
  // ones the load gate above saw. Skipped when empty: the extension then falls
  // back to reading obsidian.json itself and reports "no vault found" rather
  // than trusting an empty list it cannot explain.
  const obsidianVaults = listObsidianVaultsSync();
  return {
    // Which browsers this session armed. Nothing reads it to choose a transport
    // any more — that is decided by which extension got loaded — but the
    // composer's browser context prompt names the same value, so keep it honest.
    LOCAL_STUDIO_BROWSER_BACKEND: browserBackend(options),
    LOCAL_STUDIO_BROWSER_SESSION_ID: options.browserSessionId ?? "",
    // The project this session runs in. Extensions that spawn later work (the
    // automations extension) would otherwise store an empty cwd and get the
    // first registered project when the scheduler resolves the default.
    LOCAL_STUDIO_CWD: cwd,
    LOCAL_STUDIO_FRONTEND_BASE: frontendBase,
    // The chrome extension's address for the browser-extension relay. The relay
    // is the user's own process and keeps its own env names (below); these are
    // what the extension reads, so the two can be renamed independently.
    LOCAL_STUDIO_CHROME_RELAY_URL: env.SITEGEIST_RELAY_URL ?? relay.SITEGEIST_RELAY_URL ?? "",
    LOCAL_STUDIO_CHROME_RELAY_TOKEN: env.SITEGEIST_RELAY_TOKEN ?? relay.SITEGEIST_RELAY_TOKEN ?? "",
    LOCAL_STUDIO_CHROME_RELAY_SESSION: options.browserSessionId ?? "",
    // Resolved here so the extension runs the binary this process found, rather
    // than whatever a packaged app's stripped-down PATH resolves `gh` to.
    ...(githubCliPath ? { LOCAL_STUDIO_GH_PATH: githubCliPath } : {}),
    ...(obsidianVaults.length > 0
      ? { LOCAL_STUDIO_OBSIDIAN_VAULTS: JSON.stringify(obsidianVaults) }
      : {}),
  };
}

/** The relay's own env contract, unchanged: `~/.config/sitegeist-relay/env`. */
function readChromeRelayEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const filePath = expandHome(
    env.LOCAL_STUDIO_SITEGEIST_RELAY_ENV_PATH ?? "~/.config/sitegeist-relay/env",
  );
  if (!existsSync(filePath)) return {};
  try {
    return Object.fromEntries(
      readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .flatMap((line): Array<[string, string]> => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) return [];
          const clean = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
          const index = clean.indexOf("=");
          if (index < 1) return [];
          const key = clean.slice(0, index).trim();
          const value = clean
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, "");
          return key.startsWith("SITEGEIST_RELAY_") ? [[key, value]] : [];
        }),
    );
  } catch {
    return {};
  }
}

export function applyRuntimeEnvInjections(
  envInjections: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const [key, value] of Object.entries(envInjections)) env[key] = value;
}

export function buildAgentSessionOptionsSync(input: AgentSessionOptionsInput): AgentSessionOptions {
  const options = input.options;
  return {
    extensionPaths: runtimeExtensionPaths(options),
    skills: runtimeSkillPaths(options),
    promptTemplatePaths: selectedPromptTemplatePaths(options.promptTemplates ?? []),
    envInjections: runtimeEnvInjections(options, input.processEnv ?? process.env, input.cwd ?? ""),
  };
}
