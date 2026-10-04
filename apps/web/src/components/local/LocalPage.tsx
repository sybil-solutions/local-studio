import { useCallback, useEffect, useState } from "react";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { ChevronRightIcon, ExternalLinkIcon, PencilIcon, ServerIcon } from "lucide-react";
import {
  LocalSnapshot,
  LocalRecipes,
  LocalTailnet,
  type LocalControllerLink,
  type LocalHardware,
  type LocalRecipe,
  type LocalUsage,
} from "@t3tools/contracts/local-studio";
import { formatTokens } from "@t3tools/shared/usageFormat";
import { primaryEnvironmentHttpLayer } from "../../environments/primary/httpLayer";
import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { ConnectionStatusDot } from "../ConnectionStatusDot";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Metric } from "../usage/UsagePage";
import { UsageProviderChart } from "../usage/UsageProviderChart";
import { RegistrySection } from "./RegistrySection";

class LocalRequestError extends Data.TaggedError("LocalRequestError")<{ message: string }> {}

const sum = <T,>(rows: ReadonlyArray<T>, value: (row: T) => number) =>
  rows.reduce((total, row) => total + value(row), 0);
const gib = (bytes: number) => `${(bytes / 2 ** 30).toFixed(0)} GiB`;
const memory = (hardware: LocalHardware) => {
  const vram = sum(hardware.gpus, (gpu) => gpu.memoryTotalMiB) * 2 ** 20;
  return vram
    ? { used: sum(hardware.gpus, (gpu) => gpu.memoryUsedMiB) * 2 ** 20, total: vram, label: "VRAM" }
    : {
        used: hardware.memTotalBytes - hardware.memFreeBytes,
        total: hardware.memTotalBytes,
        label: "Memory",
      };
};
const gpuSummary = (hardware: LocalHardware) => {
  const names = new Set(
    hardware.gpus.map((gpu) =>
      gpu.name.replace(/^NVIDIA (GeForce )?/, "").replace(/ (Blackwell )?Workstation Edition/, ""),
    ),
  );
  return names.size
    ? `${hardware.gpus.length}× ${[...names].join(" / ")}`
    : `${hardware.cpus} CPUs`;
};
const tokensOf = (usage: ReadonlyArray<LocalUsage> = [], since = "", until = "9999") =>
  sum(usage, (row) =>
    sum(Object.entries(row.tokens ?? {}), ([day, count]) =>
      day >= since && day <= until ? count : 0,
    ),
  );

const request = (path: string, controller: string, body?: unknown) =>
  Effect.gen(function* () {
    const [route, query] = path.split("?");
    const url = new URL(resolvePrimaryEnvironmentHttpUrl(`/api/local/${route}`));
    url.search = query ?? "";
    if (controller) url.searchParams.set("controller", controller);
    const response = yield* (yield* HttpClient.HttpClient).execute(
      body === undefined
        ? HttpClientRequest.get(url)
        : HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe(body)),
    );
    if (response.status < 400) return yield* response.json;
    const message = (yield* response.text) || `HTTP ${response.status}`;
    return yield* new LocalRequestError({ message });
  }).pipe(Effect.scoped, Effect.timeout("3 minutes"), Effect.provide(primaryEnvironmentHttpLayer));

const fetchEach = <A,>(path: string, schema: Schema.Codec<A, unknown>, controllers: string[]) =>
  Effect.forEach(
    controllers,
    (controller) =>
      request(path, controller).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema)),
        Effect.map((value) => [controller, value] as const),
        Effect.option,
      ),
    { concurrency: 4 },
  ).pipe(Effect.map((entries) => Object.fromEntries(entries.flatMap(Option.toArray))));

const target = (device: LocalControllerLink) => (device.self ? "" : device.url);
const dot = (className: string, tooltip: string) => (
  <ConnectionStatusDot dotClassName={className} tooltipText={tooltip} />
);
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

