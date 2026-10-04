import { useEffect, useState } from "react";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import {
  LocalRegistry,
  LocalRegistryRecord,
  LocalSharePreview,
  LocalShareResult,
  type LocalRegistryVariant,
} from "@t3tools/contracts/local-studio";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsSection } from "../settings/settingsLayout";

type Call = (path: string, controller: string, body?: unknown) => Effect.Effect<unknown, Error>;

const load = <A,>(
  effect: Effect.Effect<unknown, Error>,
  schema: Schema.Codec<A, unknown>,
  done: (value: A) => void,
  failed: (message: string) => void,
) =>
  void Effect.runPromise(effect.pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema))))
    .then(done)
    .catch((cause: unknown) => failed(String(cause)));

const summary = (v: LocalRegistryVariant) =>
  [
    v.engine,
    v.precision ?? v.format,
    v.sizeGb != null ? `${v.sizeGb.toFixed(1)} GB` : null,
    `${v.hardwareCount > 1 ? `${v.hardwareCount}× ` : ""}${v.hardwareId}`,
    v.status,
    v.recommended ? "recommended" : null,
  ]
    .filter(Boolean)
    .join(" · ");

const Json = ({ label, value }: { label: string; value: unknown }) =>
  value ? (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        {label}
      </summary>
      <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-muted/50 p-2 text-2xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  ) : null;

