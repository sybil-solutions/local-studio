"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import {
  ConnectorGrantSchema,
  ConnectorGrantsResponseSchema,
  type ConnectorGrant,
  type ConnectorGrantTarget,
} from "@local-studio/agent-runtime/connector-grants-contract";
import { Alert } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  DataRow,
  EndCell,
  HeadCell,
  IdentityCell,
  RowAction,
  StatusText,
  TableFrame,
  TableNotice,
  TableSection,
  TableSkeleton,
  TextCell,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import {
  CatalogSectionHeader,
  useCatalogSection,
} from "@/features/recipes/recipes-content/catalog-section";
import { requestAgentJson } from "./agent-json";
import { ConnectorGrantForm, EVERY_MODEL_VALUE, type GrantDraft } from "./connector-grant-form";

/**
 * Which models may call which connector tools.
 *
 * Enabling a connector grants every model all of its tools, exactly as before
 * this table existed; everything here is a narrowing the user chooses. The
 * model id is asserted by the session that calls the connector, so this governs
 * the model's own tool choices — it is not a sandbox against other local code
 * that can reach the same loopback endpoint.
 */
const GRANT_COLUMNS = ["Connector", "Model", "Access"] as const;
const GRANT_MIN_WIDTH = "min-w-[34rem]";
const GRANTS_URL = "/api/agent/connectors/grants";

const AgentModelsResponseSchema = Schema.Struct({
  models: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
});

const GrantMutationResponseSchema = Schema.Struct({ grants: Schema.Array(ConnectorGrantSchema) });

const emptyDraft = (): GrantDraft => ({
  connectorId: "",
  modelId: EVERY_MODEL_VALUE,
  tools: "all",
});

const grantKey = (grant: ConnectorGrant) => `${grant.modelId}::${grant.connectorId}`;

function toolSummary(grant: ConnectorGrant): string {
  if (grant.tools === "all") return "All tools";
  return grant.tools.length === 1 ? "1 tool" : `${grant.tools.length} tools`;
}

export function ConnectorAccessSection() {
  const [connectors, setConnectors] = useState<ConnectorGrantTarget[]>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [draft, setDraft] = useState<GrantDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);

  // One refresh loads two endpoints: the grants (with their connector targets)
  // and the model catalog the form's picker is drawn from.
  const load = useCallback(
    () =>
      Promise.all([
        requestAgentJson(GRANTS_URL, Schema.decodeUnknownSync(ConnectorGrantsResponseSchema)),
        requestAgentJson(
          "/api/agent/models",
          Schema.decodeUnknownSync(AgentModelsResponseSchema),
        ).catch(() => ({ models: [] })),
      ]).then(([access, catalog]) => {
        setConnectors([...access.connectors]);
        setModels(catalog.models.map((model) => ({ id: model.id, name: model.name })));
        setDraft((current) =>
          current.connectorId
            ? current
            : { ...current, connectorId: access.connectors[0]?.id ?? "" },
        );
        return access.grants;
      }),
    [],
  );
  const section = useCatalogSection({ load });
  const { items: grants, setItems: setGrants, loaded, error, setError } = section;

  // Tool names are fetched only for the connector being edited. Listing them
  // for everything would open every enabled connector, and opening a stdio MCP
  // connector spawns its child process — viewing this page must not execute
  // anything.
  const loadConnectorTools = useCallback((connectorId: string) => {
    if (!connectorId) return;
    void requestAgentJson(
      `${GRANTS_URL}?connector=${encodeURIComponent(connectorId)}`,
      Schema.decodeUnknownSync(ConnectorGrantsResponseSchema),
    )
      .then((access) => {
        const probed = access.connectors.find((entry) => entry.id === connectorId);
        if (!probed) return;
        setConnectors((current) =>
          current.map((entry) => (entry.id === connectorId ? probed : entry)),
        );
      })
      .catch(() => {});
  }, []);

  useMountSubscription(() => {
    loadConnectorTools(draft.connectorId);
  }, [draft.connectorId, loadConnectorTools]);

  const mutate = async (init: RequestInit) => {
    setBusy(true);
    try {
      const result = await requestAgentJson(
        GRANTS_URL,
        Schema.decodeUnknownSync(GrantMutationResponseSchema),
        { headers: { "content-type": "application/json" }, ...init },
      );
      setGrants(result.grants);
      setError("");
    } catch (mutateError) {
      setError(mutateError instanceof Error ? mutateError.message : "Connector access failed");
    } finally {
      setBusy(false);
    }
  };

  const modelLabel = (modelId: string) =>
    modelId === EVERY_MODEL_VALUE
      ? "Every model"
      : (models.find((model) => model.id === modelId)?.name ?? modelId);

  const connectorLabel = (connectorId: string) =>
    connectors.find((entry) => entry.id === connectorId)?.name ?? connectorId;

  return (
    <>
      {error ? (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
      <TableSection
        title="Model access"
        description="Connector tools a model may be offered and may call. A model with no row here sees none of that connector's tools."
        actions={
          <CatalogSectionHeader
            section={section}
            statusTone={error ? "warn" : loaded ? "ok" : "dim"}
            statusText={loaded ? `${grants.length} grants` : "loading"}
            refreshLabel="Refresh grants"
          />
        }
      >
        {!loaded ? (
          <TableSkeleton columns={GRANT_COLUMNS} rows={2} minWidthClass={GRANT_MIN_WIDTH} />
        ) : (
          <div className="space-y-4">
            {grants.length ? (
              <TableFrame minWidthClass={GRANT_MIN_WIDTH}>
                <thead>
                  <tr>
                    {GRANT_COLUMNS.map((column, index) => (
                      <HeadCell key={column} numeric={index === GRANT_COLUMNS.length - 1}>
                        {column}
                      </HeadCell>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grants.map((grant) => (
                    <DataRow key={grantKey(grant)} ariaLabel={connectorLabel(grant.connectorId)}>
                      <IdentityCell
                        label={connectorLabel(grant.connectorId)}
                        description={grant.connectorId}
                      />
                      <TextCell>{modelLabel(grant.modelId)}</TextCell>
                      <EndCell>
                        <div className="flex items-center justify-end gap-2">
                          <StatusText tone="ok">{toolSummary(grant)}</StatusText>
                          <RowAction
                            alwaysVisible
                            disabled={busy}
                            title={`Revoke ${connectorLabel(grant.connectorId)}`}
                            onClick={() =>
                              void mutate({
                                method: "DELETE",
                                body: JSON.stringify({
                                  modelId: grant.modelId,
                                  connectorId: grant.connectorId,
                                }),
                              })
                            }
                          >
                            Revoke
                          </RowAction>
                        </div>
                      </EndCell>
                    </DataRow>
                  ))}
                </tbody>
              </TableFrame>
            ) : (
              <TableNotice
                title="No model can reach a connector"
                body="Every connector tool is denied until a grant names the model that may call it."
              />
            )}
            {connectors.length ? (
              <ConnectorGrantForm
                connectors={connectors}
                models={models}
                draft={draft}
                busy={busy}
                onDraft={setDraft}
                onSubmit={() =>
                  void mutate({ method: "PUT", body: JSON.stringify(draft) }).then(() =>
                    setDraft(emptyDraft),
                  )
                }
              />
            ) : (
              <Alert variant="info">
                Enable a connector or sign into an account first — access is granted per connector.
              </Alert>
            )}
          </div>
        )}
      </TableSection>
    </>
  );
}
