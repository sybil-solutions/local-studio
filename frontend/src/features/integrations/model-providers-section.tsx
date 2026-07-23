"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  ProviderLoginEvent,
  ProviderLoginEventPayload,
  ProviderLoginJobView,
  ProviderLoginPrompt,
  ProviderView,
  ProvidersResponse,
  ProviderLoginStartResponse,
} from "@local-studio/agent-runtime/provider-hub-contract";
import { Input, ModelButton, SearchInput, Spinner } from "@/ui";
import { ExternalLink, LogOut } from "@/ui/icon-registry";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { SettingsButton } from "@/features/settings/settings-ui";
import {
  ModelRow,
  ModelSection,
  ModelStatus,
  ModelValue,
} from "@/features/recipes/recipes-content/model-page";
import { openExternal, requestJson } from "./google-account-model";

function decodeProviders(input: unknown): ProvidersResponse {
  const providers = (input as { providers?: unknown })?.providers;
  if (!Array.isArray(providers)) throw new Error("Malformed providers response");
  return { providers: providers as ProviderView[] };
}

function decodeLoginStart(input: unknown): ProviderLoginStartResponse {
  const jobId = (input as { jobId?: unknown })?.jobId;
  if (typeof jobId !== "string") throw new Error("Malformed login response");
  return { jobId };
}

function decodeLoginJob(input: unknown): ProviderLoginJobView {
  const job = input as ProviderLoginJobView;
  if (typeof job?.jobId !== "string" || typeof job.status !== "string") {
    throw new Error("Malformed login job response");
  }
  return { ...job, events: Array.isArray(job.events) ? job.events : [] };
}

function credentialBadge(provider: ProviderView): string | null {
  if (provider.credentialType === "oauth") return "OAuth";
  if (provider.credentialType === "api_key") return "API key";
  if (provider.configured) return provider.authLabel ?? provider.authSource ?? "configured";
  return null;
}

function EventLine({ payload }: { payload: ProviderLoginEventPayload }) {
  if (payload.type === "auth_url") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[length:var(--fs-md)]">
          {payload.instructions ?? "Continue sign-in in your browser."}
        </span>
        <a
          data-testid="provider-auth-url"
          href={payload.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 border border-(--border) px-2 py-0.5 text-[11px] hover:border-(--accent)"
          onClick={(event) => {
            event.preventDefault();
            void openExternal(payload.url);
          }}
        >
          <ExternalLink className="h-3 w-3" />
          Open sign-in page
        </a>
      </div>
    );
  }
  if (payload.type === "device_code") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[length:var(--fs-md)]">Enter this code at</span>
        <a
          href={payload.verificationUri}
          target="_blank"
          rel="noopener noreferrer"
          className="text-(--accent) underline text-[length:var(--fs-md)]"
          onClick={(event) => {
            event.preventDefault();
            void openExternal(payload.verificationUri);
          }}
        >
          {payload.verificationUri}
        </a>
        <span data-testid="provider-device-code" className="font-mono text-sm tracking-widest">
          {payload.userCode}
        </span>
      </div>
    );
  }
  return (
    <div className="text-[11px] font-mono text-(--dim)">
      {payload.message}
      {payload.type === "info" &&
        payload.links?.map((link) => (
          <a
            key={link.url}
            href={link.url}
            className="ml-2 underline"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault();
              void openExternal(link.url);
            }}
          >
            {link.label ?? link.url}
          </a>
        ))}
    </div>
  );
}

function PromptForm({
  prompt,
  onRespond,
}: {
  prompt: ProviderLoginPrompt;
  onRespond: (promptId: number, value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (answer: string) => {
    setBusy(true);
    try {
      await onRespond(prompt.id, answer);
      setValue("");
    } finally {
      setBusy(false);
    }
  };

  if (prompt.type === "select") {
    return (
      <div className="space-y-1.5">
        <div className="text-[length:var(--fs-md)]">{prompt.message}</div>
        <div className="flex flex-wrap gap-1.5">
          {prompt.options?.map((option) => (
            <SettingsButton key={option.id} disabled={busy} onClick={() => void submit(option.id)}>
              {option.label}
            </SettingsButton>
          ))}
        </div>
      </div>
    );
  }
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) void submit(value.trim());
      }}
    >
      <div className="text-[length:var(--fs-md)]">{prompt.message}</div>
      <div className="flex items-center gap-2">
        <Input
          data-testid="provider-prompt-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={prompt.placeholder ?? ""}
          type={prompt.type === "secret" ? "password" : "text"}
          spellCheck={false}
          className="font-mono"
          autoFocus
        />
        <SettingsButton type="submit" disabled={busy || !value.trim()}>
          {busy ? <Spinner size="xs" /> : "Submit"}
        </SettingsButton>
      </div>
    </form>
  );
}

