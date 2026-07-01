"use client";

import {
  AppPage,
  Button,
  Input,
  PageState,
  RefreshButton,
  Select,
  Table,
  TBody,
  TCell,
  TH,
  THead,
  TRow,
} from "@/ui";
import { useEnvironments } from "@/features/environments/use-environments";

export default function EnvironmentsPage() {
  const {
    environments,
    recipes,
    loading,
    error,
    form,
    setForm,
    creating,
    pendingActionId,
    engineOptions,
    loadAll,
    handleCreate,
    handleDelete,
    handleStart,
    handleStop,
    handlePullImage,
  } = useEnvironments();

  const pageStateRender = PageState({
    loading,
    data: environments,
    hasData: environments.length > 0,
    error,
    onLoad: loadAll,
  });
  if (pageStateRender) return <AppPage>{pageStateRender}</AppPage>;

  return (
    <AppPage>
      <div className="mx-auto w-full max-w-[64rem] px-4 py-4 sm:px-6 sm:py-6">
        <div className="flex items-center justify-between gap-3 border-b border-(--border)/40 pb-3">
          <div>
            <h1 className="text-[length:var(--fs-2xl)] font-semibold text-(--fg)">Environments</h1>
            <p className="mt-1 text-[length:var(--fs-sm)] text-(--dim)">
              Every docker-capable recipe is seeded here as a container pinned to an official vLLM,
              SGLang, or llama.cpp image. Adjust the version, then start it.
            </p>
          </div>
          <RefreshButton onRefresh={loadAll} loading={loading} />
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-(--err)/30 bg-(--err)/10 px-3 py-2 text-[length:var(--fs-sm)] text-(--err)">
            {error}
          </div>
        ) : null}

        <section className="mt-5 rounded-[var(--ui-radius)] border border-(--ui-border) p-4">
          <h2 className="text-[length:var(--fs-md)] font-medium text-(--fg)">
            Additional environment
          </h2>
          <p className="mt-1 text-[length:var(--fs-xs)] text-(--dim)">
            Pair an existing recipe with a different engine or image version.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input
              label="Name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Qwen3-32B (vLLM v0.24.0)"
            />
            <Select
              label="Recipe"
              value={form.recipeId}
              onChange={(event) => setForm({ ...form, recipeId: event.target.value })}
              placeholder="Choose a recipe"
              options={recipes.map((recipe) => ({ value: recipe.id, label: recipe.name }))}
            />
            <Select
              label="Engine"
              value={form.engineId}
              onChange={(event) =>
                setForm({ ...form, engineId: event.target.value as typeof form.engineId })
              }
              options={engineOptions}
            />
            <Input
              label="Version"
              value={form.version}
              onChange={(event) => setForm({ ...form, version: event.target.value })}
              placeholder="0.24.0"
            />
            <Input
              label="Variant (optional)"
              value={form.variant}
              onChange={(event) => setForm({ ...form, variant: event.target.value })}
              placeholder="cu129"
            />
          </div>
          <Button
            className="mt-3"
            onClick={() => void handleCreate()}
            disabled={creating || !form.name.trim() || !form.recipeId || !form.version.trim()}
          >
            {creating ? "Creating…" : "Create environment"}
          </Button>
        </section>

        <section className="mt-5">
          <Table>
            <THead>
              <TRow>
                <TH>Name</TH>
                <TH>Engine</TH>
                <TH>Image</TH>
                <TH>Status</TH>
                <TH align="right">Actions</TH>
              </TRow>
            </THead>
            <TBody>
              {environments.length === 0 ? (
                <TRow>
                  <TCell colSpan={5} className="py-6 text-center text-(--dim)">
                    No environments yet — add a vLLM, SGLang, or llama.cpp recipe and they are
                    seeded automatically.
                  </TCell>
                </TRow>
              ) : (
                environments.map((environment) => {
                  const busy = pendingActionId === environment.id;
                  return (
                    <TRow key={environment.id}>
                      <TCell>{environment.name}</TCell>
                      <TCell className="font-mono text-[length:var(--fs-sm)]">
                        {environment.engineId} {environment.version}
                        {environment.variant ? `-${environment.variant}` : ""}
                      </TCell>
                      <TCell className="font-mono text-[length:var(--fs-xs)] text-(--dim)">
                        {environment.image}
                      </TCell>
                      <TCell>
                        <span className={environment.running ? "text-(--ok)" : "text-(--dim)"}>
                          {environment.running ? "running" : "stopped"}
                        </span>
                        {!environment.imagePulled && !environment.running ? (
                          <span className="ml-2 text-[length:var(--fs-xs)] text-(--warn)">
                            image not pulled
                          </span>
                        ) : null}
                      </TCell>
                      <TCell align="right">
                        <div className="flex justify-end gap-2">
                          {!environment.imagePulled && !environment.running ? (
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
                                void handlePullImage(environment.id, environment.image)
                              }
                            >
                              {busy ? "Pulling…" : "Pull image"}
                            </Button>
                          ) : null}
                          {environment.running ? (
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void handleStop(environment.id)}
                            >
                              Stop
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void handleStart(environment.id)}
                            >
                              Start
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void handleDelete(environment.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TCell>
                    </TRow>
                  );
                })
              )}
            </TBody>
          </Table>
        </section>
      </div>
    </AppPage>
  );
}