function Machine({
  device,
  snapshot,
  recipes,
  busy,
  act,
}: {
  device: LocalControllerLink;
  snapshot: LocalSnapshot | undefined;
  recipes: LocalRecipes | undefined;
  busy: string | null;
  act: (key: string, path: string, body: unknown, controller: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const hardware = snapshot?.hardware;
  const use = hardware ? memory(hardware) : null;
  const running = (snapshot?.endpoints ?? []).filter(
    (endpoint) => endpoint.live && endpoint.controllerId === device.id,
  );
  const loaded = running.flatMap((endpoint) => endpoint.models).join(", ");
  const jobs = (snapshot?.jobs ?? []).filter((job) => !["ready", "stopped"].includes(job.phase));
  const rig = hardware?.gpus.length ?? 0;
  const all = (recipes?.recipes ?? []).toSorted(
    (a, b) => b.cards - a.cards || (b.tps ?? 0) - (a.tps ?? 0) || a.model.localeCompare(b.model),
  );
  const options = all.filter((recipe) => recipe.fits);
  const reference = [
    ...new Map(
      all
        .filter((recipe) => !recipe.fits)
        .map((recipe) => [`${recipe.model} ${recipe.cards} ${recipe.engine}`, recipe] as const),
    ).values(),
  ];
  const picked = options.find((recipe) => recipe.id === choice) ?? options[0];
  const gpus = (recipe: LocalRecipe) =>
    `${recipe.cards} of ${rig} GPU${rig === 1 ? "" : "s"}${recipe.cards === rig && rig > 1 ? " · full rig" : ""}`;
  const describe = (recipe: LocalRecipe) =>
    [
      gpus(recipe),
      recipe.engine,
      recipe.ctx ? `${Math.round(recipe.ctx / 1000)}k context` : null,
      recipe.tps != null ? `${recipe.tps.toFixed(0)} tok/s` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const host = URL.parse(device.url)?.hostname ?? device.url;
  const name = device.name ?? host;
  const controller = target(device);
  const loadKey = `load ${device.url}`;
  const confirm = (key: string, run: () => void) => {
    setArmed(armed === key ? null : key);
    if (armed === key) run();
  };
  const load = () =>
    picked &&
    act(
      loadKey,
      `recipes/${encodeURIComponent(picked.id)}/run`,
      { replace: running.length > 0 },
      controller,
    );
  return (
    <div className="group border-t border-border/60 first:border-t-0">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) =>
          event.key === "Enter" && event.target === event.currentTarget && setOpen(!open)
        }
        className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-accent/40 sm:px-4"
      >
        <ChevronRightIcon
          aria-hidden
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
        {!device.reachable
          ? dot("bg-destructive", "Offline")
          : running.length
            ? dot("bg-success", "Serving")
            : dot("bg-muted-foreground/60", "Idle")}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            {editing === null ? (
              <>
                <span className="truncate text-sm font-medium text-foreground">{name}</span>
                {device.reachable && (
                  <button
                    type="button"
                    aria-label={`Rename ${name}`}
                    className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                    onClick={(event) => {
                      stop(event);
                      setEditing(name);
                    }}
                  >
                    <PencilIcon className="size-3" />
                  </button>
                )}
              </>
            ) : (
              <form
                onClick={stop}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (editing.trim() && editing !== name)
                    act(`name ${device.url}`, "name", { name: editing.trim() }, controller);
                  setEditing(null);
                }}
              >
                <Input
                  autoFocus
                  size="sm"
                  aria-label="Machine name"
                  className="w-48"
                  value={editing}
                  onChange={(event) => setEditing(event.target.value)}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(event) => event.key === "Escape" && setEditing(null)}
                />
              </form>
            )}
            <button
              type="button"
              aria-label={reveal ? "Hide address" : "Show address"}
              title={reveal ? "Hide address" : "Show address"}
              onClick={(event) => {
                stop(event);
                setReveal(!reveal);
              }}
              className={`hidden truncate text-xs text-muted-foreground tabular-nums transition-[filter] sm:inline ${reveal ? "" : "blur-sm select-none"}`}
            >
              {host}
            </button>
          </div>
          <span className="truncate text-xs text-muted-foreground">
            {!device.reachable
              ? (device.error ?? "Offline")
              : loaded || (jobs[0] ? `Loading ${jobs[0].recipeId}` : "No model loaded")}
          </span>
        </div>
        {use && (
          <div className="hidden w-48 shrink-0 flex-col gap-1 sm:flex">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground"
                style={{ width: `${Math.min(100, (use.used / use.total) * 100)}%` }}
              />
            </div>
            <span className="text-right text-xs text-muted-foreground tabular-nums">
              {gib(use.used)} / {gib(use.total)} {use.label}
            </span>
          </div>
        )}
      </div>
      {open && device.reachable && (
        <div className="flex flex-col gap-4 px-3 pb-4 sm:px-4 sm:ps-12">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric
              label="Tokens served"
              value={
                device.usage?.some((row) => row.measuredRequests)
                  ? formatTokens(tokensOf(device.usage))
                  : "—"
              }
            />
            <Metric
              label="Requests"
              value={sum(device.usage ?? [], (row) => row.requests).toLocaleString()}
            />
            <Metric label="Hardware" value={hardware ? gpuSummary(hardware) : "—"} />
            <Metric label="Models loaded" value={String(running.length)} />
          </div>
          {running.map((endpoint) => (
            <div key={endpoint.id} className="flex items-center gap-2 text-sm">
              {dot("bg-success", "Serving")}
              <span className="min-w-0 flex-1 truncate">{endpoint.models.join(", ")}</span>
              <span className="text-xs text-muted-foreground tabular-nums">:{endpoint.port}</span>
              <Button
                size="xs"
                variant={armed === endpoint.id ? "destructive" : "outline"}
                disabled={busy !== null}
                onClick={() =>
                  confirm(endpoint.id, () =>
                    act(endpoint.id, `ports/${endpoint.port}/stop`, {}, controller),
                  )
                }
              >
                {busy === endpoint.id
                  ? "Unloading…"
                  : armed === endpoint.id
                    ? "Confirm unload"
                    : "Unload"}
              </Button>
            </div>
          ))}
          {jobs.map((job) => (
            <div key={job.id} className="flex items-center gap-2 text-sm">
              {job.phase === "failed"
                ? dot("bg-destructive", "Failed")
                : dot("bg-warning", "Loading")}
              <span className="min-w-0 flex-1 truncate">
                {job.recipeId}
                <span className="ms-2 text-xs text-muted-foreground">
                  {job.phase}
                  {job.progress !== null ? ` ${Math.round(job.progress * 100)}%` : ""}
                  {job.message ? ` · ${job.message}` : ""}
                </span>
              </span>
              <Button
                size="xs"
                variant="outline"
                disabled={busy !== null}
                onClick={() => act(job.id, `runs/${job.id}/stop`, {}, controller)}
              >
                {job.phase === "failed" ? "Dismiss" : "Cancel"}
              </Button>
            </div>
          ))}
          {all.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  items={all.map((recipe) => ({
                    value: recipe.id,
                    label: `${recipe.model} · ${recipe.cards}× GPU`,
                  }))}
                  value={picked?.id ?? null}
                  onValueChange={setChoice}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full sm:w-auto sm:min-w-64 sm:flex-1"
                    aria-label="Model to load"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    {[
                      { label: "Ready to load", recipes: options, detail: describe },
                      {
                        label: "In the registry, not one-click yet",
                        recipes: reference,
                        detail: (recipe: LocalRecipe) =>
                          `${gpus(recipe)} · ${recipe.engine} · ${(recipe.blocked ?? "")
                            .split(/[:;]/)[0]
                            ?.replace(/captured (\w+) record from/, "$1 report from")}`,
                      },
                    ].map(
                      (group) =>
                        group.recipes.length > 0 && (
                          <SelectGroup key={group.label}>
                            <SelectGroupLabel>{group.label}</SelectGroupLabel>
                            {group.recipes.map((recipe) => (
                              <SelectItem key={recipe.id} value={recipe.id} disabled={!recipe.fits}>
                                <span className="flex flex-col">
                                  {recipe.model}
                                  <span className="text-xs text-muted-foreground">
                                    {group.detail(recipe)}
                                  </span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ),
                    )}
                  </SelectPopup>
                </Select>
                <Button
                  size="sm"
                  variant={armed === loadKey ? "destructive" : "default"}
                  disabled={busy !== null || !picked}
                  onClick={() => (running.length ? confirm(loadKey, load) : load())}
                >
                  {busy === loadKey
                    ? "Loading…"
                    : armed === loadKey
                      ? `Unload ${running.length} and load`
                      : "Load"}
                </Button>
              </div>
              <p className="text-xs break-all text-muted-foreground">
                {picked
                  ? `Recipe ${picked.id} · ${describe(picked)}`
                  : `None of the ${reference.length} registry recipes for this hardware can load automatically yet. See the supported hardware below.`}
                {armed === loadKey && ` Loading ${picked?.model} unloads ${loaded} first.`}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {recipes
                ? "The registry has no recipes for this hardware yet."
                : "Reading the registry…"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function LocalSettingsPanel() {
  const [root, setRoot] = useState<LocalSnapshot | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, LocalSnapshot | undefined>>({});
  const [recipes, setRecipes] = useState<Record<string, LocalRecipes>>({});
  const [tailnet, setTailnet] = useState<LocalTailnet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const devices = root?.controllers ?? [];
  const reachable = devices
    .filter((device) => device.reachable)
    .map(target)
    .join(" ");

  const perform = useCallback(
    <A,>(key: string, effect: Effect.Effect<A, Error>, then: (value: A) => void) => {
      setBusy(key);
      setError(null);
      void Effect.runPromise(effect)
        .then(then)
        .catch((cause: unknown) => setError(String(cause)))
        .finally(() => setBusy(null));
    },
    [],
  );
  const act = (key: string, path: string, body: unknown, controller: string) =>
    perform(key, request(path, controller, body), () => setRevision((value) => value + 1));
  const scan = useCallback(
    () =>
      perform(
        "scan",
        request("tailnet", "").pipe(Effect.flatMap(Schema.decodeUnknownEffect(LocalTailnet))),
        setTailnet,
      ),
    [perform],
  );
  useEffect(scan, [scan]);

  useEffect(() => {
    const abort = new AbortController();
    const poll = Effect.gen(function* () {
      const state = yield* request("snapshot", "").pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(LocalSnapshot)),
      );
      const reachableUrls = state.controllers.filter((device) => device.reachable).map(target);
      const each = yield* fetchEach("snapshot", LocalSnapshot, reachableUrls);
      setRoot(state);
      setSnapshots(
        Object.fromEntries(state.controllers.map((device) => [device.url, each[target(device)]])),
      );
    }).pipe(
      Effect.catch((cause) => Effect.sync(() => setError(String(cause)))),
      Effect.repeat(Schedule.spaced("5 seconds")),
    );
    void Effect.runPromise(poll, { signal: abort.signal }).catch(() => undefined);
    return () => abort.abort();
  }, [revision]);

  useEffect(() => {
    void Effect.runPromise(
      fetchEach("recipes?archived=1", LocalRecipes, reachable ? reachable.split(" ") : [""]),
    ).then(setRecipes);
  }, [reachable, revision]);

  const usage = root?.usage ?? [];
  const now = new Date(root?.generatedAt ?? Date.now());
  const today = now.toISOString().slice(0, 10);
  const monday = new Date(now.getTime() - ((now.getUTCDay() + 6) % 7) * 86_400_000);
  const days = Array.from({ length: 30 }, (_, index) =>
    new Date(now.getTime() - (29 - index) * 86_400_000).toISOString().slice(0, 10),
  );
  const daily = days.map((day) => {
    const totalTokens = tokensOf(usage, day, day);
    return {
      day,
      costUsd: 0,
      totalTokens,
      byProvider: new Map([["codex" as const, { costUsd: 0, totalTokens }]]),
    };
  });
  const measured = sum(usage, (row) => row.measuredRequests ?? 0);
  const requests = sum(usage, (row) => row.requests);
  const shown = (value: number) => (measured ? formatTokens(value) : "—");
  const models = usage.toSorted((a, b) => tokensOf([b]) - tokensOf([a]) || b.requests - a.requests);
  const cell = "py-2 text-right text-muted-foreground tabular-nums";

  return (
    <SettingsPageContainer width="expanded" className="gap-6">
      {error && (
        <p role="alert" className="text-sm break-all text-destructive">
          {error}
        </p>
      )}

      <SettingsSection
        title="Machines"
        headerAction={
          <Button variant="ghost" size="sm" disabled={busy === "scan"} onClick={scan}>
            {busy === "scan" ? "Scanning…" : "Scan tailnet"}
          </Button>
        }
      >
        {devices.map((device) => (
          <Machine
            key={device.url}
            device={device}
            snapshot={snapshots[device.url]}
            recipes={recipes[target(device)]}
            busy={busy}
            act={act}
          />
        ))}
        {tailnet?.devices
          .filter(
            (device) => !device.linked && (device.controller || /^(linux|macOS)$/.test(device.os)),
          )
          .map((device) => (
            <SettingsRow
              key={device.ip}
              title={device.name}
              description={
                device.controller
                  ? "Controller found on your tailnet"
                  : `${device.os} · no controller yet`
              }
              control={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    device.controller
                      ? act(device.ip, "peers", { url: device.controller.url }, "")
                      : act(device.ip, "tailnet/deploy", { ip: device.ip, name: device.name }, "")
                  }
                >
                  {busy === device.ip ? "Installing…" : device.controller ? "Connect" : "Install"}
                </Button>
              }
            />
          ))}
        {!root && !error && (
          <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">Contacting controller…</p>
        )}
      </SettingsSection>

      <RegistrySection
        devices={devices
          .filter((device) => device.reachable)
          .map((device) => ({
            label: device.name ?? URL.parse(device.url)?.hostname ?? device.url,
            controller: target(device),
          }))}
        call={request}
      />

      <SettingsSection title="Usage">
        <div className="flex flex-col gap-5 px-3 py-4 sm:px-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Today" value={shown(tokensOf(usage, today))} />
            <Metric
              label="This week"
              value={shown(tokensOf(usage, monday.toISOString().slice(0, 10)))}
            />
            <Metric label="All time" value={shown(tokensOf(usage))} />
            <Metric label="Requests" value={requests.toLocaleString()} />
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-foreground">Daily processed tokens</h3>
            <UsageProviderChart
              providers={["codex"]}
              presentation={{
                codex: {
                  label: "Local models",
                  color: "var(--contrast-foreground)",
                  mark: ServerIcon,
                },
              }}
              days={days}
              daily={daily}
              hours={[]}
              hourly={[]}
              metric="tokens"
              referenceTime={root?.generatedAt}
              resolution="day"
              timeZone="UTC"
            />
          </div>
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="w-1/2 py-2 font-normal">Model</th>
                {["Requests", "Share", "Tokens"].map((label) => (
                  <th key={label} className="py-2 text-right font-normal">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.map((row) => (
                <tr key={row.model} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="truncate py-2 text-foreground">{row.model}</td>
                  <td className={cell}>{row.requests.toLocaleString()}</td>
                  <td className={cell}>{((row.requests / requests) * 100).toFixed(0)}%</td>
                  <td className={cell}>
                    {row.measuredRequests ? formatTokens(tokensOf([row])) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            {models.length === 0 && "No requests yet. "}
            Input + output tokens, including cached input, counted in UTC with weeks starting
            Monday. Tokens are known for {measured.toLocaleString()} of {requests.toLocaleString()}{" "}
            requests; traffic sent straight to an engine is not seen.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="About Local">
        <div className="flex flex-col gap-3 px-3 py-4 text-sm text-muted-foreground sm:px-4">
          <p>
            Local runs open models on machines you own. Each machine runs a small Local Studio
            controller; connected machines share their models, so any model loaded anywhere is
            available to every chat here. Machines on your Tailscale network are found
            automatically.
          </p>
          <p>
            Models load from the Local AI Registry: recipes tested on specific hardware, pinned to
            an exact image and weights. Loading works on Linux machines with NVIDIA GPUs and Docker,
            including RTX 3090, 4090, 5090, RTX PRO 6000 and DGX Spark. Macs can connect and serve
            models they already run.
          </p>
          <a
            href="https://local-ai-registry.vercel.app/?topic=hardware"
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 font-medium text-foreground hover:underline"
          >
            See supported hardware and models
            <ExternalLinkIcon className="size-3.5" />
          </a>
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
