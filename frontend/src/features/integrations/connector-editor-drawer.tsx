"use client";

import { useMemo, useState } from "react";
import { Schema } from "effect";
import {
  ConnectorSshPathResponseSchema,
  ConnectorTestResponseSchema,
  ConnectorsResponseSchema,
  type ConnectorView,
} from "@local-studio/agent-runtime/connector-contract";
import { Alert, Button, Checkbox, FormField, Input, SegmentedControl, Spinner } from "@/ui";
import { Eye, EyeOff, Plus, Trash2, TriangleAlert } from "@/ui/icon-registry";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import { StatusText } from "@/features/recipes/recipes-content/catalog-table-shell";
import { jsonBody, requestAgentJson } from "./agent-json";
import {
  SSH_SERVER_PLACEHOLDER,
  renderCommandLine,
  type CatalogEntry,
} from "./connector-catalog";

/**
 * The one place an MCP server is written.
 *
 * An MCP server row is a command this machine will execute, so the form is
 * built around showing that command rather than around collecting fields. The
 * preview under the inputs is the literal argv the runtime will spawn, it
 * updates as you type, and it is the last thing between the form and the Save
 * button on purpose.
 *
 * Three rules follow from that and are load-bearing, not decoration:
 *
 *  1. Saving writes configuration and nothing else. No probe, no spawn, no
 *     "let's just check it works" on the way out.
 *  2. A new server is created disabled. Enabling is a separate, deliberate act,
 *     because enabling is what lets the next turn launch the command.
 *  3. Test is its own button and says what it does. It is the only control here
 *     that starts a process.
 *
 * Editing an existing row and creating a new one are the same component
 * deliberately: a catalog entry, a hand-written server, and a row someone is
 * revisiting all deserve the same review step, and the previous split let the
 * catalog path write an enabled connector with no command shown at all.
 */

const MASK = "••••••••";

/**
 * Default only: a credential-looking name starts out marked secret so the
 * common case needs no extra click. What is *stored and enforced* is the
 * explicit per-key flag the author can flip either way — the server masks by
 * that flag, never by re-running this pattern over the key name.
 */
const SECRET_NAME_DEFAULT = /token|key|secret|password|auth/i;

type Transport = "stdio" | "http";

type Pair = {
  key: string;
  value: string;
  /** Masked on every read once saved. */
  secret: boolean;
  /** True once the author chose explicitly, so key edits stop re-deriving it. */
  secretTouched: boolean;
};

export interface ConnectorDraft {
  id: string;
  name: string;
  transport: Transport;
  command: string;
  args: string;
  cwd: string;
  url: string;
  env: Pair[];
  headers: Pair[];
  allowTools: string;
  enabled: boolean;
}

const pairsFrom = (
  record: Readonly<Record<string, string>> | undefined,
  secretKeys: readonly string[],
): Pair[] =>
  Object.entries(record ?? {}).map(([key, value]) => ({
    key,
    value,
    // The server already resolved each stored key's secretness (explicit flag,
    // or the legacy name fallback) when it masked this view; mirror its answer.
    secret: secretKeys.includes(key),
    secretTouched: true,
  }));

const recordFrom = (pairs: Pair[]): Record<string, string> =>
  Object.fromEntries(
    pairs
      .map(({ key, value }) => [key.trim(), value] as const)
      .filter(([key]) => key.length > 0),
  );

const secretFlagsFrom = (pairs: Pair[]): Record<string, boolean> =>
  Object.fromEntries(
    pairs
      .map(({ key, secret }) => [key.trim(), secret] as const)
      .filter(([key]) => key.length > 0),
  );

const lines = (value: string): string[] =>
  value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);

export function draftFromConnector(connector: ConnectorView): ConnectorDraft {
  return {
    id: connector.id,
    name: connector.name,
    transport: connector.transport,
    command: connector.command ?? "",
    args: (connector.args ?? []).join("\n"),
    cwd: connector.cwd ?? "",
    url: connector.url ?? "",
    env: pairsFrom(connector.env, connector.secret_keys),
    headers: pairsFrom(connector.headers, connector.secret_keys),
    allowTools: (connector.allowTools ?? []).join("\n"),
    enabled: connector.enabled,
  };
}

