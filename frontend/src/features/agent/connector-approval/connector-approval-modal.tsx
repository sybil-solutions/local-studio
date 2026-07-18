"use client";

import { Alert, Button, UiModal, UiModalHeader } from "@/ui";
import { ShieldCheck } from "@/ui/icon-registry";
import type { ConnectorRisk } from "@local-studio/agent-runtime/connector-contract";
import {
  decideConnectorApproval,
  useConnectorApprovals,
} from "@/features/agent/connector-approval/store";

function riskMessage(risk: ConnectorRisk): string {
  if (risk === "mutating") return "This action changes data and requires a one-use approval.";
  return "This critical action has the highest confirmation tier and can affect a remote system.";
}

export function ConnectorApprovalModal() {
  const { approvals, decidingId, error } = useConnectorApprovals();
  const approval = approvals[0];
  if (!approval) return null;
  const busy = decidingId === approval.id;
  const decide = (decision: "approve" | "deny") => {
    if (busy) return;
    void decideConnectorApproval(approval.id, decision);
  };

  return (
    <UiModal isOpen onClose={() => decide("deny")} maxWidth="max-w-xl">
      <UiModalHeader
        title="Approve connector action"
        icon={<ShieldCheck className="h-4 w-4 text-(--ui-warning)" />}
        onClose={() => decide("deny")}
        closeLabel="Deny connector action"
      />
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
        <Alert variant={approval.risk === "critical" ? "error" : "warning"}>
          {riskMessage(approval.risk)}
        </Alert>
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[length:var(--fs-sm)]">
          <dt className="text-(--ui-muted)">Connector</dt>
          <dd className="font-medium text-(--ui-fg)">{approval.connector_name}</dd>
          <dt className="text-(--ui-muted)">Tool</dt>
          <dd className="font-mono text-(--ui-fg)">{approval.tool}</dd>
          <dt className="text-(--ui-muted)">Session</dt>
          <dd className="truncate font-mono text-(--ui-fg)">{approval.session_id}</dd>
          <dt className="text-(--ui-muted)">Expires</dt>
          <dd className="text-(--ui-fg)">{new Date(approval.expires_at).toLocaleTimeString()}</dd>
        </dl>
        <div className="mt-4">
          <div className="mb-2 text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.08em] text-(--ui-muted)">
            Redacted argument summary
          </div>
          <div className="max-h-48 overflow-y-auto rounded-[var(--rad-lg)] border border-(--ui-border) bg-(--color-surface) p-3 font-mono text-[length:var(--fs-xs)]">
            {approval.argument_summary.length ? (
              approval.argument_summary.map((entry) => (
                <div key={`${entry.path}:${entry.type}`} className="flex gap-2 py-0.5">
                  <span className="min-w-0 flex-1 truncate text-(--ui-fg)">{entry.path}</span>
                  <span className="shrink-0 text-(--ui-muted)">
                    {entry.type}
                    {entry.detail ? ` · ${entry.detail}` : ""}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-(--ui-muted)">No arguments</div>
            )}
          </div>
        </div>
        {error ? (
          <Alert variant="error" className="mt-4">
            {error}
          </Alert>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-(--color-popover-border) px-5 py-3.5">
        <Button variant="secondary" onClick={() => decide("deny")} disabled={busy}>
          Deny
        </Button>
        <Button onClick={() => decide("approve")} loading={busy}>
          Approve once
        </Button>
      </div>
    </UiModal>
  );
}
