"use client";

import { useCallback, useState } from "react";
import type {
  ProviderLoginEvent,
  ProviderLoginEventPayload,
  ProviderLoginJobView,
  ProviderLoginPrompt,
  ProviderView,
  ProvidersResponse,
  ProviderLoginStartResponse,
} from "@local-studio/agent-runtime/provider-hub-contract";
import { Input, SearchInput, Spinner } from "@/ui";
import { Brain, ExternalLink, LogOut } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { SettingsButton, SettingsGroup } from "@/features/settings/settings-ui";
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
  // Accumulates polled events across ticks; created once per mounted job
  // (the panel is keyed by jobId).
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
      } catch {
        // Transient poll failure; next tick retries.
      }
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

function ConnectedRow({
  provider,
  onSignOut,
}: {
  provider: ProviderView;
  onSignOut: (providerId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const badge = credentialBadge(provider);
  return (
    <div
      data-testid={`provider-row-${provider.id}`}
      className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-(--border) last:border-b-0"
    >
      <Brain className="h-3.5 w-3.5 text-(--accent)" />
      <div className="min-w-40">
        <div className="text-[length:var(--fs-md)]">{provider.name}</div>
        <div className="text-[11px] font-mono text-(--dim)">
          {provider.modelCount} models{badge ? ` · ${badge}` : ""}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {provider.credentialType && (
          <SettingsButton
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onSignOut(provider.id).finally(() => setBusy(false));
            }}
          >
            {busy ? <Spinner size="xs" /> : <LogOut className="h-3 w-3" />}
            Sign out
          </SettingsButton>
        )}
      </div>
    </div>
  );
}

function AddProviderRow({
  provider,
  onConnect,
}: {
  provider: ProviderView;
  onConnect: (provider: ProviderView, type: "oauth" | "api_key") => void;
}) {
  return (
    <div
      data-testid={`provider-add-${provider.id}`}
      className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-(--border) last:border-b-0"
    >
      <div className="min-w-40">
        <div className="text-[length:var(--fs-md)]">{provider.name}</div>
        <div className="text-[11px] font-mono text-(--dim)">
          {provider.oauth?.label ?? provider.apiKey?.label ?? provider.id}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {provider.oauth && (
          <SettingsButton onClick={() => onConnect(provider, "oauth")}>Sign in</SettingsButton>
        )}
        {provider.apiKey && (
          <SettingsButton onClick={() => onConnect(provider, "api_key")}>API key</SettingsButton>
        )}
      </div>
    </div>
  );
}

type ActiveLogin = { jobId: string; providerId: string; providerName: string };

export function ModelProvidersSection() {
  const [providers, setProviders] = useState<ProviderView[] | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<ActiveLogin | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void requestJson("/api/agent/providers", decodeProviders)
      .then(({ providers: list }) => setProviders(list))
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

  const connected = (providers ?? []).filter((provider) => provider.configured);
  const available = (providers ?? []).filter(
    (provider) =>
      !provider.configured &&
      (provider.oauth || provider.apiKey) &&
      (query.trim() === "" ||
        `${provider.name} ${provider.id}`.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <div className="space-y-6">
      <SettingsGroup
        title="Connected providers"
        description="Cloud model providers signed in through pi. Their models appear in the model picker beside your controller models."
      >
        {providers === null ? (
          <div className="px-4 py-3.5">
            <Spinner size="xs" />
          </div>
        ) : connected.length === 0 ? (
          <div className="px-4 py-3.5 text-[length:var(--fs-md)] text-(--dim)">
            No providers connected. Sign in below to use cloud models alongside your controller.
          </div>
        ) : (
          connected.map((provider) => (
            <ConnectedRow key={provider.id} provider={provider} onSignOut={signOut} />
          ))
        )}
      </SettingsGroup>

      {active && (
        <LoginFlowPanel
          key={active.jobId}
          jobId={active.jobId}
          providerName={active.providerName}
          onFinished={finished}
          onClose={() => setActive(null)}
        />
      )}
      {error && <div className="text-[11px] text-(--err)">{error}</div>}

      <SettingsGroup
        title="Add a provider"
        description="Sign in with an account (OAuth) or an API key. Credentials are stored in pi's auth.json."
      >
        <div className="px-4 py-2.5 border-b border-(--border)">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search providers…"
            className="max-w-72"
          />
        </div>
        {available.map((provider) => (
          <AddProviderRow key={provider.id} provider={provider} onConnect={connect} />
        ))}
        {providers !== null && available.length === 0 && (
          <div className="px-4 py-3.5 text-[length:var(--fs-md)] text-(--dim)">
            No matching providers.
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}
