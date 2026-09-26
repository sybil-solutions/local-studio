import { mkdirSync } from "node:fs";
import { Hono } from "hono";
import type { AgentLaunchResult, AgentSession, GatewayModel, Harness } from "@local-studio/contracts";
import { AgentLaunchBody, IssueKeyBody } from "@local-studio/contracts";
import type { Ctx, Env, Services } from "../context";
import type { DshManager } from "./dsh";
import { prepareClaudeDesktop, prepareCodexDesktop } from "./desktop";
import { PACKAGES, type CliHarness, type HarnessManager } from "./harnesses";
import { ensureClientKey, forgetKeyId } from "./keys";
import { clientOf, isTerminal } from "./launch-table";
import { defaultDir, expandDir, forgetSpec, listSpecs, newSessionId, readSpec, writeSpec } from "./sessions";
import { hasGui, openTerminal, resolveTerminal } from "./terminals";
import { agentRunCommand, attachCommand, capture, childArgs, killSession, panes, sessionName, startSession, tmuxBin } from "./tmux";

export const gatewayUrlFor = (ctx: Ctx): string => {
  const h = ctx.config.host;
  const loop = h === "0.0.0.0" || h === "::" || h === "127.0.0.1" || h === "localhost" || h === "::1";
  return `http://${loop ? "127.0.0.1" : h}:${ctx.config.port}`;
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

const isCli = (h: string): h is CliHarness => h in PACKAGES;

export interface AgentSessions {
  list(): Promise<AgentSession[]>;
  cached(): AgentSession[];
}

export const createSessions = (ctx: Ctx, dsh: DshManager): AgentSessions => {
  let last: AgentSession[] = [];
  const list = async (): Promise<AgentSession[]> => {
    const home = ctx.config.home;
    const tmux = await tmuxBin();
    const live = tmux ? await panes(ctx, tmux) : [];
    const out: AgentSession[] = [];
    for (const s of listSpecs(home)) {
      const p = live.find((x) => x.name === s.tmuxSession);
      if (p?.dead && tmux && Date.now() - s.startedAt > 10_000) await killSession(ctx, tmux, s.tmuxSession);
      if (!p || p.dead) {
        if (Date.now() - s.startedAt > 10_000) forgetSpec(home, s.id);
        continue;
      }
      out.push({ id: s.id, harness: s.harness, model: s.model, dir: s.dir, bin: s.bin, startedAt: s.startedAt, tmuxSession: s.tmuxSession, attach: tmux ? attachCommand(tmux, s.tmuxSession) : null, url: null });
    }
    const d = dsh.status();
    if (d.running) out.push({ id: "dsh", harness: "dsh", model: "", dir: d.cwd ?? "", bin: null, startedAt: d.startedAt ?? 0, tmuxSession: null, attach: null, url: d.url });
    last = out;
    return out;
  };
  return { list, cached: () => last };
};

export const createAgentRoutes = (ctx: Ctx, svc: Services, deps: { dsh: DshManager; harnesses: HarnessManager; sessions: AgentSessions }) => {
  const { dsh, harnesses, sessions } = deps;
  const r = new Hono<Env>();
  const bad = (message: string, status: 400 | 404 | 409 | 500 | 502 = 400, code = "BAD_REQUEST") => Response.json({ error: { code, message } }, { status });
  const body = async (c: { req: { json: () => Promise<unknown> } }): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      return undefined;
    }
  };

  r.get("/api/agents", async (c) => c.json(await harnesses.list()));

  r.post("/api/agents/:harness/install", (c) => {
    const h = c.req.param("harness");
    if (!isCli(h)) return bad(`no installable harness ${h}`, 404, "NOT_FOUND");
    return c.json(harnesses.install(h), 202);
  });

  r.get("/api/agents/sessions", async (c) => c.json(await sessions.list()));

  r.delete("/api/agents/sessions/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "dsh") {
      dsh.stop();
      return c.json({ ok: true, id });
    }
    const s = readSpec(ctx.config.home, id);
    if (!s) return bad(`no session ${id}`, 404, "NOT_FOUND");
    const tmux = await tmuxBin();
    if (tmux) await killSession(ctx, tmux, s.tmuxSession);
    forgetSpec(ctx.config.home, id);
    ctx.log.info(`agent ${s.harness} ${id}: stopped`);
    return c.json({ ok: true, id });
  });

  r.post("/api/agents/sessions/:id/attach", async (c) => {
    const s = readSpec(ctx.config.home, c.req.param("id"));
    const tmux = await tmuxBin();
    if (!s || !tmux) return bad(`no session ${c.req.param("id")}`, 404, "NOT_FOUND");
    const t = hasGui() ? await resolveTerminal(c.req.query("terminal") ?? process.env.LOCAL_STUDIO_AGENT_TERMINAL) : null;
    if (!t) return bad("no terminal on this machine", 409, "NO_TERMINAL");
    const o = await openTerminal(ctx, t, { command: attachCommand(tmux, s.tmuxSession), dir: s.dir, name: `${s.harness} ${s.id}` });
    return o.ok ? c.json({ ok: true, id: s.id, terminal: o.detail }) : bad(o.detail, 500, "TERMINAL");
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
    const harness: Harness = b.harness;
    const terminalPref = c.req.query("terminal") ?? process.env.LOCAL_STUDIO_AGENT_TERMINAL ?? "auto";
    const dir = b.dir ? expandDir(b.dir) : defaultDir(ctx.config.home, harness);
    try {
      mkdirSync(dir, { recursive: true });
    } catch (e) {
      return bad(`cannot use folder ${dir}: ${String(e)}`);
    }
    const models = gatewayModels(svc);
    const gm = models.find((m) => m.id.toLowerCase() === b.model.toLowerCase()) ?? null;
    const gatewayUrl = gatewayUrlFor(ctx);
    const { keyFile } = ensureClientKey(ctx.db, ctx.keys, ctx.config.home, clientOf(harness));
    const warn = gm ? "" : ` (model ${b.model} is not in the gateway's model list right now; context window unknown)`;
    const id = newSessionId();

    if (isCli(harness)) {
      const found = await harnesses.resolve(harness);
      if (!found) return bad(`${harness} is not installed; install it from the harness list (${PACKAGES[harness].pkg})`, 409, "NOT_INSTALLED");
      const path = await harnesses.searchPath();
      const base = { sessionId: id, harness, bin: found.bin, version: found.version, dir };

      if (harness === "dsh") {
        const list = models.map((m) => ({ id: m.id, contextWindow: m.contextWindow, vision: m.vision }));
        if (!gm) list.push({ id: b.model, contextWindow: null, vision: null });
        const out = await dsh.ensure({ bin: found.bin, path, models: list, defaultModel: b.model, cwd: dir, keyFile, gatewayUrl });
        if (!out.ok) return bad(`dsh: ${out.detail}`, 502, "DSH");
        const s = dsh.status();
        ctx.log.info(`agent dsh: ${out.detail} (${found.bin} ${found.version ?? ""})`);
        const res: AgentLaunchResult = { ...base, sessionId: "dsh", how: "web", command: `dsh web --port ${s.port} --no-open (DSH_HOME=${s.home})`, url: dsh.takeLoginUrl() ?? s.url, tmuxSession: null, attach: null };
        return c.json({ ...res, note: `${out.detail}${warn}` });
      }

      if (!isTerminal(harness)) return bad(`${harness} cannot run in a terminal`);
      const tmux = await tmuxBin();
      if (!tmux) return bad("tmux is not installed; terminal agents run inside tmux", 500, "NO_TMUX");
      const name = sessionName(harness, id);
      writeSpec(ctx.config.home, {
        id,
        harness,
        model: b.model,
        dir,
        bin: found.bin,
        path,
        contextWindow: gm?.contextWindow ?? null,
        vision: gm?.vision ?? null,
        gatewayUrl,
        safe: b.safe ?? false,
        tmuxSession: name,
        startedAt: Date.now(),
      });
      const cmd = agentRunCommand(ctx.config.home, id);
      const err = await startSession(ctx, tmux, name, dir, cmd);
      if (err) {
        forgetSpec(ctx.config.home, id);
        return bad(`tmux: ${err}`, 500, "TMUX");
      }
      let running: string | null = null;
      for (let i = 0; i < 12 && !running; i++) {
        await Bun.sleep(250);
        const p = (await panes(ctx, tmux)).find((x) => x.name === name);
        if (!p || p.dead) {
          const out = p ? await capture(ctx, tmux, name) : "";
          await killSession(ctx, tmux, name);
          forgetSpec(ctx.config.home, id);
          return bad(`${harness} exited right after start${out ? `: ${out}` : ""}`, 502, "AGENT_EXITED");
        }
        running = await childArgs(ctx, p.pid);
      }
      const attach = attachCommand(tmux, name);
      let how: AgentLaunchResult["how"] = "tmux";
      let detail = `started ${found.bin} in tmux ${name}`;
      if (terminalPref !== "none" && hasGui()) {
        const t = await resolveTerminal(terminalPref);
        if (t) {
          const o = await openTerminal(ctx, t, { command: attach, dir, name: `${harness} ${id}` });
          if (o.ok) how = "terminal";
          detail += o.ok ? `, opened ${o.detail}` : `, terminal failed: ${o.detail}`;
        }
      }
      ctx.log.info(`agent ${harness} ${id}: ${detail}${warn}`);
      const res: AgentLaunchResult = { ...base, how, command: cmd, url: null, tmuxSession: name, attach: hasGui() ? attach : `ssh -t ${ctx.identity.hostname} ${attach}`, running };
      void sessions.list();
      return c.json({ ...res, note: `${detail}${warn}` });
    }

    const input = { home: ctx.config.home, dir, model: b.model, contextWindow: gm?.contextWindow ?? null, keyFile, gatewayUrl, sessionId: id };
    const prep = harness === "codex-desktop" ? prepareCodexDesktop(input) : prepareClaudeDesktop(input);
    ctx.log.info(`agent ${harness} ${id}: prepared ${prep.files.length} files under ${ctx.config.home}/agents`);
    const res: AgentLaunchResult = { sessionId: id, harness, how: "app", bin: null, version: null, dir, command: prep.command, url: null, tmuxSession: null, attach: null };
    return c.json({ ...res, files: prep.files, note: prep.note, verify: "by hand" });
  });

  return r;
};
