// Which Chromium-family binary the embedded browser drives.
//
// Two dials, in priority order:
//
//   1. LOCAL_STUDIO_CHROME_PATH — an explicit binary path, absolute authority.
//      If it is set but missing we fail loudly instead of falling back: an
//      override that silently drives a different browser than the one named is
//      worse than an error the user can read.
//   2. The persisted engine preference (<dataDir>/browser-engine.json), seeded
//      from LOCAL_STUDIO_BROWSER_ENGINE when nothing has been chosen yet. This
//      is the dial a GUI user can actually reach — a packaged desktop app
//      inherits no shell env, so env-only configuration is unreachable there.
//
// "auto" (the default) prefers Playwright's bundled Chromium, the only engine
// guaranteed to match playwright-core's protocol expectations, then falls back
// to installed browsers in a fixed order. Auto-detection deliberately does NOT
// promote Brave over Chrome — changing which browser an existing install drives
// would be a surprise. Brave is reachable by *choosing* it; that is what the
// preference is for.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { resolveDataDir } from "../data-dir";

export type BrowserEngineId =
  | "auto"
  | "bundled"
  | "chrome"
  | "chromium"
  | "brave"
  | "edge"
  | "arc"
  | "vivaldi";

/** Selectable engines in menu order; "auto" and "bundled" are always offered. */
export const BROWSER_ENGINE_IDS: readonly BrowserEngineId[] = [
  "auto",
  "bundled",
  "chrome",
  "chromium",
  "brave",
  "edge",
  "arc",
  "vivaldi",
];

export type BrowserEngineInfo = {
  id: BrowserEngineId;
  label: string;
  /** Resolved binary, or null when this engine is not installed here. */
  path: string | null;
};

export type ResolvedBrowserEngine = {
  /** "custom" when an explicit binary path is in force — not a settable id. */
  id: BrowserEngineId | "custom";
  label: string;
  path: string;
  /** Which dial won, so the UI can explain what is actually running. */
  source: "override" | "preference" | "bundled" | "detected";
};

export class BrowserEngineError extends Error {}

type EngineSpec = {
  id: BrowserEngineId;
  label: string;
  locate: () => string | null;
};

const PREFERENCE_FILE = "browser-engine.json";