function LoginFlowPanel({
  jobId,
  providerName,
  onFinished,
  onClose,
}: {
  jobId: string;
  providerName: string;
  onFinished: () => void;
  onClose: () => void;
}) {
  const [job, setJob] = useState<ProviderLoginJobView | null>(null);
  const [cursor] = useState(() => ({ after: 0, events: [] as ProviderLoginEvent[], done: false }));

  useMountSubscription(() => {
    let cancelled = false;
    const tick = async () => {
      if (cursor.done || cancelled) return;
      try {
        const view = await requestJson(
          `/api/agent/providers/login/${encodeURIComponent(jobId)}?after=${cursor.after}`,
          decodeLoginJob,
        );
        if (cancelled) return;
        if (view.events.length > 0) {
          cursor.events = [...cursor.events, ...view.events];
          cursor.after = view.events[view.events.length - 1]?.seq ?? cursor.after;
        }
        if (view.status !== "running") cursor.done = true;
        setJob({ ...view, events: cursor.events });
        if (view.status === "success") onFinished();
      } catch {}
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 700);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId]);

  const respond = useCallback(
    async (promptId: number, value: string) => {
      await requestJson(
        `/api/agent/providers/login/${encodeURIComponent(jobId)}/respond`,
        () => ({ ok: true }),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ promptId, value }),
        },
      );
    },
    [jobId],
  );

  const cancel = async () => {
    await requestJson(
      `/api/agent/providers/login/${encodeURIComponent(jobId)}/cancel`,
      () => ({ ok: true }),
      { method: "POST" },
    ).catch(() => undefined);
    onClose();
  };

  return (
    <div
      data-testid="provider-login-panel"
      className="border border-(--border) px-4 py-3 space-y-2"
    >
      <div className="flex items-center gap-2">
        <span className="text-[length:var(--fs-md)]">Signing in to {providerName}</span>
        {job?.status === "running" && <Spinner size="xs" />}
        <span className="ml-auto">
          {job?.status === "running" ? (
            <SettingsButton onClick={() => void cancel()}>Cancel</SettingsButton>
          ) : (
            <SettingsButton onClick={onClose}>Close</SettingsButton>
          )}
        </span>
      </div>
      {job?.events.map((entry) => (
        <EventLine key={entry.seq} payload={entry.event} />
      ))}
      {job?.pendingPrompt && <PromptForm prompt={job.pendingPrompt} onRespond={respond} />}
      {job?.status === "error" && (
        <div data-testid="provider-login-error" className="text-[11px] text-(--err)">
          {job.error ?? "Sign-in failed."}
        </div>
      )}
      {job?.status === "success" && (
        <div data-testid="provider-login-success" className="text-[11px] text-(--ok,--accent)">
          Connected.
        </div>
      )}
    </div>
  );
}

function ProviderDrawer({
  provider,
  active,
  onConnect,
  onSignOut,
  onFinished,
  onClose,
}: {
  provider: ProviderView;
  active: ActiveLogin | null;
  onConnect: (provider: ProviderView, type: "oauth" | "api_key") => void;
  onSignOut: (providerId: string) => Promise<void>;
  onFinished: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const badge = credentialBadge(provider);
  const activeForProvider = active?.providerId === provider.id ? active : null;
  return (
    <ResourceDrawer
      title={provider.name}
      icon={<ResourceLogo identity={provider.id} label={provider.name} />}
      badge={
        <ModelStatus tone={provider.configured ? "good" : "default"}>
          {provider.configured ? "connected" : "available"}
        </ModelStatus>
      }
      status={`${provider.modelCount} models${badge ? ` · ${badge}` : ""}`}
      footer={
        <>
          {provider.oauth ? (
            <ModelButton onClick={() => onConnect(provider, "oauth")}>
              {provider.configured ? "Reconnect account" : "Sign in"}
            </ModelButton>
          ) : null}
          {provider.apiKey ? (
            <ModelButton onClick={() => onConnect(provider, "api_key")}>
              {provider.configured ? "Replace API key" : "API key"}
            </ModelButton>
          ) : null}
          {provider.configured && provider.credentialType ? (
            <ModelButton
              tone="danger"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onSignOut(provider.id).finally(() => {
                  setBusy(false);
                  onClose();
                });
              }}
            >
              {busy ? <Spinner size="xs" /> : <LogOut className="h-3 w-3" />}
              Sign out
            </ModelButton>
          ) : null}
        </>
      }
      onClose={onClose}
    >
      <ResourceDrawerSection title="Provider">
        <ResourceFact label="Company" value={provider.name} />
        <ResourceFact label="Provider ID" value={provider.id} mono />
        <ResourceFact label="Models" value={String(provider.modelCount)} mono />
        <ResourceFact
          label="Authentication"
          value={
            [provider.oauth ? "OAuth" : null, provider.apiKey ? "API key" : null]
              .filter(Boolean)
              .join(" · ") || "No sign-in method"
          }
        />
        <ResourceFact label="Credential" value={badge ?? "Not configured"} />
      </ResourceDrawerSection>
      <p className="mb-5 text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
        Models from {provider.name} appear beside controller models in Workbench after this provider
        is connected.
      </p>
      {activeForProvider ? (
        <LoginFlowPanel
          key={activeForProvider.jobId}
          jobId={activeForProvider.jobId}
          providerName={activeForProvider.providerName}
          onFinished={onFinished}
          onClose={onClose}
        />
      ) : null}
    </ResourceDrawer>
  );
}

