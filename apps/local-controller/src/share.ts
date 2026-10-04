import * as NodeOS from "node:os";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { LocalRegistryMatch, LocalSharePreview, LocalShareResult } from "../../../packages/contracts/src/localStudio.ts";
import { decodeJson, exec, fail, fetchJson, lastLine, now } from "./core.ts";
import type { Endpoint } from "./discovery.ts";
import type { Library } from "./library.ts";
import type { Entry } from "./registry.ts";

const TARGET = "0xSero/local-ai-registry";
const VERSION = "local-ai-registry/v1";
const SECRET = /(token|secret|password|passwd|api[_-]?key|authorization|credential|cookie|session)/i;
const SECRET_FLAGS = new Set(["--api-key", "--hf-token", "--token", "--admin-api-key"]);
const ENV_KEEP = /^(VLLM|SGLANG|NCCL|CUDA|PYTORCH|TORCH|OMP|HF_HUB_ENABLE|SAFETENSORS|FLASHINFER|LLAMA|GGML|MLX)/;
const ENGINES: [RegExp, string][] = [[/sglang/, "sglang"], [/vllm/, "vllm"], [/llama-server|llama\.cpp|llama_cpp/, "llama.cpp"], [/mlx_vlm|mlx-vlm/, "mlx-vlm"], [/mlx_lm|mlx-lm/, "mlx-lm"], [/tabby/, "tabbyapi"], [/exllama/, "exllamav3"], [/ollama/, "ollama"]];
const PRECISION = /(nvfp4|mxfp4|mxfp8|fp8|int4|int8|w4a16|w8a8|awq|gptq|fp16|bf16|\d(?:\.\d+)?bpw|\d+bit|i?q\d_[a-z0-9_]+)$/i;
const HF_CACHE = /models--([^/]+?)--([^/]+)\/snapshots\/([0-9a-f]{40})/;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const secretKey = (k: string) => !/tokens$/i.test(k) && SECRET.test(k);
const flag = (argv: string[], names: string[]) => {
  for (const [i, a] of argv.entries()) {
    const [k, v] = a.split(/=(.*)/s);
    if (k && names.includes(k)) return v ?? argv[i + 1] ?? null;
  }
  return null;
};
export const secretValues = (keys: string[]) => [...keys, ...Object.entries(process.env).flatMap(([k, v]) => (v && v.length >= 12 && secretKey(k) ? [v] : []))];
const sources = (at: string) => ({ sources: [{ kind: "local-studio", url: "https://github.com/sybil-solutions/local-studio", captured_at: at }], captured_at: at });

interface Observed {
  argv: string[];
  image: string | null;
  digest: string | null;
  env: Record<string, string>;
}

const observe = (ep: Endpoint, entry: Entry | null) =>
  Effect.gen(function* () {
    if (entry) {
      const [image, digest] = (entry.launch.image ?? "").split("@");
      return { argv: [...(entry.launch.args ?? [])], image: image || null, digest: digest ?? null, env: { ...entry.launch.env } };
    }
    const id = (yield* exec(["docker", "ps", "-q", "--filter", `publish=${ep.port}`], 10_000)).stdout.split("\n")[0]?.trim();
    const cfg = id ? decodeJson(Schema.Struct({ Image: Schema.String, Entrypoint: Schema.NullOr(Schema.Array(Schema.String)), Cmd: Schema.NullOr(Schema.Array(Schema.String)), Env: Schema.NullOr(Schema.Array(Schema.String)) }), (yield* exec(["docker", "inspect", "-f", "{{json .Config}}", id], 10_000)).stdout) : undefined;
    if (cfg) {
      const digests = decodeJson(Schema.Array(Schema.String), (yield* exec(["docker", "image", "inspect", "-f", "{{json .RepoDigests}}", cfg.Image], 10_000)).stdout) ?? [];
      const env = Object.fromEntries((cfg.Env ?? []).map((e) => e.split(/=(.*)/s) as [string, string]).filter(([k]) => ENV_KEEP.test(k) && !secretKey(k)));
      return { argv: [...(cfg.Entrypoint ?? []), ...(cfg.Cmd ?? [])], image: cfg.Image.split("@")[0] ?? null, digest: digests[0]?.split("@")[1] ?? null, env };
    }
    const ps = ep.pid ? (yield* exec(["ps", "-ww", "-o", "command=", "-p", String(ep.pid)], 5_000)).stdout.trim() : "";
    return { argv: ps ? ps.split(/\s+/) : [], image: null, digest: null, env: {} };
  });