const resolveOnPath = (binary: string): string | null => {
  try {
    const resolved = execFileSync("which", [binary], { encoding: "utf8" }).trim();
    return resolved && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
};

const fromPaths =
  (paths: string[]) =>
  (): string | null =>
    paths.find((candidate) => existsSync(candidate)) ?? null;

const fromCommands =
  (names: string[]) =>
  (): string | null =>
    names.map(resolveOnPath).find((value): value is string => Boolean(value)) ?? null;

const macApp = (app: string, binary = app): string =>
  `/Applications/${app}.app/Contents/MacOS/${binary}`;

function windowsPaths(suffixes: string[]): string[] {
  const roots = [
    process.env["PROGRAMFILES"],
    process.env["PROGRAMFILES(X86)"],
    process.env["LOCALAPPDATA"],
  ].filter((value): value is string => Boolean(value));
  return roots.flatMap((root) => suffixes.map((suffix) => path.join(root, suffix)));
}

// Ordered per platform. Flattening this table in order reproduces the legacy
// candidate list exactly, so "auto" behaves on existing installs as it always
// has.
function engineSpecs(): EngineSpec[] {
  if (process.platform === "darwin") {
    return [
      {
        id: "chrome",
        label: "Google Chrome",
        locate: fromPaths([
          macApp("Google Chrome"),
          macApp("Google Chrome Beta"),
          macApp("Google Chrome Canary"),
        ]),
      },
      { id: "chromium", label: "Chromium", locate: fromPaths([macApp("Chromium")]) },
      {
        id: "brave",
        label: "Brave",
        locate: fromPaths([
          macApp("Brave Browser"),
          macApp("Brave Browser Beta"),
          macApp("Brave Browser Nightly"),
        ]),
      },
      { id: "edge", label: "Microsoft Edge", locate: fromPaths([macApp("Microsoft Edge")]) },
      { id: "arc", label: "Arc", locate: fromPaths([macApp("Arc")]) },
      { id: "vivaldi", label: "Vivaldi", locate: fromPaths([macApp("Vivaldi")]) },
    ];
  }
  if (process.platform === "win32") {
    return [
      {
        id: "chrome",
        label: "Google Chrome",
        locate: fromPaths(
          windowsPaths([
            "Google\\Chrome\\Application\\chrome.exe",
            "Google\\Chrome Beta\\Application\\chrome.exe",
          ]),
        ),
      },
      {
        id: "chromium",
        label: "Chromium",
        locate: fromPaths(windowsPaths(["Chromium\\Application\\chrome.exe"])),
      },
      {
        id: "brave",
        label: "Brave",
        locate: fromPaths(
          windowsPaths(["BraveSoftware\\Brave-Browser\\Application\\brave.exe"]),
        ),
      },
      {
        id: "edge",
        label: "Microsoft Edge",
        locate: fromPaths(windowsPaths(["Microsoft\\Edge\\Application\\msedge.exe"])),
      },
      {
        id: "vivaldi",
        label: "Vivaldi",
        locate: fromPaths(windowsPaths(["Vivaldi\\Application\\vivaldi.exe"])),
      },
    ];
  }
  return [
    { id: "chromium", label: "Chromium", locate: fromCommands(["chromium-browser", "chromium"]) },
    {
      id: "chrome",
      label: "Google Chrome",
      locate: fromCommands(["google-chrome-stable", "google-chrome"]),
    },
    { id: "brave", label: "Brave", locate: fromCommands(["brave-browser"]) },
    {
      id: "edge",
      label: "Microsoft Edge",
      locate: fromCommands(["microsoft-edge", "microsoft-edge-stable"]),
    },
    { id: "vivaldi", label: "Vivaldi", locate: fromCommands(["vivaldi-stable"]) },
  ];
}

function bundledPath(): string | null {
  try {
    const bundled = chromium.executablePath();
    return bundled && existsSync(bundled) ? bundled : null;
  } catch {
    // playwright-core throws when no browser is registered for this build.
    return null;
  }
}

export function isBrowserEngineId(value: unknown): value is BrowserEngineId {
  return typeof value === "string" && BROWSER_ENGINE_IDS.includes(value as BrowserEngineId);
}

function preferenceFilePath(): string {
  return path.join(resolveDataDir(), PREFERENCE_FILE);
}

/** Persisted choice, falling back to LOCAL_STUDIO_BROWSER_ENGINE, then "auto". */
export function readEnginePreference(): BrowserEngineId {
  try {
    const raw = readFileSync(preferenceFilePath(), "utf8");
    const parsed = JSON.parse(raw) as { engine?: unknown };
    if (isBrowserEngineId(parsed.engine)) return parsed.engine;
  } catch {
    // Missing or unreadable file — fall through to env, then the default.
  }
  const fromEnv = process.env.LOCAL_STUDIO_BROWSER_ENGINE?.trim().toLowerCase();
  return isBrowserEngineId(fromEnv) ? fromEnv : "auto";
}

export function writeEnginePreference(engine: BrowserEngineId): void {
  const file = preferenceFilePath();
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify({ engine }, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

export function explicitBinaryOverride(): string | null {
  return process.env.LOCAL_STUDIO_CHROME_PATH?.trim() || null;
}

/** Every selectable engine with the binary it resolves to on this machine. */
export function listBrowserEngines(): BrowserEngineInfo[] {
  return [
    { id: "auto", label: "Automatic", path: autoPath() },
    { id: "bundled", label: "Bundled Chromium", path: bundledPath() },
    ...engineSpecs().map((spec) => ({ id: spec.id, label: spec.label, path: spec.locate() })),
  ];
}

function autoPath(): string | null {
  return (
    bundledPath() ??
    engineSpecs().reduce<string | null>((found, spec) => found ?? spec.locate(), null)
  );
}

/**
 * Resolve the engine to launch, or throw a message naming the exact problem.
 * `preferenceUnavailable` is reported by the caller so a chosen-but-missing
 * browser degrades to a working default instead of killing the browser tool.
 */
const warnedStaleOverrides = new Set<string>();

export function resolveBrowserEngine(): ResolvedBrowserEngine {
  const override = explicitBinaryOverride();
  if (override) {
    if (existsSync(override)) {
      return { id: "custom", label: overrideLabel(override), path: override, source: "override" };
    }
    // A stale override degrades to auto-detection instead of killing the
    // browser tool outright: one forgotten env var otherwise reads as "the
    // browser broke", with a working Chromium sitting right there. Warned
    // once — this resolver runs on every frame poll.
    if (!warnedStaleOverrides.has(override)) {
      warnedStaleOverrides.add(override);
      console.warn(
        `[browser-engines] LOCAL_STUDIO_CHROME_PATH points at a missing binary (${override}); falling back to auto-detection`,
      );
    }
  }

  const preference = readEnginePreference();
  if (preference !== "auto") {
    const chosen = listBrowserEngines().find((engine) => engine.id === preference);
    if (chosen?.path) {
      return {
        id: chosen.id,
        label: chosen.label,
        path: chosen.path,
        source: preference === "bundled" ? "bundled" : "preference",
      };
    }
  }

  const bundled = bundledPath();
  if (bundled) {
    return { id: "bundled", label: "Bundled Chromium", path: bundled, source: "bundled" };
  }
  for (const spec of engineSpecs()) {
    const found = spec.locate();
    if (found) return { id: spec.id, label: spec.label, path: found, source: "detected" };
  }
  throw new BrowserEngineError(
    "Browser unavailable: no Chromium-based browser found — install Chrome or Brave, or set LOCAL_STUDIO_CHROME_PATH",
  );
}

function overrideLabel(binary: string): string {
  const base = path.basename(binary).replace(/\.exe$/i, "");
  return `${base} (LOCAL_STUDIO_CHROME_PATH)`;
}

export function tryResolveBrowserEngine(): ResolvedBrowserEngine | null {
  try {
    return resolveBrowserEngine();
  } catch {
    return null;
  }
}