export function emptyDraft(): ConnectorDraft {
  return {
    id: "",
    name: "",
    transport: "stdio",
    command: "",
    args: "",
    cwd: "",
    url: "",
    env: [],
    headers: [],
    allowTools: "",
    // Off, always. See rule 2 above.
    enabled: false,
  };
}

export function draftFromCatalog(entry: CatalogEntry, sshServerPath: string | null): ConnectorDraft {
  return {
    ...emptyDraft(),
    id: entry.id,
    name: entry.name,
    transport: entry.transport,
    command: entry.command,
    args: entry.args
      .map((arg) => (arg === SSH_SERVER_PLACEHOLDER ? (sshServerPath ?? arg) : arg))
      .join("\n"),
    env: entry.envFields.map((field) => ({
      key: field.key,
      value: "",
      secret: field.secret ?? SECRET_NAME_DEFAULT.test(field.key),
      // A catalog entry that declared secretness made the choice for the user;
      // one that did not leaves the key free to re-derive if it is edited.
      secretTouched: field.secret !== undefined,
    })),
  };
}

/** Resolve the bundled SSH server's absolute path, or null when it is missing. */
export async function resolveSshServerPath(): Promise<string | null> {
  const { path } = await requestAgentJson(
    "/api/agent/connectors/ssh-server-path",
    Schema.decodeUnknownSync(ConnectorSshPathResponseSchema),
  );
  return path;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function idProblem(id: string, taken: readonly string[]): string {
  if (!id) return "A server needs an id.";
  if (!ID_PATTERN.test(id)) {
    return "Use lowercase letters, digits, and hyphens, starting with a letter or digit.";
  }
  if (taken.includes(id)) return `"${id}" is already in use.`;
  return "";
}

function PairEditor({
  pairs,
  onChange,
  addLabel,
  keyPlaceholder,
  valuePlaceholder,
}: {
  pairs: Pair[];
  onChange: (next: Pair[]) => void;
  addLabel: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  const update = (index: number, patch: Partial<Pair>) =>
    onChange(pairs.map((pair, position) => (position === index ? { ...pair, ...patch } : pair)));

  // Renaming a key re-derives its default secretness until the author has
  // flipped the toggle themselves — the heuristic is a starting point, the
  // toggle is the decision.
  const updateKey = (index: number, key: string) => {
    const pair = pairs[index];
    update(index, {
      key,
      ...(pair && !pair.secretTouched ? { secret: SECRET_NAME_DEFAULT.test(key) } : {}),
    });
  };

  // Hide a value the user typed, reveal one the server masked. The bullets are
  // the token that means "keep the stored secret", so they have to stay legible
  // — a row of dots behind a password field reads as a bug and invites a retype
  // that would overwrite the very value it was protecting.
  const inputType = (pair: Pair) => (pair.secret && pair.value !== MASK ? "password" : "text");

  return (
    <div className="space-y-2">
      {pairs.map((pair, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={pair.key}
            onChange={(event) => updateKey(index, event.target.value)}
            placeholder={keyPlaceholder}
            className="w-2/5 font-mono"
            aria-label={`${addLabel} name`}
          />
          <Input
            value={pair.value}
            onChange={(event) => update(index, { value: event.target.value })}
            placeholder={valuePlaceholder}
            type={inputType(pair)}
            className="min-w-0 flex-1 font-mono"
            aria-label={`${addLabel} value`}
          />
          <button
            type="button"
            onClick={() => update(index, { secret: !pair.secret, secretTouched: true })}
            title={
              pair.secret
                ? `${pair.key || "This value"} is stored as a secret and masked after saving. Click to store it as a plain setting.`
                : `${pair.key || "This value"} is stored as a plain setting and stays readable. Click to store it as a secret.`
            }
            aria-pressed={pair.secret}
            aria-label={`Store ${pair.key || "entry"} as a secret`}
            className={`shrink-0 rounded-md p-1.5 transition-colors ${
              pair.secret ? "text-(--fg)" : "text-(--dim)/60 hover:text-(--dim)"
            }`}
          >
            {pair.secret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => onChange(pairs.filter((_, position) => position !== index))}
            title={`Remove ${pair.key || "entry"}`}
            className="shrink-0 rounded-md p-1.5 text-(--dim) transition-colors hover:text-(--err)"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([...pairs, { key: "", value: "", secret: false, secretTouched: false }])
        }
        className="inline-flex items-center gap-1.5 rounded-md text-[length:var(--fs-sm)] text-(--link) hover:underline"
      >
        <Plus className="h-3 w-3" />
        {addLabel}
      </button>
    </div>
  );
}

const CODE_CLASS =
  "w-full rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) px-3 py-2 font-mono text-[length:var(--fs-sm)] text-(--ui-fg) focus:border-(--ui-accent)/60 focus:outline-none";

type Patch = (next: Partial<ConnectorDraft>) => void;

function StdioFields({ draft, patch }: { draft: ConnectorDraft; patch: Patch }) {
  return (
    <>
      <FormField label="Command" description="The executable, without its arguments.">
        <Input
          value={draft.command}
          onChange={(event) => patch({ command: event.target.value })}
          placeholder="npx"
          className="font-mono"
        />
      </FormField>
      <FormField
        label="Arguments"
        description="One per line. Passed straight to the program — there is no shell, so quoting and globs are literal."
      >
        <textarea
          value={draft.args}
          onChange={(event) => patch({ args: event.target.value })}
          rows={5}
          spellCheck={false}
          aria-label="Arguments, one per line"
          className={CODE_CLASS}
        />
      </FormField>
      <FormField label="Working directory" description="Optional. Defaults to this app's.">
        <Input
          value={draft.cwd}
          onChange={(event) => patch({ cwd: event.target.value })}
          placeholder="/Users/you/projects/thing"
          className="font-mono"
        />
      </FormField>
      <FormField
        label="Environment variables"
        description="Added on top of the environment this app already passes down. The eye toggle marks a value as a secret: secrets are masked whenever this server is shown again."
      >
        <PairEditor
          pairs={draft.env}
          onChange={(env) => patch({ env })}
          addLabel="Add variable"
          keyPlaceholder="API_TOKEN"
          valuePlaceholder="value"
        />
      </FormField>
    </>
  );
}

function HttpFields({
  draft,
  patch,
  badScheme,
}: {
  draft: ConnectorDraft;
  patch: Patch;
  badScheme: boolean;
}) {
  return (
    <>
      <FormField
        label="URL"
        description="The streamable HTTP endpoint. Must be http:// or https://."
        error={badScheme ? "Only http:// and https:// endpoints are supported." : undefined}
      >
        <Input
          value={draft.url}
          onChange={(event) => patch({ url: event.target.value })}
          placeholder="https://example.com/mcp"
          className="font-mono"
        />
      </FormField>
      <FormField
        label="Headers"
        description="Sent with every request to that endpoint. The eye toggle marks a value as a secret: secrets are masked whenever this server is shown again."
      >
        <PairEditor
          pairs={draft.headers}
          onChange={(headers) => patch({ headers })}
          addLabel="Add header"
          keyPlaceholder="Authorization"
          valuePlaceholder="Bearer …"
        />
      </FormField>
    </>
  );
}

/**
 * The exact thing that will run, in the shape it will run in.
 *
 * Rendered from the draft rather than from what was saved, so it answers "what
 * am I about to agree to" while the answer can still be changed.
 */
function LaunchPreview({ draft }: { draft: ConnectorDraft }) {
  const commandLine = useMemo(
    () => renderCommandLine(draft.command.trim(), lines(draft.args)),
    [draft.command, draft.args],
  );
  const envKeys = draft.env.map((pair) => pair.key.trim()).filter(Boolean);
  const headerKeys = draft.headers.map((pair) => pair.key.trim()).filter(Boolean);

  return (
    <div className="rounded-[var(--rad-lg)] border border-(--ui-border) bg-(--ui-surface) px-3 py-2.5">
      <div className="text-[length:var(--fs-xs)] uppercase tracking-wider text-(--dim)/70">
        {draft.transport === "stdio" ? "Command that will run" : "Endpoint that will be called"}
      </div>
      <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[length:var(--fs-sm)] leading-5 text-(--fg)">
        {draft.transport === "stdio"
          ? commandLine || "— no command yet —"
          : draft.url.trim() || "— no URL yet —"}
      </pre>
      <dl className="mt-2 space-y-0.5 text-[length:var(--fs-xs)] text-(--dim)">
        {draft.transport === "stdio" ? (
          <>
            <div>
              <dt className="inline">Working directory: </dt>
              <dd className="inline font-mono">{draft.cwd.trim() || "this app's directory"}</dd>
            </div>
            <div>
              <dt className="inline">Extra environment: </dt>
              <dd className="inline font-mono">{envKeys.join(", ") || "none"}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt className="inline">Headers sent: </dt>
            <dd className="inline font-mono">{headerKeys.join(", ") || "none"}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** The sentence that has to be read before the form is filled in, per transport. */
const TransportWarning = ({ transport }: { transport: Transport }) => (
  <Alert variant="warning" className="mb-6">
    {transport === "stdio"
      ? "An MCP server is a program this machine runs. The command below executes with your user account and inherits this app's environment, including any keys it holds. Only add commands you would run in your own terminal."
      : "This machine will call the URL below and send it whatever headers you list, then hand the model the tools it declares. Only add endpoints you trust with that."}
  </Alert>
);

function IdentityFields({
  draft,
  patch,
  creating,
  idError,
}: {
  draft: ConnectorDraft;
  patch: Patch;
  creating: boolean;
  idError: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <FormField
        label="Server id"
        description={
          creating ? "Names its tools to the model. Cannot be changed later." : "Fixed once created."
        }
        error={idError || undefined}
      >
        <Input
          value={draft.id}
          onChange={(event) => patch({ id: event.target.value })}
          disabled={!creating}
          placeholder="my-server"
          className="font-mono"
        />
      </FormField>
      <FormField label="Display name">
        <Input
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder={draft.id || "My server"}
        />
      </FormField>
    </div>
  );
}

/**
 * Enabling is the moment this configuration becomes a running program, so on a
 * new server the checkbox says so out loud instead of leaving the consequence
 * to be inferred from a table two screens away.
 */
function EnabledField({
  enabled,
  creating,
  onChange,
}: {
  enabled: boolean;
  creating: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <>
      <Checkbox
        checked={enabled}
        onChange={onChange}
        label="Enabled — offer these tools to the model"
      />
      {enabled && creating ? (
        <p className="mt-2 flex items-start gap-1.5 text-[length:var(--fs-sm)] text-(--warn)">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This launches on your next message.
        </p>
      ) : null}
    </>
  );
}

function TestBar({
  testing,
  result,
  onTest,
}: {
  testing: boolean;
  result: { ok: boolean; text: string } | null;
  onTest: () => void;
}) {
  return (
    <div className="mt-5 flex items-center gap-3 border-t border-(--ui-separator) pt-4">
      <Button
        variant="secondary"
        loading={testing}
        onClick={onTest}
        title="Launch this server now and list the tools it declares"
      >
        {testing ? <Spinner size="xs" /> : "Run it and list its tools"}
      </Button>
      {result ? (
        <StatusText tone={result.ok ? "ok" : "error"}>{result.text}</StatusText>
      ) : (
        <span className="text-[length:var(--fs-sm)] text-(--dim)">
          Starts the saved command, then stops it.
        </span>
      )}
    </div>
  );
}

export function ConnectorEditorDrawer({
  draft: initial,
  mode,
  takenIds,
  secretKeys,
  onClose,
  onChanged,
}: {
  draft: ConnectorDraft;
  mode: "create" | "edit";
  /** Ids already spoken for, so a create cannot silently overwrite one. */
  takenIds: readonly string[];
  /** Keys whose stored value the server masked, named so nobody retypes them. */
  secretKeys: readonly string[];
  onClose: () => void;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState("");

  const patch = (next: Partial<ConnectorDraft>) => setDraft((current) => ({ ...current, ...next }));
  const creating = mode === "create";
  const idError = creating ? idProblem(draft.id.trim(), takenIds) : "";
  const missingTarget =
    draft.transport === "stdio" ? !draft.command.trim() : !draft.url.trim();
  const badScheme =
    draft.transport === "http" &&
    draft.url.trim().length > 0 &&
    !/^https?:\/\//i.test(draft.url.trim());

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const id = draft.id.trim();
      const { connectors } = await requestAgentJson(
        "/api/agent/connectors",
        Schema.decodeUnknownSync(ConnectorsResponseSchema),
        jsonBody({
          id,
          name: draft.name.trim() || id,
          transport: draft.transport,
          ...(draft.transport === "stdio"
            ? {
                command: draft.command.trim(),
                args: lines(draft.args),
                cwd: draft.cwd.trim() || undefined,
                env: recordFrom(draft.env),
                envSecret: secretFlagsFrom(draft.env),
              }
            : {
                url: draft.url.trim(),
                headers: recordFrom(draft.headers),
                headerSecret: secretFlagsFrom(draft.headers),
              }),
          allowTools: lines(draft.allowTools),
          enabled: draft.enabled,
        }),
      );
      onChanged(connectors);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Connector save failed");
    } finally {
      setSaving(false);
    }
  };

  /**
   * The only control here that starts anything.
   *
   * It probes what is *saved*, not what is typed, because the pool spawns from
   * the stored row — testing the draft would answer a question about a
   * configuration that does not exist yet.
   */
  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await requestAgentJson(
        "/api/agent/connectors/test",
        Schema.decodeUnknownSync(ConnectorTestResponseSchema),
        jsonBody({ id: draft.id.trim() }),
      );
      setTestResult({
        ok: result.ok,
        text: result.ok
          ? `${result.tool_count} tools: ${result.tool_names.join(", ") || "none declared"}`
          : (result.error ?? "the server did not answer"),
      });
    } catch (testError) {
      setTestResult({
        ok: false,
        text: testError instanceof Error ? testError.message : "test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <ResourceDrawer
      title={creating ? "New MCP server" : draft.name || draft.id}
      icon={<ResourceLogo identity={draft.id || "mcp"} label={draft.name || "MCP server"} />}
      status={
        creating
          ? "Saved to connectors.json — nothing runs until you enable it"
          : `${draft.transport} · connectors.json`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={Boolean(idError) || missingTarget || badScheme}
            onClick={() => void save()}
          >
            {creating ? "Save server" : "Save changes"}
          </Button>
        </>
      }
      onClose={onClose}
      width={720}
    >
      <TransportWarning transport={draft.transport} />

      <div className="mb-6 space-y-4">
        <IdentityFields draft={draft} patch={patch} creating={creating} idError={idError} />

        <FormField
          label="How it is reached"
          description="A local command this machine launches, or an HTTP endpoint it calls."
        >
          <SegmentedControl<Transport>
            items={[
              { id: "stdio", label: "Local command" },
              { id: "http", label: "HTTP endpoint" },
            ]}
            value={draft.transport}
            onChange={(transport) => patch({ transport })}
          />
        </FormField>

        {draft.transport === "stdio" ? (
          <StdioFields draft={draft} patch={patch} />
        ) : (
          <HttpFields draft={draft} patch={patch} badScheme={badScheme} />
        )}

        <FormField
          label="Allowed tools"
          description="One per line. Leave empty to allow every tool this server declares."
        >
          <textarea
            value={draft.allowTools}
            onChange={(event) => patch({ allowTools: event.target.value })}
            rows={3}
            spellCheck={false}
            className={CODE_CLASS}
          />
        </FormField>
      </div>

      <ResourceDrawerSection
        title="What saving does"
        description="Writing this row does not start anything. The command runs when you enable the server and send your next message, or when you press Test."
      >
        <ResourceFact label="Launch" value={<LaunchPreview draft={draft} />} />
        {secretKeys.length ? (
          <ResourceFact
            label="Stored secrets"
            value={`${secretKeys.join(" · ")} — shown as ${MASK}. Leave them alone to keep the stored value; typing replaces it.`}
          />
        ) : null}
      </ResourceDrawerSection>

      <EnabledField
        enabled={draft.enabled}
        creating={creating}
        onChange={(enabled) => patch({ enabled })}
      />

      {creating ? null : (
        <TestBar testing={testing} result={testResult} onTest={() => void test()} />
      )}

      {error ? <p className="mt-4 text-[length:var(--fs-sm)] text-(--ui-danger)">{error}</p> : null}
    </ResourceDrawer>
  );
}
