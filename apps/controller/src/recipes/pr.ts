import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RecipeExport, RecipePr } from "@local-studio/contracts";
import type { Ctx, Services } from "../context";
import type { Exporter } from "./export";
import type { Registry } from "./registry";
import { HttpError, nowStamp } from "./util";

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
      if (exp.files && (exp.modelId === modelId || exp.recipeId === modelId) && (!best || at > best.at)) best = { at, exp };
    }
  } catch {}
  return best?.exp ?? null;
};

export interface PrOpener {
  openPr(modelId: string, opts: { title?: string; draft: boolean; dryRun?: boolean }): Promise<RecipePr>;
}

export const createPrOpener = (ctx: Ctx, svc: Services, registry: Registry, exporter: Exporter): PrOpener => {
  const openPr = async (modelId: string, opts: { title?: string; draft: boolean; dryRun?: boolean }): Promise<RecipePr> => {
    const dryRun = !!opts.dryRun || process.env.LOCAL_STUDIO_PR_DRY_RUN === "1";
    const exp = svc.runtime.model(modelId) ? await exporter.exportModel(modelId) : savedExport(ctx, modelId);
    if (!exp) throw new HttpError(404, "MODEL_NOT_FOUND", `no running model or saved recipe for ${modelId}`);
    if (exp.refusals.length) throw new HttpError(422, "EXPORT_REFUSED", `the recipe has refusals: ${exp.refusals.join("; ")}`);
    if (!dryRun) {
      const auth = await ctx.exec(["gh", "auth", "status"], { timeoutMs: 10_000 });
      if (auth.code !== 0) throw new HttpError(409, "GH_AUTH", `gh auth status failed: ${auth.timedOut ? "timed out" : tail(auth.stderr || auth.stdout)}`);
    }
    if (!(await registry.ensureClone())) throw new HttpError(503, "REGISTRY_UNAVAILABLE", "the registry clone is unavailable");
    const fetch = await registry.git(["fetch", "--prune", "origin", "+refs/heads/main:refs/remotes/origin/main"], 90_000);
    if (fetch.code !== 0) throw new HttpError(502, "GIT_FETCH", `git fetch failed: ${tail(fetch.stderr)}`);

    const branch = `local-studio/${exp.recipeId}-${nowStamp()}`;
    const worktree = join(ctx.config.home, "registry-work", branch);
    mkdirSync(dirname(worktree), { recursive: true });
    const add = await registry.git(["worktree", "add", "-b", branch, worktree, "origin/main"], 300_000);
    if (add.code !== 0) throw new HttpError(500, "GIT_WORKTREE", `git worktree add failed: ${add.timedOut ? "timed out" : tail(add.stderr)}`);
    for (const [rel, text] of Object.entries(exp.files)) {
      mkdirSync(dirname(join(worktree, rel)), { recursive: true });
      writeFileSync(join(worktree, rel), text);
    }
    const files = Object.keys(exp.files);
    const run = (cmd: string[], t = 180_000) => ctx.exec(cmd, { timeoutMs: t, cwd: worktree });
    let check = "not run: python3 is not installed";
    if ((await run(["python3", "--version"], 10_000)).code === 0) {
      for (const step of [["python3", "lab/catalog.py"], ["python3", "lab/export_plugin.py"]]) {
        const r = await run(step);
        if (r.code !== 0) throw new HttpError(422, "REGISTRY_BUILD", `${step.join(" ")} failed: ${tail(r.stderr || r.stdout)}`);
      }
      files.push("dist/catalog.json", "plugin/v2/recipes.json");
      const steps = [["python3", "lab/lab.py", "check"], ["python3", "lab/catalog.py", "--check"], ["python3", "lab/export_plugin.py", "--check"]];
      if ((await run(["node", "--version"], 10_000)).code === 0) steps.push(["sh", "sdk/test.sh"]);
      for (const step of steps) {
        const c = await run(step, 300_000);
        if (c.code !== 0) throw new HttpError(422, "REGISTRY_CHECK", `${step.join(" ")} failed: ${tail(c.stdout + c.stderr)}`);
      }
      check = `passed: ${steps.map((x) => x.slice(1).join(" ")).join("; ")}`;
    }
    const g = (args: string[], t = 30_000) => registry.git(args, t, worktree);
    const staged = await g(["add", "--", ...files]);
    if (staged.code !== 0) throw new HttpError(500, "GIT_ADD", tail(staged.stderr));
    const recipe = exp.record as { model?: string; card?: string };
    const message = `recipes: the owner's ${recipe.model ?? exp.recipeId} on ${recipe.card ?? "?"}, saved by Local Studio`;
    const commit = await g(["commit", "-m", message]);
    if (commit.code !== 0) throw new HttpError(500, "GIT_COMMIT", `git commit failed: ${tail(commit.stderr || commit.stdout)}`);
    const bodyFile = join(exp.savedTo, "PR.md");
    writeFileSync(bodyFile, exp.doc);
    const gh = ["gh", "pr", "create", "--repo", ctx.config.registryRepo, "--base", "main", "--head", branch, ...(opts.draft ? ["--draft"] : []), "--title", opts.title ?? message, "--body-file", bodyFile];
    if (dryRun) {
      ctx.log.info(`recipes: PR dry run: committed ${branch} in ${worktree}; not pushed`);
      return { url: `dry-run: ${gh.join(" ")}`, branch, files, worktree, check };
    }
    const push = await g(["push", "-u", "origin", branch], 120_000);
    if (push.code !== 0) throw new HttpError(502, "GIT_PUSH", `git push failed: ${push.timedOut ? "timed out" : tail(push.stderr)}`);
    const pr = await ctx.exec(gh, { timeoutMs: 60_000, cwd: worktree });
    if (pr.code !== 0) throw new HttpError(502, "GH_PR", `gh pr create failed: ${pr.timedOut ? "timed out" : tail(pr.stderr)}`);
    const url = pr.stdout.trim().split("\n").filter((l) => l.startsWith("https://")).pop() ?? pr.stdout.trim();
    ctx.db.query("INSERT INTO recipe_prs (at, model_id, recipe_id, branch, url) VALUES (?, ?, ?, ?, ?)").run(Date.now(), modelId, exp.recipeId, branch, url);
    return { url, branch, files, worktree, check };
  };
  return { openPr };
};