function Inspect({ id, controller, call }: { id: string; controller: string; call: Call }) {
  const [record, setRecord] = useState<LocalRegistryRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "launch command" });
  useEffect(
    () =>
      load(
        call(`registry/records/${encodeURIComponent(id)}`, controller),
        LocalRegistryRecord,
        setRecord,
        setError,
      ),
    [id, controller, call],
  );
  if (error) return <p className="text-xs break-all text-destructive">{error}</p>;
  if (!record) return <p className="text-xs text-muted-foreground">Reading the record…</p>;
  const weights = record.weights;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
      {record.command && (
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 text-2xs">{record.command}</pre>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={!record.command}
          onClick={() => record.command && copyToClipboard(record.command, undefined)}
        >
          {isCopied ? "Copied" : "Use config"}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={!weights || state === "downloading"}
          onClick={() =>
            load(
              call("registry/download", controller, { recipeId: id }),
              Schema.Struct({ state: Schema.String }),
              (r) => setState(r.state),
              setError,
            )
          }
        >
          {state === "downloading" ? "Downloading…" : "Download weights"}
        </Button>
        {weights && (
          <a
            href={`https://huggingface.co/${weights.repo}${weights.revision ? `/tree/${weights.revision}` : ""}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {weights.repo}
            {weights.revision ? `@${weights.revision.slice(0, 8)}` : ""}
            <ExternalLinkIcon className="size-3" />
          </a>
        )}
      </div>
      <Json label="Recipe" value={record.recipe} />
      <Json label="Model instance" value={record.modelInstance} />
      <Json label="Model" value={record.model} />
      <Json label="Hardware" value={record.hardware} />
    </div>
  );
}

export function RegistrySection({
  devices,
  call,
}: {
  devices: ReadonlyArray<{ label: string; controller: string }>;
  call: Call;
}) {
  const [controller, setController] = useState("");
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<LocalRegistry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [limit, setLimit] = useState(40);
  useEffect(
    () =>
      load(
        call(`registry${all ? "?all=1" : ""}`, controller),
        LocalRegistry,
        (value) => {
          setData(value);
          setError(null);
        },
        setError,
      ),
    [all, controller, call],
  );
  const q = query.trim().toLowerCase();
  const models = (data?.models ?? []).filter(
    (m) =>
      !q ||
      m.repo.toLowerCase().includes(q) ||
      m.variants.some((v) =>
        `${v.engine} ${v.hardwareId} ${v.precision}`.toLowerCase().includes(q),
      ),
  );
  const matched = (data?.matches ?? []).filter((m) => m.hardwareId);
  return (
    <SettingsSection
      title="Registry"
      headerAction={
        <div className="flex items-center gap-2">
          {devices.length > 1 && (
            <Select
              items={devices.map((d) => ({ value: d.controller, label: d.label }))}
              value={controller}
              onValueChange={(value) => setController(value ?? "")}
            >
              <SelectTrigger size="sm" className="w-36" aria-label="Machine">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {devices.map((d) => (
                  <SelectItem key={d.controller} value={d.controller}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch size="sm" checked={all} onCheckedChange={setAll} />
            All hardware
          </label>
        </div>
      }
    >
      <div className="flex flex-col gap-3 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            size="sm"
            className="w-full sm:w-64"
            placeholder="Filter models, engines, hardware"
            aria-label="Filter registry"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            {error
              ? error
              : !data
                ? "Reading the registry…"
                : `${matched.length ? `Matched ${matched.map((m) => `${m.count > 1 ? `${m.count}× ` : ""}${m.hardwareName}`).join(", ")}` : `No registry hardware matches ${data.matches.map((m) => m.name).join(", ") || "this machine"}`} · ${models.length} of ${data.total} models${data.commit ? ` · ${data.commit.slice(0, 8)}` : ""}`}
          </span>
        </div>
        {data && models.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {all
              ? "Nothing matches the filter."
              : "No registry configurations for this hardware yet. Turn on All hardware to browse everything."}
          </p>
        )}
        <div className="flex flex-col">
          {models.slice(0, limit).map((m) => {
            const best = m.variants[0];
            const expanded = open === m.repo;
            return (
              <div key={m.repo} className="border-t border-border/60 first:border-t-0">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : m.repo)}
                  className="flex w-full items-center gap-2 py-2 text-left hover:bg-accent/40"
                >
                  <ChevronRightIcon
                    aria-hidden
                    className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-foreground">{m.repo}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {best && summary(best)}
                      {data?.downloads[m.repo] ? ` · ${data.downloads[m.repo]}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {m.variants.length} variant{m.variants.length === 1 ? "" : "s"}
                  </span>
                </button>
                {expanded && (
                  <div className="flex flex-col gap-2 pb-3 ps-6">
                    {m.variants.map((v) => (
                      <div key={v.id} className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="min-w-0 flex-1 truncate">
                            <span className={v.fits ? "text-foreground" : "text-muted-foreground"}>
                              {summary(v)}
                            </span>
                          </span>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setInspect(inspect === v.id ? null : v.id)}
                          >
                            {inspect === v.id ? "Close" : "Inspect"}
                          </Button>
                        </div>
                        {inspect === v.id && (
                          <Inspect id={v.id} controller={controller} call={call} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {models.length > limit && (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setLimit(limit + 40)}
          >
            Show more ({models.length - limit} left)
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}

export function SharePanel({
  port,
  controller,
  call,
  onClose,
}: {
  port: number;
  controller: string;
  call: Call;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<LocalSharePreview | null>(null);
  const [step, setStep] = useState<"preview" | "confirm" | "creating">("preview");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      load(
        call(`registry/share?port=${port}`, controller),
        LocalSharePreview,
        setPreview,
        setError,
      ),
    [port, controller, call],
  );
  const blocked = !preview || preview.blockers.length > 0 || preview.issues.length > 0;
  const create = () => {
    setStep("creating");
    load(
      call("registry/share", controller, { port, confirm: true }),
      LocalShareResult,
      (r) => setUrl(r.url),
      (message) => {
        setError(message);
        setStep("confirm");
      },
    );
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 p-3 text-xs">
      {!preview && !error && (
        <p className="text-muted-foreground">
          Preparing registry records. A short validation request is sent to this server.
        </p>
      )}
      {error && <p className="break-all text-destructive">{error}</p>}
      {preview && (
        <>
          <p className="text-foreground">{preview.title}</p>
          {[...preview.blockers, ...preview.issues].map((issue) => (
            <p key={issue} className="text-destructive">
              {issue}
            </p>
          ))}
          <p className="text-muted-foreground">
            Scrubbed: {preview.redactions.join(", ") || "nothing needed"}
            {preview.reused.length ? ` · Reuses ${preview.reused.join(", ")}` : ""}
          </p>
          {preview.files.map((file) => (
            <Json key={file.path} label={file.path} value={file.record} />
          ))}
        </>
      )}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
        >
          Pull request opened
          <ExternalLinkIcon className="size-3" />
        </a>
      ) : (
        <>
          {step !== "preview" && preview && (
            <p className="text-foreground">This will create a PR to {preview.target}</p>
          )}
          <div className="flex gap-2">
            <Button
              size="xs"
              disabled={blocked || step === "creating"}
              onClick={() => (step === "preview" ? setStep("confirm") : create())}
            >
              {step === "preview" ? "Share" : step === "creating" ? "Creating PR…" : "Create PR"}
            </Button>
            <Button size="xs" variant="outline" disabled={step === "creating"} onClick={onClose}>
              Decline
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
