import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { AgentLaunchResult, GatewayModel, Harness, HarnessInfo, Workspace } from "@local-studio/contracts";
import { AgentLaunchBody, IssueKeyBody } from "@local-studio/contracts";
import type { Ctx, Env, Services } from "../context";
import { which } from "../core/exec";
import { claudeHasHistory } from "./cli";
import type { DshManager } from "./dsh";
import { prepareClaudeDesktop, prepareCodexDesktop } from "./desktop";
import { ensureClientKey, forgetKeyId } from "./keys";
import { SAFE_FLAG, clientOf, isTerminal } from "./launch-table";
import { hasGui, openTerminal, resolveTerminal } from "./terminals";
import { TMUX_SOCKET, agentRunCommand, attachCommand, sessionName, startSession, tmuxBin } from "./tmux";
import type { WorkspaceStore } from "./workspaces";

const BIN_DIRS = [join(homedir(), ".local", "bin"), join(homedir(), ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
const APPS: Partial<Record<Harness, string>> = { "codex-desktop": "/Applications/Codex.app", "claude-desktop": "/Applications/Claude.app" };

export const gatewayUrlFor = (ctx: Ctx): string => {
  const h = ctx.config.host;
  const loop = h === "0.0.0.0" || h === "::" || h === "127.0.0.1" || h === "localhost" || h === "::1";
  return `http://${loop ? "127.0.0.1" : h}:${ctx.config.port}`;
};

const firstLine = (s: string) => s.trim().split("\n")[0]?.trim() ?? "";

export const probeHarnesses = async (ctx: Ctx, dsh: DshManager): Promise<HarnessInfo[]> => {
  const cli = async (harness: "claude" | "codex" | "pi" | "omp"): Promise<HarnessInfo> => {
    const path = await which(harness, BIN_DIRS);
    let version: string | null = null;
    if (path) {
      const r = await ctx.exec([path, "--version"], { timeoutMs: 5000 });
      if (r.code === 0) version = firstLine(r.stdout).replace(/^(codex-cli\s+|omp\/)/, "").replace(/\s*\(Claude Code\)$/, "") || null;
    }
    return { harness, installed: !!path, path, version, tier: 1, note: path ? "runs in tmux in the workspace dir" : `${harness} not found on PATH` };
  };
  const app = async (harness: "codex-desktop" | "claude-desktop"): Promise<HarnessInfo> => {
    const path = process.platform === "darwin" ? APPS[harness]! : null;
    const ok = !!path && existsSync(path);
    let version: string | null = null;
    if (ok) {
      const r = await ctx.exec(["plutil", "-extract", "CFBundleShortVersionString", "raw", join(path!, "Contents", "Info.plist")], { timeoutMs: 5000 });
      if (r.code === 0) version = firstLine(r.stdout) || null;
    }
    return { harness, installed: ok, path: ok ? path : null, version, tier: 2, note: "prepare writes config under the Local Studio home; verify by hand" };
  };
  const d = dsh.status();
  const dshInfo: HarnessInfo = {
    harness: "dsh",
    installed: d.installed,
    path: d.installed ? (process.env.LOCAL_STUDIO_DSH_BIN || join(ctx.config.home, "dsh-runtime", "node_modules", ".bin", "dsh")) : null,
    version: d.version,
    tier: 1,
    note: d.installed ? `dsh web on :${d.port ?? 3090}, DSH_HOME=${d.home}` : "installed on first launch (npm i @deepseek-ai/dsh@latest)",
  };
  return [dshInfo, ...(await Promise.all([cli("claude"), cli("codex"), cli("pi"), cli("omp"), app("codex-desktop"), app("claude-desktop")]))];
};

const resolveModel = (svc: Services, model: string): GatewayModel | null => {
  let list: GatewayModel[] = [];
  try {
    list = svc.gateway.models();
  } catch {}
  if (list.length === 0) {
    try {
      list = svc.peers.models();
    } catch {}
  }
  const lc = model.toLowerCase();
  return list.find((m) => m.id.toLowerCase() === lc) ?? null;
};

const gatewayModels = (svc: Services): GatewayModel[] => {
  try {
    const g = svc.gateway.models();
    if (g.length > 0) return g;
  } catch {}
  try {
    return svc.peers.models();
  } catch {
    return [];
  }
};

export const createAgentRoutes = (
  ctx: Ctx,
  svc: Services,
  deps: { store: WorkspaceStore; dsh: DshManager; harnesses: () => HarnessInfo[]; refreshHarnesses: () => Promise<HarnessInfo[]> },
) => {
  const { store, dsh } = deps;
  const r = new Hono<Env>();
  const bad = (message: string, status: 400 | 404 | 409 | 500 | 502 = 400, code = "BAD_REQUEST") => Response.json({ error: { code, message } }, { status });
  const body = async (c: { req: { json: () => Promise<unknown> } }): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      return undefined;
    }
  };

  r.get("/api/agents", async (c) => c.json(await deps.refreshHarnesses()));

  r.get("/api/workspaces", (c) => c.json(store.list()));

  r.delete("/api/workspaces/:id", (c) => {
    const id = c.req.param("id");
    if (!store.remove(id)) return bad(`no workspace ${id}`, 404, "NOT_FOUND");
    return c.json({ ok: true, id, dirKept: true });
  });

  r.post("/api/keys", async (c) => {
    const parsed = IssueKeyBody.safeParse(await body(c));
    if (!parsed.success) return bad(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const { info, key } = ctx.keys.issue(parsed.data.client, parsed.data.label, parsed.data.scope, parsed.data.actions);
    ctx.log.info(`key issued: ${info.id} client=${info.client} scope=${info.scope}${info.actions ? "+actions" : ""}`);
    return c.json({ ...info, key }, 201);
  });

  r.delete("/api/keys/:id", (c) => {
    const id = c.req.param("id");
    if (id === "admin" || !ctx.keys.revoke(id)) return bad(`no revocable key ${id}`, 404, "NOT_FOUND");
    forgetKeyId(ctx.db, id);
    ctx.log.info(`key revoked: ${id}`);
    return c.json({ ok: true, id });
  });

  r.post("/api/agents/launch", async (c) => {
    const parsed = AgentLaunchBody.safeParse(await body(c));
    if (!parsed.success) return bad(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const b = parsed.data;
    const terminalPref = c.req.query("terminal") ?? process.env.LOCAL_STUDIO_AGENT_TERMINAL ?? "auto";
    let ws: Workspace | undefined;
    if (b.workspaceId) {
      ws = store.get(b.workspaceId);
      if (!ws) return bad(`no workspace ${b.workspaceId}`, 404, "NOT_FOUND");
      if (ws.harness !== b.harness) return bad(`workspace ${ws.id} belongs to ${ws.harness}, not ${b.harness}`, 409, "CONFLICT");
    } else if (b.dir) ws = store.findByDir(b.dir, b.harness);
    const wasOpened = ws?.lastOpenAt != null;
    const flags = b.safe === undefined ? ws?.flags : b.safe ? [...new Set([...(ws?.flags ?? []), SAFE_FLAG])] : (ws?.flags ?? []).filter((f) => f !== SAFE_FLAG);
    ws ??= store.create({ name: b.name, dir: b.dir, harness: b.harness, model: b.model, flags: flags ?? [] });
    const gm = resolveModel(svc, b.model);
    const gatewayUrl = gatewayUrlFor(ctx);
    const rt = { contextWindow: gm?.contextWindow ?? null, vision: gm?.vision ?? null, gatewayUrl };
    const client = clientOf(b.harness);
    const { keyFile } = ensureClientKey(ctx.db, ctx.keys, ctx.config.home, client);
    store.opened(ws.id, { model: b.model, flags, ...rt });
    const warn = gm ? "" : ` (model ${b.model} is not in the gateway's model list right now; context window unknown)`;

    if (isTerminal(b.harness)) {
      const tmux = await tmuxBin();
      if (!tmux) return bad("tmux is not installed; terminal agents run inside tmux", 500, "NO_TMUX");
      const name = sessionName(ws.id);
      const resume = b.resume ?? (wasOpened && (b.harness !== "claude" || claudeHasHistory(ctx.config.home, ws.id, ws.dir)));
      const cmd = agentRunCommand(ctx.config.home, ws.id, resume);
      const started = await startSession(ctx, tmux, name, ws.dir, cmd);
      if (started.error) return bad(`tmux: ${started.error}`, 500, "TMUX");
      const attachLocal = attachCommand(tmux, name, ws.dir, agentRunCommand(ctx.config.home, ws.id, true));
      let how: AgentLaunchResult["how"] = "tmux";
      let detail = started.created ? `started tmux session ${name}` : `attached to existing tmux session ${name}`;
      if (terminalPref !== "none" && hasGui()) {
        const t = await resolveTerminal(terminalPref);
        if (t) {
          const o = await openTerminal(ctx, t, { command: attachLocal, dir: ws.dir, name: `${ws.name} ${ws.id}` });
          if (o.ok) how = "terminal";
          detail += o.ok ? `, opened ${o.detail}` : `, terminal failed: ${o.detail}`;
        }
      }
      ctx.log.info(`agent ${b.harness} ${ws.id}: ${detail}${warn}`);
      const tmuxAttach = `tmux ${TMUX_SOCKET.join(" ")} attach -t ${name}`;
      const attach = hasGui() ? tmuxAttach : `ssh -t ${ctx.identity.hostname} ${tmuxAttach}`;
      const res: AgentLaunchResult = { workspaceId: ws.id, harness: b.harness, how, command: cmd, url: null, tmuxSession: name, attach };
      return c.json({ ...res, created: started.created, resume, note: `${detail}${warn}` });
    }

    if (b.harness === "dsh") {
      const models = gatewayModels(svc).map((m) => ({ id: m.id, contextWindow: m.contextWindow, vision: m.vision }));
      if (!models.some((m) => m.id.toLowerCase() === b.model.toLowerCase())) models.push({ id: b.model, contextWindow: rt.contextWindow, vision: rt.vision });
      const out = await dsh.ensure({ models, defaultModel: b.model, cwd: ws.dir, keyFile, gatewayUrl });
      if (!out.ok) return bad(`dsh: ${out.detail}`, 502, "DSH");
      const s = dsh.status();
      void deps.refreshHarnesses();
      const res: AgentLaunchResult = {
        workspaceId: ws.id,
        harness: "dsh",
        how: "web",
        command: `dsh web --port ${s.port ?? 3090} --no-open (DSH_HOME=${s.home})`,
        url: dsh.takeLoginUrl() ?? s.url,
        tmuxSession: null,
        attach: null,
      };
      return c.json({ ...res, note: `${out.detail}${warn}` });
    }

    const input = { home: ctx.config.home, dir: ws.dir, model: b.model, contextWindow: rt.contextWindow, keyFile, gatewayUrl, workspaceId: ws.id };
    const prep = b.harness === "codex-desktop" ? prepareCodexDesktop(input) : prepareClaudeDesktop(input);
    ctx.log.info(`agent ${b.harness} ${ws.id}: prepared ${prep.files.length} files under ${ctx.config.home}/agents`);
    const res: AgentLaunchResult = { workspaceId: ws.id, harness: b.harness, how: "app", command: prep.command, url: null, tmuxSession: null, attach: null };
    return c.json({ ...res, files: prep.files, note: `${prep.note}${warn}`, verify: "by hand" });
  });

  return r;
};