type ActiveLogin = { jobId: string; providerId: string; providerName: string };

export function ModelProvidersSection() {
  const [providers, setProviders] = useState<ProviderView[] | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<ActiveLogin | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void requestJson("/api/agent/providers", decodeProviders)
      .then(({ providers: list }) => {
        setProviders(list);
        setSelectedProvider((current) =>
          current ? (list.find((provider) => provider.id === current.id) ?? current) : null,
        );
      })
      .catch((err: unknown) => {
        setProviders([]);
        setError(err instanceof Error ? err.message : "Failed to load providers");
      });
  }, []);

  useMountSubscription(() => {
    refresh();
  }, [refresh]);

  const connect = async (provider: ProviderView, type: "oauth" | "api_key") => {
    setError(null);
    try {
      const { jobId } = await requestJson(
        `/api/agent/providers/${encodeURIComponent(provider.id)}/login`,
        decodeLoginStart,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type }),
        },
      );
      setActive({ jobId, providerId: provider.id, providerName: provider.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start sign-in");
    }
  };

  const signOut = useCallback(
    async (providerId: string) => {
      await requestJson(
        `/api/agent/providers/${encodeURIComponent(providerId)}/logout`,
        () => ({ ok: true }),
        { method: "POST" },
      ).catch(() => undefined);
      refresh();
    },
    [refresh],
  );

  const finished = useCallback(() => {
    refresh();
  }, [refresh]);

  const visibleProviders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (providers ?? [])
      .filter(
        (provider) =>
          (provider.oauth || provider.apiKey || provider.configured) &&
          (!normalized ||
            `${provider.name} ${provider.id} ${credentialBadge(provider) ?? ""}`
              .toLowerCase()
              .includes(normalized)),
      )
      .sort(
        (left, right) =>
          Number(right.configured) - Number(left.configured) || left.name.localeCompare(right.name),
      );
  }, [providers, query]);
  const connectedCount = (providers ?? []).filter((provider) => provider.configured).length;

  return (
    <>
      <ModelSection
        title="Cloud models"
        description="Model companies available through account sign-in or API credentials."
        actions={
          <ModelStatus tone={connectedCount ? "good" : providers ? "default" : "info"}>
            {providers
              ? `${connectedCount} connected · ${visibleProviders.length} shown`
              : "loading"}
          </ModelStatus>
        }
      >
        <ModelRow
          label="Search model companies"
          description="Company, provider ID, credential type, or model count."
          control={
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search model companies"
              className="w-full"
            />
          }
          status={<ModelStatus>{visibleProviders.length}</ModelStatus>}
        />
        {providers === null ? (
          <div className="px-4 py-5">
            <Spinner size="xs" />
          </div>
        ) : (
          visibleProviders.map((provider) => (
            <ModelRow
              key={provider.id}
              label={provider.name}
              description={
                provider.configured
                  ? credentialBadge(provider) || "Connected provider"
                  : provider.oauth?.label || provider.apiKey?.label || provider.id
              }
              leading={<ResourceLogo identity={provider.id} label={provider.name} />}
              value={
                <ModelValue mono>
                  {`${provider.modelCount} models · ${[
                    provider.oauth ? "OAuth" : null,
                    provider.apiKey ? "API key" : null,
                  ]
                    .filter(Boolean)
                    .join(" / ")}`}
                </ModelValue>
              }
              status={
                <ModelStatus tone={provider.configured ? "good" : "default"}>
                  {provider.configured ? "connected" : "available"}
                </ModelStatus>
              }
              actions={
                <ModelButton onClick={() => setSelectedProvider(provider)}>
                  {provider.configured ? "Manage" : "Connect"}
                </ModelButton>
              }
              onClick={() => setSelectedProvider(provider)}
            />
          ))
        )}
        {providers !== null && visibleProviders.length === 0 ? (
          <div className="px-4 py-7 text-center text-[length:var(--fs-md)] text-(--ui-muted)">
            No model companies match this search.
          </div>
        ) : null}
      </ModelSection>
      {error ? (
        <div className="mt-4 text-[length:var(--fs-sm)] text-(--ui-danger)">{error}</div>
      ) : null}
      {selectedProvider ? (
        <ProviderDrawer
          provider={selectedProvider}
          active={active}
          onConnect={(provider, type) => void connect(provider, type)}
          onSignOut={signOut}
          onFinished={finished}
          onClose={() => {
            setActive(null);
            setSelectedProvider(null);
          }}
        />
      ) : null}
    </>
  );
}
