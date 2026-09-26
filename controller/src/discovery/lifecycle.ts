import type { LaunchPlan, LaunchProgress, RunningModel } from "@local-studio/contracts";
import { migrate } from "../core/db";
import { redact } from "../core/log";
import type { Ctx, DockerInspect, LifecycleService, RuntimeView, Services } from "../context";
import { imageInfo, inspectContainers, type Inspect } from "./docker";
import { get } from "./probe";
import { ancestors, descendants, listListeners, listProcs } from "./procs";
import { parseModels } from "./probe";

const REFUSE = /enforce.eager|disable.?cuda.?graph/i;
const SECRET_KEY = /KEY|TOKEN|SECRET|PASSWORD/i;
const TERMINAL = new Set(["ready", "failed", "cancelled"]);

export interface LifecycleDeps {
  ctx: Ctx;
  svc: Services;
  view(): RuntimeView;
  rescan(): Promise<RuntimeView>;
  setStopping(id: string, on: boolean): void;
}

export const dockerArgv = (plan: LaunchPlan, machineId: string): string[] => {
  const own = new Set(["local-studio.managed", "local-studio.recipe", "local-studio.machine"]);
  const argv = [
    "docker",
    "run",
    "-d",
    "--name",
    plan.containerName,
    "--label",
    "local-studio.managed=1",
    "--label",
    `local-studio.recipe=${plan.recipeId}`,
    "--label",
    `local-studio.machine=${machineId}`,
  ];
  for (const [k, v] of Object.entries(plan.labels ?? {}).sort()) if (!own.has(k)) argv.push("--label", `${k}=${v}`);
  if (plan.gpuUuids.length) argv.push("--gpus", `"device=${plan.gpuUuids.join(",")}"`);
  if (plan.shm) argv.push("--shm-size", plan.shm);
  if (plan.entrypoint) argv.push("--entrypoint", plan.entrypoint);
  argv.push("-p", `127.0.0.1:${plan.hostPort}:${plan.containerPort}`);
  for (const m of plan.mounts) argv.push("-v", `${m.source}:${m.target}${m.readOnly ? ":ro" : ""}`);
  for (const [k, v] of Object.entries(plan.env).sort(([a], [b]) => a.localeCompare(b))) argv.push("-e", `${k}=${v}`);
  argv.push(plan.image, ...plan.args);
  return argv;
};

const redactArgv = (argv: string[]): string =>
  redact(argv.map((a) => (/^[A-Z_][A-Z0-9_]*=/.test(a) && SECRET_KEY.test(a.split("=")[0] ?? "") ? `${a.split("=")[0]}=[redacted]` : a)).join(" "));

const bindable = async (port: number): Promise<boolean> => {
  for (const hostname of ["127.0.0.1", "0.0.0.0"]) {
    try {
      const s = Bun.listen({ hostname, port, socket: { data() {} } });
      s.stop(true);
    } catch {
      return false;
    }
  }
  return true;
};

const firstErrorLine = (logs: string): string => {
  const lines = logs.split("\n").map((l) => l.trim()).filter(Boolean);
  return redact(lines.find((l) => /error|exception|traceback|failed|fatal|killed|oom/i.test(l)) ?? lines.at(-1) ?? "container exited");
};

