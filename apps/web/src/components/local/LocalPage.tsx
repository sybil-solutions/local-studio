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
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { SidebarInset } from "../ui/sidebar";
import { SettingsSection, SettingsRow } from "../settings/settingsLayout";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { isElectron } from "../../env";

class LocalRequestError extends Data.TaggedError("LocalRequestError")<{ message: string }> {}

const request = (path: string, controller: string, body?: unknown) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const [route, query] = path.split("?");
    const url = new URL(resolvePrimaryEnvironmentHttpUrl(`/api/local/${route}`));
    url.search = query ?? "";
    if (controller) url.searchParams.set("controller", controller);
    const response = yield* client.execute(
      body === undefined
        ? HttpClientRequest.get(url)
        : HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe(body)),
    );
    if (response.status >= 400)
      return yield* Effect.fail(
        new LocalRequestError({ message: (yield* response.text) || `HTTP ${response.status}` }),
      );
    return yield* response.json;
  }).pipe(Effect.scoped, Effect.timeout("35 seconds"), Effect.provide(primaryEnvironmentHttpLayer));

export function LocalPage() {
  const [snapshot, setSnapshot] = useState<LocalSnapshot | null>(null);
  const [recipes, setRecipes] = useState<LocalRecipes | null>(null);
  const [controllers, setControllers] = useState<LocalSnapshot["controllers"]>([]);
  const [controller, setController] = useState("");
  const [view, setView] = useState("Overview");
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [readyOnly, setReadyOnly] = useState(false);
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
          setControllers(state.controllers);
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
    recipes?.recipes.filter(
      (recipe) =>
        (!readyOnly || recipe.runnable) &&
        `${recipe.id} ${recipe.model} ${recipe.card} ${recipe.engine}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  const models = snapshot?.models.filter((model) => model.live) ?? [];
  const candidate = recipes?.recipes.find((recipe) => recipe.id === selected?.id);
  return (
    <SidebarInset>
      <WorkspacePageHeader electron={isElectron}>
        <WorkspaceBreadcrumb ariaLabel="Local navigation">
          <WorkspaceBreadcrumbItem current>Local</WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={controller}
            onValueChange={(value) => {
              if (value !== null) {
                setController(value);
                setSelected(null);
              }
            }}
          >
            <SelectTrigger size="sm" variant="ghost" aria-label="Controller">
              <SelectValue>
                {snapshot?.controller.name ?? (controller || "This machine")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="">This machine</SelectItem>
              {controllers
                .filter((link) => controller !== "" || !link.self)
                .map((link) => (
                  <SelectItem key={link.url} value={link.url}>
                    {link.name ?? link.url}
                  </SelectItem>
                ))}
            </SelectPopup>
          </Select>
          <Button variant="ghost" size="sm" onClick={refresh}>
            Refresh
          </Button>
        </div>
      </WorkspacePageHeader>
      <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer>
          <ToggleGroup
            aria-label="Local view"
            value={[view]}
            onValueChange={(next) => {
              if (next[0]) setView(next[0]);
            }}
          >
            {["Overview", "Registry", "Connections"].map((name) => (
              <Toggle key={name} value={name}>
                {name}
              </Toggle>
            ))}
          </ToggleGroup>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!snapshot && !error && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading controller…
            </p>
          )}
          {view === "Overview" && snapshot && (
            <>
              <SettingsSection title="Running models">
                {models.map((model) => (
                  <SettingsRow
                    key={model.id}
                    title={model.id}
                    description={`${model.endpoints.length} APIs · ${model.requests.toLocaleString()} requests`}
                    control={
                      <Badge variant="success">
                        {snapshot.auto === model.id ? "Live · auto" : "Live"}
                      </Badge>
                    }
                  >
                    <details className="pb-2 text-xs text-muted-foreground">
                      <summary className="cursor-pointer py-1">Endpoints</summary>
                      {snapshot.endpoints
                        .filter((endpoint) => model.endpoints.includes(endpoint.id))
                        .map((endpoint) => (
                          <p key={endpoint.id} className="py-1">
                            {endpoint.controllerId} :{endpoint.port} ·{" "}
                            {endpoint.live ? "live" : "offline"}
                          </p>
                        ))}
                    </details>
                  </SettingsRow>
                ))}
                {models.length === 0 && (
                  <SettingsRow
                    title="No live models"
                    description="Inference APIs are discovered automatically across linked controllers."
                  />
                )}
              </SettingsSection>
              <SettingsSection
                title="Hardware"
                headerAction={
                  <Button variant="ghost" size="xs" onClick={() => setView("Registry")}>
                    Browse recipes
                  </Button>
                }
              >
                <SettingsRow
                  title={snapshot.hardware.hostname}
                  description={`${snapshot.hardware.cpus} CPUs · ${(snapshot.hardware.memFreeBytes / 2 ** 30).toFixed(1)} / ${(snapshot.hardware.memTotalBytes / 2 ** 30).toFixed(1)} GiB RAM free`}
                  control={
                    <Badge variant="secondary">
                      {snapshot.hardware.gpus.filter((gpu) => !gpu.busy).length} GPUs available
                    </Badge>
                  }
                />
                {snapshot.hardware.gpus.map((gpu) => (
                  <SettingsRow
                    key={gpu.index}
                    title={`GPU ${gpu.index} · ${gpu.name}`}
                    description={`${(gpu.memoryUsedMiB / 1024).toFixed(1)} / ${(gpu.memoryTotalMiB / 1024).toFixed(1)} GiB used · ${gpu.utilization ?? "—"}% · ${gpu.temperatureC ?? "—"}°C · ${gpu.powerW ?? "—"} W`}
                    control={
                      <Badge variant={gpu.busy ? "secondary" : "success"}>
                        {gpu.busy ? "In use" : "Available"}
                      </Badge>
                    }
                  />
                ))}
              </SettingsSection>
              {snapshot.jobs.length > 0 && (
                <SettingsSection title="Controller runs">
                  {snapshot.jobs.map((job) => (
                    <SettingsRow
                      key={job.id}
                      title={job.recipeId}
                      description={`Port ${job.port} · ${job.phase}${job.message ? ` · ${job.message}` : ""}`}
                      control={
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || ["stopped", "failed"].includes(job.phase)}
                          onClick={() => act(`runs/${encodeURIComponent(job.id)}/stop`, {})}
                        >
                          Stop
                        </Button>
                      }
                    />
                  ))}
                </SettingsSection>
              )}
            </>
          )}
          {view === "Registry" && (
            <>
              <Input
                aria-label="Search registry"
                placeholder="Search models, engines or hardware"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <SettingsSection title="Registry filters">
                <SettingsRow
                  title="Ready to run"
                  description="Only recipes that can launch on the selected controller."
                  control={
                    <Switch
                      aria-label="Ready to run"
                      checked={readyOnly}
                      onCheckedChange={setReadyOnly}
                    />
                  }
                />
                <SettingsRow
                  title="Preserved configurations"
                  description={`${(recipes?.archivedRecords ?? 0) + (recipes?.capturedConfigs ?? 0)} archived records and machine captures.`}
                  control={
                    <Switch
                      aria-label="Preserved configurations"
                      checked={archived}
                      onCheckedChange={setArchived}
                    />
                  }
                />
              </SettingsSection>
              <SettingsSection title={`${visibleRecipes.length} recipes`}>
                {visibleRecipes.slice(0, 100).map((recipe) => (
                  <SettingsRow
                    key={recipe.id}
                    title={recipe.model}
                    description={`${recipe.card} × ${recipe.cards} · ${recipe.engine} · ${recipe.ctx.toLocaleString()} context`}
                    status={`${recipe.proof?.kind ?? "Unvalidated"}${recipe.proof?.tps != null ? ` · ${recipe.proof.tps.toFixed(1)} tok/s` : ""}`}
                    control={
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setSelected(recipe);
                          setGpus(recipe.freeGpus.slice(0, recipe.cards));
                        }}
                      >
                        Details
                      </Button>
                    }
                  />
                ))}
                {recipes && visibleRecipes.length === 0 && (
                  <SettingsRow
                    title="No matching recipes"
                    description="Try another search or turn off Ready to run."
                  />
                )}
              </SettingsSection>
              <p className="text-xs text-muted-foreground">
                {visibleRecipes.length > 100 &&
                  `Showing 100 of ${visibleRecipes.length}. Refine your search. `}
                Registry revision {recipes?.registry.commit?.slice(0, 12) ?? recipes?.registry.ref}
                {recipes?.registry.error ? ` · ${recipes.registry.error}` : ""}
              </p>
            </>
          )}
          {view === "Connections" && (
            <>
              <SettingsSection title="Linked controllers">
                {snapshot?.controllers.map((link) => (
                  <SettingsRow
                    key={link.url}
                    title={link.name ?? link.url}
                    description={link.url}
                    status={link.error ?? (link.reachable ? "Online" : "Offline")}
                    control={
                      !link.self && link.depth === 1 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => act("peers", { url: link.url, remove: true })}
                        >
                          Unlink
                        </Button>
                      ) : undefined
                    }
                  />
                ))}
              </SettingsSection>
              <SettingsSection title="Add controller">
                <SettingsRow
                  title="Controller URL"
                  description="Link another machine to discover its models and APIs."
                >
                  <form
                    className="flex gap-2 pb-3"
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
                </SettingsRow>
              </SettingsSection>
            </>
          )}
        </WorkspacePageContainer>
      </div>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{selected?.model}</DialogTitle>
            <DialogDescription>
              {selected?.engine} · {selected?.card} × {selected?.cards} ·{" "}
              {selected?.ctx.toLocaleString()} context
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <p className="break-all text-xs text-muted-foreground">
              {selected?.image ?? selected?.weights}
            </p>
            <p className="text-sm">
              {candidate?.blocked ??
                candidate?.reason ??
                `Launch on ${snapshot?.controller.name ?? "this machine"}. Select ${selected?.cards} GPUs.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {snapshot?.hardware.gpus.map((gpu) => (
                <Button
                  key={gpu.index}
                  variant={gpus.includes(gpu.index) ? "secondary" : "outline"}
                  size="sm"
                  disabled={busy || !candidate?.freeGpus.includes(gpu.index)}
                  onClick={() =>
                    setGpus((current) =>
                      current.includes(gpu.index)
                        ? current.filter((index) => index !== gpu.index)
                        : [...current, gpu.index],
                    )
                  }
                >
                  GPU {gpu.index} · {((gpu.memoryTotalMiB - gpu.memoryUsedMiB) / 1024).toFixed(1)}{" "}
                  GiB free
                </Button>
              ))}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                busy ||
                !candidate?.runnable ||
                gpus.length !== candidate.cards ||
                !gpus.every((gpu) => candidate.freeGpus.includes(gpu))
              }
              onClick={() => {
                if (candidate) act(`recipes/${encodeURIComponent(candidate.id)}/run`, { gpus });
              }}
            >
              {busy ? "Launching…" : "Confirm launch"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SidebarInset>
  );
}
