import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { LocalJob, type LocalRunRequest } from "../../../packages/contracts/src/localStudio.ts";
import { type Config, exec, fail, fetchJson, home, lastLine, now, readJson, writeJson } from "./core.ts";
import { archivedReason, type Catalog, dockerFlags, type Entry, launchBlock, weightsOf } from "./registry.ts";

const LABEL = "local-studio-t3";
const ACTIVE = new Set(["pending", "pulling", "downloading", "starting", "ready"]);
const PORTS: [number, number] = [18100, 18299];
const jobsPath = join(home, "jobs.json");
const hfHome = process.env.HF_HOME ?? join(homedir(), ".cache", "huggingface");

interface Deps {
  config: () => Config;
  catalog: () => Catalog;
  freeGpus: () => Map<string, number[]>;
  listening: () => Effect.Effect<Set<number>>;
}

export const makeJobs = (deps: Deps) => {
  const jobs = new Map<string, LocalJob>(readJson(jobsPath, Schema.Array(LocalJob), []).map((j) => [j.id, j]));
  const aborts = new Map<string, AbortController>();
  const lock = Semaphore.makeUnsafe(1);
  const save = () => writeJson(jobsPath, [...jobs.values()]);
  const update = (id: string, patch: Partial<LocalJob>) => {
    const j = jobs.get(id);
    if (!j) return;
    jobs.set(id, { ...j, ...patch, updatedAt: now() });
    save();
  };
  const settle = (id: string, err: string | null) => update(id, err ? { phase: "failed", message: err } : { phase: "ready", message: null, progress: 1 });
  const active = () => [...jobs.values()].filter((j) => ACTIVE.has(j.phase));
  const reserved = () => new Set(active().flatMap((j) => j.gpus));

  const plan = (recipeId: string, req: LocalRunRequest, id: string) =>
    Effect.gen(function* () {
      const cat = deps.catalog();
      const entry = cat.recipes.get(recipeId);
      if (!entry) return yield* fail(404, "RECIPE_NOT_FOUND", `no recipe ${recipeId} at ${cat.info.commit ?? "the registry ref"}`);
      const reason = archivedReason(recipeId, entry);
      if (reason) return yield* fail(409, "RECIPE_ARCHIVED", reason);
      const block = launchBlock(entry);
      if (block) return yield* fail(409, "RECIPE_BLOCKED", block);
      const l = entry.launch;
      const cards = l.cards ?? 1;
      const free = (deps.freeGpus().get(entry.card) ?? []).filter((g) => !reserved().has(g));
      const gpus = req.gpus ? [...req.gpus] : free.slice(0, cards);
      if (gpus.length !== cards || new Set(gpus).size !== cards) return yield* fail(409, "GPUS_UNAVAILABLE", `needs ${cards} free ${entry.card} GPU(s); free: ${free.join(",") || "none"}`);
      const notFree = req.dryRun && req.gpus ? [] : gpus.filter((g) => !free.includes(g));
      if (notFree.length) return yield* fail(409, "GPUS_BUSY", `GPU(s) ${notFree.join(",")} are busy, foreign, or not ${entry.card}`);
      const taken = yield* deps.listening();
      for (const j of active()) taken.add(j.port);
      let port = PORTS[0];
      while (port <= PORTS[1] && taken.has(port)) port++;
      if (port > PORTS[1]) return yield* fail(503, "NO_PORT", "no free port in 18100-18299");
      const cfg = deps.config();
      const name = `lst3-${id}`;
      const weights = weightsOf(l).map((w) => (w.layout === "hub" ? { w, hub: true, host: hfHome } : { w, hub: false, host: join(cfg.modelsDir, `${w.repo.split("/")[1] ?? w.repo}-${w.revision.slice(0, 8)}`) }));
      const configFile = l.config ? { path: join(home, "runs", id, basename(l.config.at)), at: l.config.at, text: l.config.text } : null;
      const ep = Array.isArray(l.entrypoint) ? [...l.entrypoint] : l.entrypoint ? [l.entrypoint] : [];
      const argv = [
        "docker", "run", "-d", "--name", name,
        "--label", `${LABEL}.controller=${cfg.id}`, "--label", `${LABEL}.job=${id}`,
        "--gpus", `"device=${gpus.join(",")}"`,
        "-p", `127.0.0.1:${port}:${l.port}`,
        ...(l.shm ? ["--shm-size", l.shm] : []),
        ...dockerFlags(l),
        ...Object.entries(l.env ?? {}).filter(([k]) => k !== "NVIDIA_VISIBLE_DEVICES" && k !== "CUDA_VISIBLE_DEVICES").flatMap(([k, v]) => ["-e", `${k}=${v}`]),
        ...(weights.some((w) => w.hub) ? ["-e", "HF_HUB_OFFLINE=1"] : []),
        ...weights.flatMap((w) => ["-v", w.hub ? `${w.host}:${w.w.at}` : `${w.host}:${w.w.at}:ro`]),
        ...(configFile ? ["-v", `${configFile.path}:${configFile.at}:ro`] : []),
        ...(ep[0] ? ["--entrypoint", ep[0]] : []),
        l.image ?? "",
        ...ep.slice(1),
        ...(l.args ?? []),
      ];
      return { entry, gpus, port, name, argv, weights, configFile };
    });
  type Plan = Effect.Success<ReturnType<typeof plan>>;

  const download = (id: string, p: Plan, signal: AbortSignal) =>
    Effect.gen(function* () {
      for (const { w, host, hub } of p.weights) {
        const marker = hub ? join(host, "hub", `models--${w.repo.replace("/", "--")}`, "snapshots", w.revision) : join(host, ".local-studio-verified");
        if (signal.aborted || existsSync(marker)) continue;
        if (!Bun.which("hf")) return `weights ${w.repo}@${w.revision.slice(0, 8)} are missing and the hf CLI is not installed`;
        update(id, { phase: "downloading", message: `downloading ${w.repo}@${w.revision.slice(0, 8)}` });
        const files = Array.isArray(w.files) ? w.files.map(String) : typeof w.files === "string" && w.files ? [w.files] : [];
        const r = yield* exec(["hf", "download", w.repo, ...files, "--revision", w.revision, ...(hub ? [] : ["--local-dir", host])], 24 * 3600_000, { signal, env: { HF_HOME: hfHome } });
        if (signal.aborted) return null;
        if (r.code !== 0) return `download of ${w.repo} failed: ${lastLine(r)}`;
        if (!hub) writeFileSync(marker, `${w.repo}@${w.revision}\n`);
      }
      return null;
    });

  const waitReady = (name: string, port: number, signal: AbortSignal) =>
    Effect.gen(function* () {
      const deadline = Date.now() + 3 * 3600_000;
      while (Date.now() < deadline && !signal.aborted) {
        const s = yield* exec(["docker", "inspect", "-f", "{{.State.Running}} {{.State.ExitCode}}", name], 10_000);
        if (s.code !== 0) return "container disappeared";
        if (!s.stdout.startsWith("true")) {
          const logs = yield* exec(["docker", "logs", "--tail", "20", name], 10_000);
          return `engine exited (${s.stdout.trim()}): ${`${logs.stdout}${logs.stderr}`.trim().slice(-1500)}`;
        }
        const r = yield* Effect.option(fetchJson(`http://127.0.0.1:${port}/v1/models`, 3_000));
        if (r._tag === "Some" && r.value.status === 200) return null;
        yield* Effect.sleep("5 seconds");
      }
      return signal.aborted ? "stopped" : "engine did not become ready in time";
    });

  const drive = (id: string, p: Plan, signal: AbortSignal) =>
    Effect.gen(function* () {
      const image = p.entry.launch.image ?? "";
      update(id, { phase: "pulling", message: image });
      if ((yield* exec(["docker", "image", "inspect", image], 20_000)).code !== 0) {
        const r = yield* exec(["docker", "pull", image], 4 * 3600_000, { signal });
        if (r.code !== 0 && !signal.aborted) return update(id, { phase: "failed", message: `pull failed: ${lastLine(r)}` });
      }
      const dl = signal.aborted ? null : yield* download(id, p, signal);
      if (signal.aborted) return;
      if (dl) return update(id, { phase: "failed", message: dl });
      if (p.configFile) {
        mkdirSync(join(home, "runs", id), { recursive: true });
        writeFileSync(p.configFile.path, p.configFile.text);
      }
      const run = yield* lock.withPermit(
        Effect.suspend(() => {
          if (signal.aborted) return Effect.succeed(null);
          update(id, { phase: "starting", message: "starting container", progress: null });
          return exec(p.argv, 120_000);
        }),
      );
      if (!run || signal.aborted) return;
      if (run.code !== 0) return update(id, { phase: "failed", message: `docker run failed: ${lastLine(run)}` });
      const err = yield* waitReady(p.name, p.port, signal);
      if (!signal.aborted) settle(id, err);
    });

  const track = (id: string, effect: (signal: AbortSignal) => Effect.Effect<void>) => {
    const ac = new AbortController();
    aborts.set(id, ac);
    Effect.runFork(
      effect(ac.signal).pipe(
        Effect.catchCause((c) => Effect.sync(() => update(id, { phase: "failed", message: String(c).slice(0, 500) }))),
        Effect.ensuring(Effect.sync(() => aborts.delete(id))),
      ),
    );
  };

  return {
    list: () => [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    reserved,
    jobPort: (port: number) => active().find((j) => j.port === port)?.id ?? null,
    run: (recipeId: string, req: LocalRunRequest) =>
      lock.withPermit(Effect.gen(function* () {
        const id = randomBytes(5).toString("hex");
        const p = yield* plan(recipeId, req, id);
        if (req.dryRun) return { job: null, argv: p.argv };
        const job: LocalJob = { id, recipeId, gpus: p.gpus, port: p.port, container: p.name, phase: "pending", progress: null, message: null, startedAt: now(), updatedAt: now() };
        jobs.set(id, job);
        save();
        track(id, (signal) => drive(id, p, signal));
        return { job, argv: p.argv };
      })),
    stop: (id: string) =>
      lock.withPermit(Effect.gen(function* () {
        const j = jobs.get(id);
        if (!j) return yield* fail(404, "JOB_NOT_FOUND", `no owned job ${id}`);
        aborts.get(id)?.abort();
        const label = yield* exec(["docker", "inspect", "-f", `{{index .Config.Labels "${LABEL}.job"}}`, j.container], 10_000);
        if (label.code === 0 && label.stdout.trim() === id) {
          const r = yield* exec(["docker", "rm", "-f", j.container], 120_000);
          if (r.code !== 0) return yield* fail(500, "STOP_FAILED", r.stderr.trim().slice(0, 300));
        }
        update(id, { phase: "stopped", message: null });
        return jobs.get(id) ?? j;
      })),
    reconcile: Effect.gen(function* () {
      for (const j of active()) {
        if (aborts.has(j.id)) continue;
        const running = (yield* exec(["docker", "inspect", "-f", "{{.State.Running}}", j.container], 10_000)).stdout.startsWith("true");
        if (!running) update(j.id, { phase: "failed", message: j.phase === "ready" ? "container is no longer running" : "controller restarted before the job finished" });
        else if (j.phase !== "ready") track(j.id, (signal) => waitReady(j.container, j.port, signal).pipe(Effect.map((err) => void (signal.aborted || settle(j.id, err)))));
      }
    }),
  };
};
