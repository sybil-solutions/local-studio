import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RecipeExport, RecipePr } from "@local-studio/contracts";
import type { Ctx, Services } from "../context";
import type { Exporter } from "./export";
import type { Registry } from "./registry";
import { HttpError, nowStamp, stableJson } from "./util";

const tail = (s: string): string => s.trim().split("\n").slice(-3).join(" | ");

const savedExport = (ctx: Ctx, modelId: string): RecipeExport | null => {
  const root = join(ctx.config.dataDir, "exports");
  let best: { at: number; exp: RecipeExport } | null = null;
  try {
    for (const d of readdirSync(root)) {
      const p = join(root, d, "export.json");
      if (!existsSync(p)) continue;
      const exp = JSON.parse(readFileSync(p, "utf8")) as RecipeExport;
      const at = statSync(p).mtimeMs;
      if ((exp.modelId === modelId || exp.recipeId === modelId) && (!best || at > best.at)) best = { at, exp };
    }
  } catch {}
  if (!best) return null;
  const dir = join(root, best.exp.recipeId);
  return { ...best.exp, savedTo: dir };
};

export interface PrOpener {
  openPr(modelId: string, opts: { title?: string; draft: boolean }): Promise<RecipePr>;
}

export const createPrOpener = (ctx: Ctx, svc: Services, registry: Registry, exporter: Exporter): PrOpener => {
  const openPr = async (modelId: string, opts: { title?: string; draft: boolean }): Promise<RecipePr> => {
    const dryRun = process.env.LOCAL_STUDIO_PR_DRY_RUN === "1";
    const exp = svc.runtime.model(modelId) ? await exporter.exportModel(modelId) : savedExport(ctx, modelId);
    if (!exp) throw new HttpError(404, "MODEL_NOT_FOUND", `no running model or saved export for ${modelId}`);
    if (exp.refusals.length) throw new HttpError(422, "EXPORT_REFUSED", `the export has refusals: ${exp.refusals.join("; ")}`);

    const auth = await ctx.exec(["gh", "auth", "status"], { timeoutMs: 10_000 });
    if (auth.code !== 0) throw new HttpError(409, "GH_AUTH", `gh auth status failed: ${auth.timedOut ? "timed out" : tail(auth.stderr || auth.stdout)}`);

    if (!(await registry.ensureClone())) throw new HttpError(503, "REGISTRY_UNAVAILABLE", "the registry clone is unavailable");
    const fetch = await registry.git(["fetch", "--prune", "origin"], 60_000);
    if (fetch.code !== 0) throw new HttpError(502, "GIT_FETCH", `git fetch failed: ${tail(fetch.stderr)}`);

    const record = exp.record;
    const id = exp.recipeId;
    const branch = `local-studio/${id}-${nowStamp()}`;
    const worktree = join(ctx.config.home, "registry-work", branch);
    mkdirSync(dirname(worktree), { recursive: true });
    const add = await registry.git(["worktree", "add", "-b", branch, worktree, "origin/main"], 240_000);
    if (add.code !== 0) throw new HttpError(500, "GIT_WORKTREE", `git worktree add failed: ${add.timedOut ? "timed out" : tail(add.stderr)}`);

    const rel = `registry/recipe/${id}.json`;
    const existed = existsSync(join(worktree, rel));
    mkdirSync(dirname(join(worktree, rel)), { recursive: true });
    writeFileSync(join(worktree, rel), stableJson(record));
    const engine = (record.engine as { name?: string } | undefined)?.name ?? "engine";
    const model = ((record.metadata as { local_studio?: { served_models?: string[] } } | undefined)?.local_studio?.served_models ?? [])[0] ?? id;
    const message = `recipe: ${model} on ${String(record.hardware_id)} via ${engine}, candidate`;
    const g = (args: string[], t = 30_000) => registry.git(args, t, worktree);
    const staged = await g(["add", rel]);
    if (staged.code !== 0) throw new HttpError(500, "GIT_ADD", tail(staged.stderr));
    const commit = await g(["commit", "-m", message]);
    if (commit.code !== 0) throw new HttpError(500, "GIT_COMMIT", `git commit failed: ${tail(commit.stderr || commit.stdout)}`);

    const bodyFile = join(exp.savedTo, "README.md");
    if (!existsSync(bodyFile)) writeFileSync(bodyFile, exp.doc);
    const title = opts.title ?? message;
    const gh = ["gh", "pr", "create", "--repo", ctx.config.registryRepo, "--base", "main", "--head", branch, ...(opts.draft ? ["--draft"] : []), "--title", title, "--body-file", bodyFile];
    const files = [rel];
    if (existed) ctx.log.warn(`recipes: ${rel} already exists on origin/main; the commit updates it`);

    if (dryRun) {
      const printed = gh.map((x) => (/[\s:,()]/.test(x) ? `'${x.replace(/'/g, "'\\''")}'` : x)).join(" ");
      ctx.log.info(`recipes: PR dry run: committed ${branch} in ${worktree}; not pushed. would run: git -C ${worktree} push -u origin ${branch} && ${printed}`);
      return { url: `dry-run: ${printed}`, branch, files };
    }

    const push = await g(["push", "-u", "origin", branch], 120_000);
    if (push.code !== 0) throw new HttpError(502, "GIT_PUSH", `git push failed: ${push.timedOut ? "timed out" : tail(push.stderr)}`);
    const pr = await ctx.exec(gh, { timeoutMs: 60_000, cwd: worktree });
    if (pr.code !== 0) throw new HttpError(502, "GH_PR", `gh pr create failed: ${pr.timedOut ? "timed out" : tail(pr.stderr)}`);
    const url = pr.stdout.trim().split("\n").filter((l) => l.startsWith("https://")).pop() ?? pr.stdout.trim();
    ctx.db.query("INSERT INTO recipe_prs (at, model_id, recipe_id, branch, url) VALUES (?, ?, ?, ?, ?)").run(Date.now(), modelId, id, branch, url);
    return { url, branch, files };
  };
  return { openPr };
};
