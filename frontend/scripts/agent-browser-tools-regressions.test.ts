import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSnippet } from "../src/features/agent/fs-store";
import {
  normalizeBrowserInput,
  resolveBrowserInput,
} from "../src/features/agent/tools/browser-url";
import {
  browserKeyInputs,
  browserMouseButton,
  browserViewportPoint,
} from "../src/features/agent/ui/agent-browser-input";
import { browserLocationUpdate } from "../src/features/agent/ui/agent-browser-location";
import { workspaceFilePath } from "../src/features/agent/workspace-file-link";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(frontendRoot, "..");

function frontendSource(path: string): string {
  return readFileSync(resolve(frontendRoot, path), "utf8");
}

test("desktop and web render the same CDP browser surface", () => {
  const browser = frontendSource("src/features/agent/ui/agent-browser.tsx");
  const panel = frontendSource("src/features/agent/ui/agent-browser-panel.tsx");
  const tabs = frontendSource("src/features/agent/ui/computer-tab-panel.tsx");
  assert.match(browser, /<ScreencastSurface/u);
  for (const value of [
    "isElectron",
    "WebviewElement",
    "webviewRef",
    "initialWebviewUrl",
    `<${"webview"}`,
  ]) {
    assert.equal(browser.includes(value), false, value);
  }
  assert.equal(panel.includes("isElectron"), false);
  assert.equal(tabs.includes("isElectron"), false);
});

test("desktop enables no guest webview capability", () => {
  const windowManager = frontendSource("desktop/logic/window-manager.ts");
  const security = frontendSource("desktop/logic/security.ts");
  assert.doesNotMatch(windowManager, new RegExp(`${"webview"}Tag\\s*:\\s*true`, "u"));
  assert.equal(security.includes(`will-attach-${"webview"}`), false);
  assert.equal(security.includes(`getType() === "${"webview"}"`), false);
});

test("visible navigation, state, history, viewport, and input use browser-host routes", () => {
  const browser = frontendSource("src/features/agent/ui/agent-browser.tsx");
  const panel = frontendSource("src/features/agent/ui/agent-browser-panel.tsx");
  const surface = frontendSource("src/features/agent/ui/agent-browser-screencast.tsx");
  const liveStore = frontendSource("src/features/agent/ui/agent-browser-live-store.ts");
  const extension = frontendSource("desktop/resources/pi-extensions/browser.ts");
  for (const verb of ["back", "forward", "reload"]) {
    assert.match(browser, new RegExp(`postLiveVerb\\(\"${verb}\"\\)`, "u"));
  }
  for (const route of ["frame", "navigate"]) {
    assert.equal(liveStore.includes(`/api/agent/browser/${route}`), true, route);
  }
  for (const route of ["input", "viewport"]) {
    assert.equal(surface.includes(`"${route}"`), true, route);
  }
  assert.equal(extension.includes("/api/agent/browser/${verb}"), true);
  assert.equal(panel.includes('fetch("/api/agent/browser/navigate"'), false);
  assert.equal(surface.includes("/api/agent/browser/navigate"), false);
  assert.equal(panel.includes("navigateBrowserHost(result.url)"), true);
  assert.equal(extension.includes("LOCAL_STUDIO_BROWSER_SESSION_HEADER"), true);
  assert.equal(extension.includes("sessionId: BROWSER_SESSION_ID"), false);
});

test("browser navigation rejects files and protected destinations", () => {
  const cwd = "/workspace/project";
  for (const value of [
    "file:///workspace/project/private.txt",
    "/workspace/project/private.txt",
    "./private.txt",
    "../private.txt",
    "http://10.0.0.1/private",
    "https://user:password@example.com/private",
  ]) {
    assert.equal(normalizeBrowserInput(value, cwd), "", value);
  }
  assert.equal(
    normalizeBrowserInput("http://localhost:3000/page", cwd),
    "http://localhost:3000/page",
  );
  assert.equal(normalizeBrowserInput("https://example.com/page", cwd), "https://example.com/page");
  assert.deepEqual(resolveBrowserInput("src/app.ts", cwd), {
    kind: "file",
    path: "src/app.ts",
  });
  assert.deepEqual(resolveBrowserInput("file:///workspace/project/src/app.ts", cwd), {
    kind: "file",
    path: "src/app.ts",
  });
  assert.equal(resolveBrowserInput("/workspace/private.txt", cwd).kind, "unsupported");
  assert.equal(resolveBrowserInput("ftp://example.com/private", cwd).kind, "unsupported");
});

