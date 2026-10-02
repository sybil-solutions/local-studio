import { useCallback, useEffect, useState } from "react";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { LocalSnapshot, LocalRecipes, type LocalRecipe } from "@t3tools/contracts/local-studio";
import { primaryEnvironmentHttpLayer } from "../../environments/primary/httpLayer";
import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { isElectron } from "../../env";

class LocalRequestError extends Data.TaggedError("LocalRequestError")<{ message: string }> {}

const request = (path: string, controller: string, body?: unknown) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const url = new URL(resolvePrimaryEnvironmentHttpUrl(`/api/local/${path}`));
    if (controller) url.searchParams.set("controller", controller);
    const response = yield* client.execute(
      body === undefined
        ? HttpClientRequest.get(url)
        : HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe(body)),
    );
    if (response.status >= 400)
      return yield* Effect.fail(new LocalRequestError({ message: yield* response.text }));
    return yield* response.json;
  }).pipe(Effect.scoped, Effect.timeout("35 seconds"), Effect.provide(primaryEnvironmentHttpLayer));

export function LocalPage() {
  const [snapshot, setSnapshot] = useState<LocalSnapshot | null>(null);
  const [recipes, setRecipes] = useState<LocalRecipes | null>(null);
  const [controller, setController] = useState("");
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [peer, setPeer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<LocalRecipe | null>(null);
  const [gpus, setGpus] = useState<number[]>([]);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const abort = new AbortController();
    setSnapshot(null);
    setRecipes(null);
    const poll = Effect.all(
      [
        request("snapshot", controller).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(LocalSnapshot)),
        ),
        request(archived ? "recipes?archived=1" : "recipes", controller).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(LocalRecipes)),
        ),
      ],
      { concurrency: 2 },
    ).pipe(
      Effect.tap(([state, catalog]) =>
        Effect.sync(() => {
          setSnapshot(state);
          setRecipes(catalog);
          setError(null);
        }),
      ),
      Effect.catch((cause) => Effect.sync(() => setError(String(cause)))),
      Effect.repeat(Schedule.spaced("5 seconds")),
    );
    void Effect.runPromise(poll, { signal: abort.signal }).catch(() => undefined);
    return () => abort.abort();
  }, [controller, revision, archived]);
  const act = (path: string, body: unknown) => {
    setBusy(true);
    void Effect.runPromise(request(path, controller, body))
      .then(() => {
        setSelected(null);
        setPeer("");
        refresh();
      })
      .catch((cause: unknown) => setError(String(cause)))
      .finally(() => setBusy(false));
  };
  const visibleRecipes =
    recipes?.recipes.filter((recipe) =>
      `${recipe.id} ${recipe.model} ${recipe.card} ${recipe.engine}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <SidebarInset>
      <WorkspacePageHeader electron={isElectron}>
        <h1 className="text-sm font-medium">Local</h1>
        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={refresh}>
            Refresh
          </Button>
        </div>
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        <WorkspacePageContainer width="expanded">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Controllers</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={controller === "" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  setController("");
                  setSelected(null);
                }}
              >
                This machine
              </Button>
              {snapshot?.controllers
                .filter((link) => controller !== "" || !link.self)
                .map((link) => (
                  <Button
                    key={link.url}
                    size="sm"
                    variant={controller === link.url ? "secondary" : "ghost"}
                    onClick={() => {
                      setController(link.url);
                      setSelected(null);
                    }}
                  >
                    {link.name ?? link.url} · {link.reachable ? "online" : "offline"}
                  </Button>
                ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                act("peers", { url: peer });
              }}
            >
              <Input
                aria-label="Controller URL"
                placeholder="http://machine:18091"
                value={peer}
                onChange={(event) => setPeer(event.target.value)}
              />
              <Button type="submit" variant="outline" disabled={busy || !peer}>
                Link
              </Button>
            </form>
            {snapshot && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <span>
                  {snapshot.hardware.hostname} · {snapshot.hardware.cpus} CPUs
                </span>
                <span>
                  RAM {(snapshot.hardware.memFreeBytes / 2 ** 30).toFixed(1)} /{" "}
                  {(snapshot.hardware.memTotalBytes / 2 ** 30).toFixed(1)} GiB free
                </span>
                <span>
                  {snapshot.endpoints.filter((endpoint) => endpoint.live).length} live APIs
                </span>
                <span>auto → {snapshot.auto ?? "no live model"}</span>
              </div>
            )}
            {snapshot?.hardware.gpus.map((gpu) => (
              <p key={gpu.index} className="text-xs text-muted-foreground">
                GPU {gpu.index} · {gpu.name} · {(gpu.memoryUsedMiB / 1024).toFixed(1)} /{" "}
                {(gpu.memoryTotalMiB / 1024).toFixed(1)} GiB · {gpu.utilization ?? "—"}% ·{" "}
                {gpu.temperatureC ?? "—"}°C · {gpu.powerW ?? "—"} W · {gpu.busy ? "busy" : "free"}
              </p>
            ))}
            <details className="text-xs text-muted-foreground">
              <summary>Manage linked controllers</summary>
              {snapshot?.controllers
                .filter((link) => !link.self && link.depth === 1)
                .map((link) => (
                  <div
                    key={link.url}
                    className="flex items-center gap-3 text-xs text-muted-foreground"
                  >
                    <span>
                      {link.url}
                      {link.error ? ` — ${link.error}` : ""}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => act("peers", { url: link.url, remove: true })}
                    >
                      Unlink
                    </Button>
                  </div>
                ))}
            </details>
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Models</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th>Model</th>
                    <th>State</th>
                    <th>APIs</th>
                    <th>Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot?.models.map((model) => (
                    <tr key={model.id} className="border-t border-border">
                      <td className="py-2 font-mono text-xs">{model.id}</td>
                      <td>{model.live ? "Live" : "Offline"}</td>
                      <td>{model.endpoints.length}</td>
                      <td>{model.requests.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {snapshot?.models.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No inference APIs detected. Existing engines are discovered automatically.
              </p>
            )}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {snapshot?.endpoints.map((endpoint) => (
                <span key={endpoint.id}>
                  {endpoint.controllerId} :{endpoint.port} · {endpoint.models.join(", ")} ·{" "}
                  {endpoint.live ? "live" : "offline"}
                </span>
              ))}
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-medium">
              Registry · {recipes?.recipes.length ?? "…"} recipes
            </h2>
            <p className="text-xs text-muted-foreground">
              {recipes?.registry.source} ·{" "}
              {recipes?.registry.commit?.slice(0, 12) ?? recipes?.registry.ref}
              {recipes?.registry.error ? ` — ${recipes.registry.error}` : ""}
            </p>
            <Input
              aria-label="Search registry"
              placeholder="Search models, engines or hardware"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={archived}
                onChange={(event) => setArchived(event.target.checked)}
              />
              Include {(recipes?.archivedRecords ?? 0) + (recipes?.capturedConfigs ?? 0)} preserved
              configurations
            </label>
            {selected && (
              <div className="space-y-3 border border-border p-4">
                <h3 className="text-sm font-medium">Run {selected.model}</h3>
                <p className="text-xs text-muted-foreground">
                  {selected.engine} · {selected.card} × {selected.cards} · context{" "}
                  {selected.ctx.toLocaleString()} · {selected.proof?.kind ?? "unvalidated"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {snapshot?.hardware.gpus.map((gpu) => (
                    <Button
                      key={gpu.index}
                      variant={gpus.includes(gpu.index) ? "secondary" : "outline"}
                      size="sm"
                      disabled={!selected.freeGpus.includes(gpu.index)}
                      onClick={() =>
                        setGpus((current) =>
                          current.includes(gpu.index)
                            ? current.filter((index) => index !== gpu.index)
                            : [...current, gpu.index],
                        )
                      }
                    >
                      GPU {gpu.index} · {gpu.name} ·{" "}
                      {((gpu.memoryTotalMiB - gpu.memoryUsedMiB) / 1024).toFixed(1)} GiB free
                    </Button>
                  ))}
                </div>
                <p className="break-all font-mono text-xs">{selected.image ?? selected.weights}</p>
                <div className="flex gap-2">
                  <Button
                    disabled={busy || gpus.length !== selected.cards}
                    onClick={() => act(`recipes/${encodeURIComponent(selected.id)}/run`, { gpus })}
                  >
                    Confirm launch
                  </Button>
                  <Button variant="ghost" onClick={() => setSelected(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th>Model / hardware</th>
                    <th>Engine</th>
                    <th>Context</th>
                    <th>Proof</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleRecipes.slice(0, 100).map((recipe) => (
                    <tr key={recipe.id} className="border-t border-border">
                      <td className="py-2">
                        <div>{recipe.model}</div>
                        <div className="text-xs text-muted-foreground">
                          {recipe.card} × {recipe.cards}
                        </div>
                      </td>
                      <td>{recipe.engine}</td>
                      <td>{recipe.ctx.toLocaleString()}</td>
                      <td>
                        {recipe.proof?.kind ?? "unvalidated"}
                        {recipe.proof?.tps != null ? ` · ${recipe.proof.tps.toFixed(1)} tok/s` : ""}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!recipe.runnable || busy}
                          title={recipe.blocked ?? recipe.reason ?? undefined}
                          onClick={() => {
                            setSelected(recipe);
                            setGpus(recipe.freeGpus.slice(0, recipe.cards));
                          }}
                        >
                          Run
                        </Button>
                        {!recipe.runnable && (
                          <div className="max-w-56 text-xs text-muted-foreground">
                            {recipe.blocked ?? recipe.reason}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibleRecipes.length > 100 && (
              <p className="text-xs text-muted-foreground">
                Showing 100 of {visibleRecipes.length}. Refine the search.
              </p>
            )}
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Runs</h2>
            {snapshot?.jobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center gap-3 border-t border-border py-2 text-sm"
              >
                <span className="min-w-0 flex-1">
                  {job.recipeId} · :{job.port} · {job.phase}
                  {job.message ? ` — ${job.message}` : ""}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || ["stopped", "failed"].includes(job.phase)}
                  onClick={() => act(`runs/${encodeURIComponent(job.id)}/stop`, {})}
                >
                  Stop
                </Button>
              </div>
            ))}
            {snapshot?.jobs.length === 0 && (
              <p className="text-sm text-muted-foreground">No runs owned by this controller.</p>
            )}
          </section>
        </WorkspacePageContainer>
      </div>
    </SidebarInset>
  );
}
