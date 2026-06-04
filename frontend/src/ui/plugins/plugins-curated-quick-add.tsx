"use client";

import { EmptySafeNotice } from "../list";
import { SettingsGroup } from "../settings";
import { RegistryRow } from "./plugins-page-parts";
import type { CatalogueEntry } from "./plugins-types";

export function CuratedQuickAddPanel({
  entries,
  installedNames,
  busyId,
  loading = false,
  onConfigure,
}: {
  entries: CatalogueEntry[];
  installedNames: Set<string>;
  busyId: string | null;
  loading?: boolean;
  onConfigure: (entry: CatalogueEntry) => void;
}) {
  return (
    <SettingsGroup
      title="Curated quick add"
      description="Fixed stdio launch lines for high-confidence reference servers."
    >
      {entries.length ? (
        entries.map((entry) => (
          <RegistryRow
            key={entry.id}
            entry={entry}
            added={installedNames.has(entry.name.toLowerCase())}
            busy={busyId === entry.id}
            onConfigure={() => onConfigure(entry)}
          />
        ))
      ) : (
        <EmptySafeNotice>
          {loading ? "Loading curated MCP servers..." : "No curated MCP servers available."}
        </EmptySafeNotice>
      )}
    </SettingsGroup>
  );
}