test("browser location emits each observed host change once", () => {
  assert.deepEqual(browserLocationUpdate("", "https://page-a.test/"), {
    emittedUrl: "https://page-a.test/",
    location: "https://page-a.test/",
  });
  assert.deepEqual(browserLocationUpdate("https://page-a.test/", "https://page-b.test/"), {
    emittedUrl: "https://page-b.test/",
    location: "https://page-b.test/",
  });
  assert.deepEqual(browserLocationUpdate("https://page-b.test/", "https://page-b.test/"), {
    emittedUrl: "https://page-b.test/",
    location: null,
  });
});

test("pointer and keyboard input preserve viewport and shortcut behavior", () => {
  assert.deepEqual(
    browserViewportPoint(
      { height: 400, left: 100, top: 50, width: 800 },
      { height: 800, width: 1600 },
      { clientX: 500, clientY: 250 },
    ),
    { x: 800, y: 400 },
  );
  assert.deepEqual(
    browserViewportPoint(null, { height: 800, width: 1600 }, { clientX: 500, clientY: 250 }),
    { x: 0, y: 0 },
  );
  assert.equal(browserMouseButton(0), "left");
  assert.equal(browserMouseButton(1), "middle");
  assert.equal(browserMouseButton(2), "right");
  assert.deepEqual(
    browserKeyInputs("down", {
      altKey: false,
      code: "KeyA",
      ctrlKey: false,
      key: "a",
      metaKey: false,
    }),
    [
      { code: "KeyA", key: "a", kind: "key", type: "down" },
      { code: "KeyA", key: "a", kind: "key", text: "a", type: "char" },
    ],
  );
  assert.deepEqual(
    browserKeyInputs("down", {
      altKey: false,
      code: "KeyK",
      ctrlKey: false,
      key: "k",
      metaKey: true,
    }),
    [],
  );
  assert.deepEqual(
    browserKeyInputs("down", {
      altKey: false,
      code: "Enter",
      ctrlKey: false,
      key: "Enter",
      metaKey: false,
    }),
    [
      { code: "Enter", key: "Enter", kind: "key", type: "down" },
      { code: "Enter", key: "Enter", kind: "key", text: "\r", type: "char" },
    ],
  );
});

test("workspace file intent is lexical, bounded, and platform-neutral", () => {
  for (const [value, cwd, expected] of [
    ["src/app.ts", "/workspace/project", "src/app.ts"],
    ["/workspace/project/src/app.ts", "/workspace/project", "src/app.ts"],
    ["file:///workspace/project/src/app.ts", "/workspace/project", "src/app.ts"],
    ["C:\\workspace\\project\\src\\app.ts", "C:\\workspace\\project", "src/app.ts"],
  ]) {
    assert.equal(workspaceFilePath(value, cwd), expected, value);
  }
  for (const value of [
    "../secret.txt",
    "/workspace/secret.txt",
    "file:///workspace/secret.txt",
    "file:///workspace/project/%2e%2e/secret.txt",
    "file:///workspace/project/%ZZ/secret.txt",
    "file:///workspace/project/%00secret.txt",
  ]) {
    assert.equal(workspaceFilePath(value, "/workspace/project"), null, value);
  }
});

test("assistant file links use the Files action", () => {
  const markdown = frontendSource("src/features/agent/ui/assistant-markdown.tsx");
  assert.equal(markdown.includes("requestFileOpen"), true);
  assert.equal(markdown.includes("Local paths resolve to a file:// URL"), false);
});

test("the Files API retains the workspace root boundary", () => {
  const store = readFileSync(
    resolve(repositoryRoot, "frontend/src/features/agent/fs-store.ts"),
    "utf8",
  );
  const route = readFileSync(
    resolve(repositoryRoot, "frontend/src/app/api/agent/fs/file/route.ts"),
    "utf8",
  );
  assert.match(store, /ensureInside\(root, path\.resolve\(root, relPath\)\)/u);
  assert.match(store, /Path escapes project root/u);
  assert.match(route, /readFileSnippet\(cwd, relPath\)/u);
  assert.doesNotMatch(route, /file:\/\//u);
});

test("the Files API rejects a real path traversal before reading", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-studio-file-boundary-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await writeFile(join(workspace, "inside.txt"), "inside", "utf8");
  await writeFile(join(root, "outside.txt"), "outside", "utf8");
  try {
    assert.deepEqual(await readFileSnippet(workspace, "inside.txt"), {
      content: "inside",
      size: 6,
      truncated: false,
    });
    await assert.rejects(readFileSnippet(workspace, "../outside.txt"), /escapes project root/u);
    await assert.rejects(readFileSnippet("/", "etc/passwd"), /allowed workspace root/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
