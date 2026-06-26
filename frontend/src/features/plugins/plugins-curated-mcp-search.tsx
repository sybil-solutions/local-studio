"use client";

import { Search } from "@/ui/icon-registry";
import { EmptySafeNotice } from "@/ui/list";
import { SettingsGroup, SettingsInput, SettingsRow } from "@/ui/settings";
import { StatusPill } from "@/ui/status";
import { CuratedMcpRow } from "./plugins-page-parts";
import type { CatalogueEntry } from "./plugins-types";

export function CuratedMcpSearchPanel({
  title = "Curated MCP servers",
  description = "Connect reviewed MCP servers. OAuth-managed entries connect without pasted tokens.",
  entries,
  loading,
  search,
  installedNames,
  busyId,
  onSearchChange,
  onConfigure,
}: {
  title?: string;
  description?: string;
  entries: CatalogueEntry[];
  loading: boolean;
  search: string;
  installedNames: Set<string>;
  busyId: string | null;
  onSearchChange: (value: string) => void;
  onConfigure: (entry: CatalogueEntry) => void;
}) {
  return (
    <SettingsGroup
      title={title}
      description={description}
      actions={
        <StatusPill tone={loading ? "info" : "good"} variant="badge">
          {loading ? "searching" : `${entries.length} results`}
        </StatusPill>
      }
    >
      <SettingsRow
        label="Search MCPs"
        description="OAuth-managed rows show a Connect action. Local rows can be reviewed before adding."
        control={
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--ui-muted)" />
            <SettingsInput
              value={search}
              onChange={onSearchChange}
              placeholder="GitHub, Postgres, filesystem..."
              className="pl-8"
            />
          </div>
        }
      />
      {entries.map((entry) => (
        <CuratedMcpRow
          key={entry.id}
          entry={entry}
          added={installedNames.has(entry.name.toLowerCase())}
          busy={busyId === entry.id}
          onConfigure={() => onConfigure(entry)}
        />
      ))}
      {!entries.length && !loading ? (
        <EmptySafeNotice>No curated MCP matches. Try a broader search.</EmptySafeNotice>
      ) : null}
    </SettingsGroup>
  );
}