const probe = (ep: Endpoint, model: string, key: string | undefined) =>
  Effect.tryPromise(async () => {
    const t0 = performance.now();
    const r = await fetch(`${ep.base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, temperature: 0, messages: [{ role: "user", content: "Reply with exactly: validation-ok" }] }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await r.json()) as { usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: { message?: { content?: string | null } }[] };
    return { ok: r.ok, ns: Math.round((performance.now() - t0) * 1e6), prompt: body.usage?.prompt_tokens ?? null, completion: body.usage?.completion_tokens ?? null, excerpt: (body.choices?.[0]?.message?.content ?? "").trim().slice(0, 80) };
  }).pipe(Effect.option);

export const scrub = (value: unknown, secrets: string[], found: Set<string>): unknown => {
  const hosts = [NodeOS.hostname(), NodeOS.hostname().split(".")[0] ?? ""].filter((h) => h.length > 4 && !/^local/i.test(h));
  const str = (s: string) => {
    let out = s.split(NodeOS.homedir()).join("~");
    if (out !== s) found.add("home directory paths");
    const rules: [RegExp | string, string, string][] = [
      [/GPU-[0-9a-f-]{36}/gi, "device identifiers", "[redacted-device-id]"],
      [/\b(?:10|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}\b/g, "private addresses", "[redacted-host]"],
      ...hosts.map((h): [string, string, string] => [h, "hostnames", "[redacted-host]"]),
      ...secrets.filter((x) => x.length >= 8).map((x): [string, string, string] => [x, "credential values", "[redacted]"]),
    ];
    for (const [re, label, sub] of rules) {
      const next = typeof re === "string" ? out.split(re).join(sub) : out.replace(re, sub);
      if (next !== out) found.add(label);
      out = next;
    }
    return out;
  };
  if (typeof value === "string") return str(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, secrets, found));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).flatMap(([k, v]) => {
        if (!secretKey(k)) return [[k, scrub(v, secrets, found)]];
        found.add(`credential field "${k}"`);
        return [];
      }),
    );
  return value;
};

const validators = new Map<string, Ajv2020>();
export const validate = (lib: Library, name: string, record: unknown): string[] => {
  let ajv = validators.get(lib.commit);
  if (!ajv) {
    ajv = new Ajv2020({ strict: false, allErrors: true });
    formats.default(ajv);
    for (const s of lib.schemas) ajv.addSchema(s as object);
    validators.set(lib.commit, ajv);
  }
  const v = ajv.getSchema(`https://local-ai-registry.dev/schema/${name}.schema.json`);
  if (!v) return [`${name}: the registry has no ${name} schema`];
  return v(record) ? [] : (v.errors ?? []).map((e) => `${name}${e.instancePath || "/"}: ${e.message ?? "invalid"}`);
};

export const previewShare = (lib: Library, ep: Endpoint, entry: Entry | null, matches: LocalRegistryMatch[], secrets: string[], key: string | undefined) =>
  Effect.gen(function* () {
    const at = now();
    const prov = sources(at);
    const o: Observed = yield* observe(ep, entry);
    const argv = o.argv.map((a, i) => (SECRET_FLAGS.has(o.argv[i - 1] ?? "") ? "[redacted]" : a));
    const text = `${o.image ?? ""} ${argv.join(" ")}`.toLowerCase();
    const engine = ENGINES.find(([re]) => re.test(text))?.[1] ?? null;
    const served = ep.models[0] ?? "";
    const servedName = /^[/~]/.test(served) ? (served.split("/").pop() ?? null) : served || null;
    let repo: string | null = null;
    let revision = flag(argv, ["--revision"]);
    let precision: string | null = null;
    const after = argv.indexOf("serve");
    for (const c of [flag(argv, ["--model", "--model-path", "-m", "-hf", "--hf-repo", "--model-id"]), after >= 0 ? argv[after + 1] : null, served]) {
      const cache = c ? HF_CACHE.exec(c) : null;
      const [name, quant] = (c ?? "").split(":");
      if (cache) [repo, revision, precision] = [`${cache[1]}/${cache[2]}`, revision ?? cache[3] ?? null, PRECISION.exec(c?.replace(/\.gguf$/i, "") ?? "")?.[1] ?? null];
      else if (name && /^[\w.-]+\/[\w.-]+$/.test(name) && !name.startsWith(".")) [repo, precision] = [name, quant ?? null];
      if (repo) break;
    }
    const match = matches.find((m) => m.hardwareId);
    const count = Number(flag(argv, ["--tensor-parallel-size", "--tp-size", "--tp", "-tp"]) ?? entry?.launch.cards ?? 1) || 1;
    const listed = yield* Effect.option(fetchJson(`${ep.base}/v1/models`, 5_000, key ? { authorization: `Bearer ${key}` } : {}));
    const models = listed._tag === "Some" ? listed.value.body : null;
    const ctx = Number(flag(argv, ["--max-model-len", "--context-length", "--ctx-size", "-c", "--max-kv-size", "--max-seq-len"]) ?? decodeJson(Schema.Struct({ data: Schema.Array(Schema.Struct({ max_model_len: Schema.Number })) }), JSON.stringify(models))?.data[0]?.max_model_len ?? 0) || null;
    const p = served ? yield* probe(ep, served, key) : null;
    const measured = p?._tag === "Some" && p.value.ok ? p.value : null;
    const blockers = [
      ...(repo ? [] : ["could not identify the Hugging Face repository from the launch command or served model name"]),
      ...(engine ? [] : ["could not identify the inference engine"]),
      ...(match ? [] : ["this machine's hardware does not match a registry hardware record"]),
      ...(measured ? [] : ["the server did not answer the validation probe"]),
    ];
    const repoName = repo?.split("/")[1] ?? "model";
    precision ??= PRECISION.exec(repoName)?.[1]?.toLowerCase() ?? flag(argv, ["--quantization", "-q"]);
    const existing = [...lib.instances.values()].find((i) => i.repository.toLowerCase() === repo?.toLowerCase() && (!precision || i.weights.precision?.toLowerCase() === precision.toLowerCase()));
    const modelId = existing?.model_id ?? slug(repoName.replace(/[-_.](gguf|mlx|awq|gptq|fp8|nvfp4|int4|int8|w4a16|bf16|fp16|exl3|\d+bit|\d(\.\d+)?bpw)\b.*$/i, ""));
    const instanceId = existing?.id ?? `${slug(repo ?? "")}--${slug(precision ?? "unknown")}`;
    const recipeId = [modelId, precision ? slug(precision) : null, match?.hardwareId, slug(engine ?? ""), `tp${count}`].filter(Boolean).join("-");
    if (lib.rows.some((r) => r.id === recipeId)) blockers.push(`the registry already has recipe ${recipeId}`);
    const url = `https://huggingface.co/${repo}`;
    const hf = { repository: repo, url, status: "unknown", link_type: "repository", reason: "not-verified-by-local-studio", provenance: prov };
    const command = [o.image && o.digest ? `${o.image}@${o.digest}` : o.image, ...argv].filter(Boolean).join(" ");
    const container = o.image
      ? { state: o.digest ? "digest-pinned" : "mutable", runtime: "docker", image: o.image, digest: o.digest, compose_file: null, source: prov.sources, captured_at: at, reason: o.digest ? "observed-running-container" : "image-not-pinned-by-digest" }
      : { state: "none", runtime: null, image: null, digest: null, compose_file: null, source: prov.sources, captured_at: at, reason: "reference-only-launch" };
    const recipe = {
      schema_version: VERSION,
      id: recipeId,
      recipe_source: "local-studio",
      status: "candidate",
      description: `${[repo, precision].filter(Boolean).join(" ")} on ${count}x ${match?.hardwareName} via ${engine}, shared from Local Studio. Observed launch; not yet an acceptance-validated contract.`,
      model_instance_id: instanceId,
      hardware_id: match?.hardwareId ?? "",
      hardware_count: count,
      engine: { name: engine ?? "unknown", version: null, graph_mode: null },
      launch: { kind: o.image ? "docker" : "reference", container, observed_command: command, ...(o.image ? { arguments: argv, environment: o.env } : {}) },
      serving: { max_context_tokens: ctx, tensor_parallel: count, max_concurrency: null, kv_cache_tokens: null },
      capabilities: { chat: true, reasoning: flag(argv, ["--reasoning-parser"]) ? true : null, tools: argv.some((a) => /^--(tool-call-parser|enable-auto-tool-choice|jinja)/.test(a)) ? true : null, vision: null },
      speed_sweep_ids: [],
      metadata: {
        validation: {
          date: at.slice(0, 10),
          evidence: { eval_count: measured?.completion ?? null, prompt_eval_count: measured?.prompt ?? null, total_duration_ns: measured?.ns ?? null, response_excerpt: measured?.excerpt ?? null },
          probe: "Exact 'validation-ok' chat completion probe at temperature 0 against the running server, sent by the Local Studio controller.",
        },
      },
      provenance: prov,
      facts: { metadata: { state: "known", reason: "validation-evidence-recorded", provenance: prov } },
    };
    const instance = {
      schema_version: VERSION,
      id: instanceId,
      model_id: modelId,
      repository: repo ?? "",
      url,
      revision,
      served_name: servedName,
      weights: { format: /gguf/i.test(`${repoName} ${command}`) ? "GGUF" : /mlx/i.test(repoName) ? "MLX" : "safetensors", precision, size_gb: null },
      kind: precision && !/^(bf16|fp16)$/i.test(precision) ? "quant" : "base",
      huggingface: hf,
      provenance: prov,
      facts: {
        revision: revision ? { state: "known", reason: "observed-in-launch", provenance: prov } : { state: "unknown", reason: "revision-not-pinned-in-launch", provenance: prov },
        "weights.size_gb": { state: "unknown", reason: "size-not-measured-by-local-studio", provenance: prov },
      },
    };
    const params = Number([...repoName.matchAll(/(\d+(?:\.\d+)?)b\b/gi)].at(-1)?.[1] ?? 0);
    const hfApi = !existing && !lib.models.has(modelId) && repo ? yield* Effect.option(fetchJson(`https://huggingface.co/api/models/${repo}`, 8_000)) : null;
    const downloadCount = hfApi?._tag === "Some" ? decodeJson(Schema.Struct({ downloads: Schema.Number }), JSON.stringify(hfApi.value.body))?.downloads ?? null : null;
    const model = {
      schema_version: VERSION,
      id: modelId,
      family: slug(repo?.split("/")[0] ?? modelId),
      name: repoName,
      params,
      active_params: null,
      architecture: null,
      url,
      huggingface: hf,
      provenance: prov,
      facts: { params: { state: "known", reason: "parsed-from-repository-name", provenance: prov } },
      downloads: { last_30d: downloadCount, all_time: null, captured_at: at, source: "huggingface-api" },
    };
    const found = new Set<string>();
    const files = [
      ...(existing || lib.models.has(modelId) ? [] : [{ name: "model", path: `data/registry/model/${modelId}.json`, record: model }]),
      ...(existing ? [] : [{ name: "model-instance", path: `data/registry/model-instance/${instanceId}.json`, record: instance }]),
      { name: "recipe", path: `data/registry/recipe/${recipeId}.json`, record: recipe },
    ].map((f) => ({ ...f, record: scrub(f.record, secrets, found) }));
    if (files.some((f) => f.name === "model") && !(params > 0)) blockers.push(`could not read a parameter count from ${repoName} for a new model record`);
    const branch = `local-studio/${recipeId}`.slice(0, 120);
    return {
      target: `https://github.com/${TARGET}`,
      branch,
      title: `Add ${recipeId} (shared from Local Studio)`,
      body: [
        `Shares a working configuration observed by the Local Studio controller: \`${repo}\` on ${count}x \`${match?.hardwareId}\` via ${engine}.`,
        `Files: ${files.map((f) => `\`${f.path}\``).join(", ")}${existing ? `; reuses model-instance \`${existing.id}\`` : ""}.`,
        `Evidence: validation-ok probe, ${measured?.completion ?? "?"} completion tokens in ${measured ? (measured.ns / 1e9).toFixed(2) : "?"} s.`,
        `Scrubbed before sharing: ${[...found].join(", ") || "nothing needed"}.`,
      ].join("\n\n"),
      files: files.map(({ path, record }) => ({ path, record })),
      reused: [...(existing ? [`model-instance ${existing.id}`] : []), ...(existing || lib.models.has(modelId) ? [`model ${modelId}`] : [])],
      redactions: [...found],
      issues: files.flatMap((f) => validate(lib, f.name, f.record)),
      blockers,
    } satisfies LocalSharePreview;
  });

export const createPr = (preview: LocalSharePreview, dryRun: boolean) =>
  Effect.gen(function* () {
    const commands: string[] = [];
    const gh = (args: string[], body?: unknown) =>
      Effect.gen(function* () {
        commands.push(`gh ${args.join(" ")}`);
        if (dryRun) return "";
        const r = yield* exec(["gh", ...args, ...(body === undefined ? [] : ["--input", "-"])], 60_000, body === undefined ? {} : { stdin: JSON.stringify(body) });
        if (r.code !== 0) return yield* fail(502, "GITHUB_FAILED", `gh ${args.slice(0, 4).join(" ")} failed: ${lastLine(r)}`);
        return r.stdout.trim();
      });
    if (!dryRun && (yield* exec(["gh", "auth", "status"], 15_000)).code !== 0) return yield* fail(409, "GH_UNAUTHENTICATED", "the gh CLI is not signed in on this machine; run gh auth login");
    const login = (yield* gh(["api", "user", "--jq", ".login"])) || "<you>";
    const fork = (yield* gh(["api", "-X", "POST", `repos/${TARGET}/forks`, "--jq", ".full_name"])) || `${login}/local-ai-registry`;
    const sha = yield* gh(["api", `repos/${TARGET}/git/ref/heads/main`, "--jq", ".object.sha"]);
    for (let i = 0; ; i++) {
      const made = yield* Effect.result(gh(["api", "-X", "POST", `repos/${fork}/git/refs`], { ref: `refs/heads/${preview.branch}`, sha }));
      if (made._tag === "Success") break;
      if (i >= 5) return yield* made.failure;
      yield* Effect.sleep("3 seconds");
    }
    for (const f of preview.files)
      yield* gh(["api", "-X", "PUT", `repos/${fork}/contents/${f.path}`], { message: `Add ${f.path.split("/").slice(-2).join("/")}`, branch: preview.branch, content: Buffer.from(`${JSON.stringify(f.record, null, 2)}\n`).toString("base64") });
    const url = yield* gh(["api", "-X", "POST", `repos/${TARGET}/pulls`, "--jq", ".html_url"], { title: preview.title, body: preview.body, head: `${fork.split("/")[0]}:${preview.branch}`, base: "main" });
    return { url: dryRun ? null : url, commands } satisfies LocalShareResult;
  });