export const createLifecycle = (d: LifecycleDeps): LifecycleService => {
  const { ctx } = d;
  migrate(ctx.db, "discovery", [
    "CREATE TABLE launch_history (recipe_id TEXT NOT NULL, started_at INTEGER NOT NULL, load_seconds REAL NOT NULL)",
    "CREATE INDEX launch_history_recipe ON launch_history (recipe_id, started_at)",
  ]);
  const launches = new Map<string, LaunchProgress & { cancelled?: boolean; containerStarted?: boolean }>();
  const reserved = new Set<string>();

  const update = (id: string, patch: Partial<LaunchProgress>) => {
    const cur = launches.get(id);
    if (!cur) return;
    Object.assign(cur, patch, { updatedAt: Date.now() });
    const { cancelled: _c, containerStarted: _s, ...pub } = cur;
    ctx.bus.emit({ type: "launch", data: pub });
  };

  const expectedSeconds = async (recipeId: string): Promise<number> => {
    const rows = ctx.db
      .query<{ s: number }, [string]>("SELECT load_seconds AS s FROM launch_history WHERE recipe_id = ? ORDER BY started_at DESC LIMIT 1")
      .all(recipeId);
    if (rows[0]) return rows[0].s;
    try {
      const cat = await d.svc.recipes.catalog();
      const r = cat.recipes.find((x) => x.id === recipeId);
      if (r?.sizeGb) return r.sizeGb * 6;
    } catch {}
    return 600;
  };

  const dockerLogs = async (name: string, tail: number): Promise<string> => {
    const r = await ctx.exec(["docker", "logs", "--tail", String(tail), name], { timeoutMs: 10000, maxBytes: 4 * 1024 * 1024 });
    return redact(`${r.stdout}${r.stderr}`);
  };

  const removeContainer = async (name: string) => {
    await ctx.exec(["docker", "stop", "-t", "30", name], { timeoutMs: 45000 });
    await ctx.exec(["docker", "rm", name], { timeoutMs: 15000 });
  };

  const run = async (id: string, plan: LaunchPlan) => {
    const cur = () => launches.get(id)!;
    const fail = (msg: string) => update(id, { phase: "failed", error: msg, detail: msg, percent: null });
    const t0 = Date.now();
    try {
      const view = d.view();
      for (const key of plan.gpuKeys) {
        const g = view.groups.find((x) => x.gpuKeys.includes(key));
        if (!g) return fail(`GPU ${key} not found`);
        if (g.state !== "available") return fail(`GPU ${key} is ${g.state === "foreign" ? "in use by another program" : g.state}`);
        if (reserved.has(key)) return fail(`GPU ${key} is reserved by another launch`);
      }
      for (const key of plan.gpuKeys) reserved.add(key);
      const uuids = plan.gpuUuids.length ? plan.gpuUuids : plan.gpuKeys.map((k) => view.gpus.find((g) => g.key === k)?.uuid).filter((u): u is string => !!u);
      const [lo, hi] = ctx.config.managedPortRange;
      let hostPort = plan.hostPort >= lo && plan.hostPort <= hi && (await bindable(plan.hostPort)) ? plan.hostPort : 0;
      for (let p = lo; !hostPort && p <= hi; p++) if (await bindable(p)) hostPort = p;
      if (!hostPort) return fail(`no free port in ${lo}-${hi}`);
      const final: LaunchPlan = { ...plan, gpuUuids: uuids, hostPort };
      if (cur().cancelled) return;
      update(id, { phase: "pulling", detail: `checking image ${plan.image}` });
      if (!(await imageInfo(ctx, plan.image))) {
        update(id, { detail: `docker pull ${plan.image}` });
        const pull = await ctx.exec(["docker", "pull", plan.image], { timeoutMs: 60 * 60 * 1000 });
        if (pull.code !== 0) return fail(`docker pull failed: ${redact(pull.stderr.trim().split("\n").at(-1) ?? "")}`);
      }
      if (cur().cancelled) return;
      update(id, { phase: "starting", detail: "docker run" });
      const argv = dockerArgv(final, ctx.identity.machineId);
      ctx.log.info(`launch ${plan.recipeId}: ${redactArgv(argv)}`);
      const r = await ctx.exec(argv, { timeoutMs: 120000 });
      if (r.code !== 0) return fail(`docker run failed: ${redact(r.stderr.trim().split("\n").at(-1) ?? "")}`);
      cur().containerStarted = true;
      const expected = await expectedSeconds(plan.recipeId);
      const base = `http://127.0.0.1:${hostPort}`;
      update(id, { phase: "loading", detail: `waiting for ${base}/health`, percent: 0 });
      const deadline = Date.now() + 30 * 60 * 1000;
      while (Date.now() < deadline) {
        if (cur().cancelled) return;
        await Bun.sleep(3000);
        const [c] = await inspectContainers(ctx, [plan.containerName]);
        if (!c || !c.State.Running || (c.RestartCount ?? 0) >= 2) return fail(firstErrorLine(await dockerLogs(plan.containerName, 80)));
        const h = await get(ctx, `${base}/health`);
        if (h.status === 200) {
          const m = await get(ctx, `${base}/v1/models`);
          if (m.status === 200 && parseModels(m.body)?.length) {
            const secs = (Date.now() - t0) / 1000;
            ctx.db.query("INSERT INTO launch_history (recipe_id, started_at, load_seconds) VALUES (?, ?, ?)").run(plan.recipeId, t0, secs);
            update(id, { phase: "ready", percent: 100, detail: `ready after ${Math.round(secs)} s` });
            void d.rescan();
            return;
          }
        }
        const elapsed = (Date.now() - t0) / 1000;
        update(id, { percent: Math.min(95, Math.round((elapsed / expected) * 100)), detail: `loading ${Math.round(elapsed)} s of ~${Math.round(expected)} s` });
      }
      fail("not ready after 30 min");
    } catch (e) {
      fail(String(e));
    } finally {
      for (const key of plan.gpuKeys) reserved.delete(key);
    }
  };

  const findModel = (id: string): RunningModel | undefined => d.view().models.find((m) => m.id === id);

  return {
    dockerArgv: (plan) => dockerArgv(plan, ctx.identity.machineId),
    launch(plan) {
      const now = Date.now();
      const launchId = `L${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const p: LaunchProgress = {
        launchId,
        recipeId: plan.recipeId,
        modelId: plan.containerName,
        phase: "planning",
        percent: null,
        detail: "planning",
        error: null,
        startedAt: now,
        updatedAt: now,
        gpuKeys: plan.gpuKeys,
        machineId: ctx.identity.machineId,
      };
      launches.set(launchId, { ...p });
      if (REFUSE.test(JSON.stringify({ a: plan.args, e: plan.env, p: plan.entrypoint }))) {
        update(launchId, { phase: "failed", error: "refused: plan contains enforce-eager or disable-cuda-graph", detail: "refused" });
      } else if (ctx.config.readOnly) {
        update(launchId, { phase: "failed", error: "refused: controller runs with --read-only", detail: "refused" });
      } else {
        ctx.bus.emit({ type: "launch", data: p });
        void run(launchId, plan);
      }
      const { cancelled: _c, containerStarted: _s, ...pub } = launches.get(launchId)!;
      return pub;
    },
    progress: () => {
      for (const [id, l] of launches) if (TERMINAL.has(l.phase) && Date.now() - l.updatedAt > 10 * 60 * 1000) launches.delete(id);
      return [...launches.values()].map(({ cancelled: _c, containerStarted: _s, ...pub }) => pub);
    },
    cancel(launchId) {
      const l = launches.get(launchId);
      if (!l || TERMINAL.has(l.phase) || ctx.config.readOnly) return false;
      l.cancelled = true;
      update(launchId, { phase: "cancelled", detail: "cancelled", percent: null });
      void (async () => {
        const [c] = await inspectContainers(ctx, [l.modelId ?? ""]);
        if (c && c.Config.Labels?.["local-studio.managed"] === "1" && c.Config.Labels["local-studio.machine"] === ctx.identity.machineId)
          await removeContainer(l.modelId ?? "");
        await d.rescan();
      })();
      return true;
    },
    async stop(modelId, opts) {
      if (ctx.config.readOnly) return { ok: false, detail: "refused: controller runs with --read-only" };
      const m = findModel(modelId);
      if (!m) return { ok: false, detail: `model ${modelId} not found` };
      if (opts.confirm !== m.id) return { ok: false, detail: "confirm must equal the model id" };
      if (m.watchdog && !opts.force) return { ok: false, detail: `a watchdog (${m.watchdog}) may restart this model; pass force to stop anyway` };
      const rt = m.runtime;
      if (rt.kind === "docker") {
        const [c] = await inspectContainers(ctx, [rt.containerName]);
        if (!c || c.Id !== rt.containerId || !c.State.Running) return { ok: false, detail: "container changed since the last scan; rescan and retry" };
        const ports = Object.values(c.HostConfig.PortBindings ?? {}).flat().map((b) => Number(b?.HostPort));
        if (ports.length && !ports.includes(m.port)) return { ok: false, detail: "port changed since the last scan; rescan and retry" };
        d.setStopping(m.id, true);
        const s = await ctx.exec(["docker", "stop", "-t", "30", rt.containerId], { timeoutMs: 45000 });
        if (s.code !== 0) {
          d.setStopping(m.id, false);
          return { ok: false, detail: `docker stop failed: ${redact(s.stderr.trim())}` };
        }
        if (m.origin === "managed") await ctx.exec(["docker", "rm", rt.containerId], { timeoutMs: 15000 });
        d.setStopping(m.id, false);
        await d.rescan();
        return { ok: true, detail: m.origin === "managed" ? "stopped and removed" : "stopped (adopted container kept)" };
      }
      if (rt.kind === "external" || m.stopBlocked) return { ok: false, detail: `cannot stop: ${m.stopBlocked ?? rt.kind}` };
      const procs = await listProcs(ctx);
      const p = procs.byPid.get(rt.pid);
      if (!p || p.start !== rt.startTime) return { ok: false, detail: "process changed since the last scan; rescan and retry" };
      const ls = await listListeners(ctx);
      if (!ls.some((l) => l.port === m.port)) return { ok: false, detail: "port no longer listening; rescan and retry" };
      const pg = await ctx.exec(["ps", "-eo", "pid=,pgid="], { timeoutMs: 5000, env: { LC_ALL: "C" } });
      const pgidOf = new Map<number, number>();
      for (const line of pg.stdout.split("\n")) {
        const [a, b] = line.trim().split(/\s+/).map(Number);
        if (a && b) pgidOf.set(a, b);
      }
      const tree = descendants(procs, rt.pid);
      const inTree = new Set(tree);
      const pgid = pgidOf.get(rt.pid) ?? 0;
      const protectedPids = new Set(ancestors(procs, process.pid));
      protectedPids.add(process.pid);
      const members = [...pgidOf].filter(([, g]) => g === pgid).map(([pid]) => pid);
      const wholeGroup = pgid > 1 && pgid !== pgidOf.get(process.pid) && members.length > 0 && members.every((x) => inTree.has(x));
      const targets = tree.filter((x) => !protectedPids.has(x));
      const signal = (sig: NodeJS.Signals): string | null => {
        if (wholeGroup) {
          try {
            process.kill(-pgid, sig);
            return null;
          } catch (e) {
            return String(e);
          }
        }
        let err: string | null = null;
        for (const x of targets) {
          try {
            process.kill(x, sig);
          } catch (e) {
            if (x === rt.pid) err = String(e);
          }
        }
        return err;
      };
      d.setStopping(m.id, true);
      const termErr = signal("SIGTERM");
      if (termErr) {
        d.setStopping(m.id, false);
        return { ok: false, detail: `SIGTERM failed: ${termErr}` };
      }
      const alive = () => {
        try {
          process.kill(rt.pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      for (let i = 0; i < 30 && alive(); i++) await Bun.sleep(1000);
      if (alive()) signal("SIGKILL");
      d.setStopping(m.id, false);
      await d.rescan();
      return { ok: true, detail: "native process stopped" };
    },
    async inspect(modelId): Promise<DockerInspect | null> {
      const m = findModel(modelId);
      if (!m || m.runtime.kind !== "docker") return null;
      const [c] = await inspectContainers(ctx, [m.runtime.containerId]);
      return (c as Inspect | undefined) ?? null;
    },
    hostArgv: async (modelId) => findModel(modelId)?.argv ?? null,
    imageEnv: async (image) => (await imageInfo(ctx, image))?.Env ?? [],
    imageEntrypoint: async (image) => (await imageInfo(ctx, image))?.Entrypoint ?? null,
    imageDigest: async (image) => {
      if (image.includes("@sha256:")) return image;
      return (await imageInfo(ctx, image))?.RepoDigests[0] ?? null;
    },
  };
};
