"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import { Button, StatusPill } from "@/ui";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import {
  DataRow,
  EndCell,
  HeadCell,
  IdentityCell,
  StatusText,
  TableFrame,
  TableNotice,
  TableSection,
  TextCell,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import {
  CatalogSectionHeader,
  useCatalogSection,
} from "@/features/recipes/recipes-content/catalog-section";
import { writeClipboardText } from "@/lib/clipboard";
import { requestAgentJson } from "./agent-json";

const SkillSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  source: Schema.String,
  path: Schema.String,
  instructions: Schema.optional(Schema.String),
});

const SkillsResponseSchema = Schema.Struct({
  skills: Schema.Array(SkillSchema),
});

const SkillResponseSchema = Schema.Struct({
  skill: SkillSchema,
});

type Skill = Schema.Schema.Type<typeof SkillSchema>;

const decodeSkills = Schema.decodeUnknownSync(SkillsResponseSchema);
const decodeSkill = Schema.decodeUnknownSync(SkillResponseSchema);

function SkillDrawer({
  skill,
  loaded,
  loading,
  error,
  onClose,
}: {
  skill: Skill;
  loaded: Skill | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <ResourceDrawer
      title={skill.name}
      icon={<ResourceLogo identity={skill.source} label={skill.name} />}
      badge={
        <StatusPill tone={error ? "danger" : loading ? "info" : "good"} variant="dot">
          SKILL.md
        </StatusPill>
      }
      status={`${skill.source} · ${skill.path}`}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              void writeClipboardText(skill.path)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? "Copied" : "Copy path"}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
      onClose={onClose}
    >
      <section className="mb-6">
        <div className="mb-2">
          <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">Instructions</h3>
          <p className="mt-0.5 text-[length:var(--fs-sm)] text-(--ui-muted)">
            The instruction file loaded when this skill is selected in Workbench.
          </p>
        </div>
        <div className="max-h-[52dvh] overflow-auto rounded-md border border-(--ui-separator) bg-(--color-input) p-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-[length:var(--fs-sm)] leading-5 text-(--ui-fg)/90">
            {loading
              ? "Loading SKILL.md…"
              : error || loaded?.instructions || "No instructions found."}
          </pre>
        </div>
      </section>
      <ResourceDrawerSection title="Identity">
        <ResourceFact label="Source" value={skill.source} />
        <ResourceFact label="Skill ID" value={skill.id} mono />
        <ResourceFact label="Directory" value={skill.path} mono />
      </ResourceDrawerSection>
    </ResourceDrawer>
  );
}

export function SkillsSection() {
  const [selected, setSelected] = useState<Skill | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(
    () => requestAgentJson("/api/agent/skills", decodeSkills).then((payload) => payload.skills),
    [],
  );
  const section = useCatalogSection({
    load,
    searchText: (skill: Skill) => `${skill.name} ${skill.source} ${skill.path}`,
  });
  const { items: skills, visible: visibleSkills, loaded, error, setError, query } = section;

  const openSkill = (skill: Skill) => {
    setSelected(skill);
    setSelectedSkill(null);
    setDetailLoading(true);
    setError("");
    void requestAgentJson(
      `/api/agent/skills/load?path=${encodeURIComponent(skill.path)}`,
      decodeSkill,
    )
      .then((payload) => setSelectedSkill(payload.skill))
      .catch((loadError: unknown) =>
        setError(loadError instanceof Error ? loadError.message : "Skill loading failed"),
      )
      .finally(() => setDetailLoading(false));
  };

  return (
    <>
      <TableSection
        title="Skills"
        description="Reusable instruction sets discovered across Local Studio, Codex, Claude, Pi, Factory, and OpenCode."
        actions={
          <CatalogSectionHeader
            section={section}
            searchPlaceholder="Search skills"
            statusTone={error ? "warn" : loaded ? "ok" : "dim"}
            statusText={loaded ? `${visibleSkills.length} of ${skills.length}` : "discovering"}
            refreshLabel="Rediscover skills"
          />
        }
      >
        {loaded && visibleSkills.length === 0 ? (
          <TableNotice
            title={skills.length ? `No skill matches “${query}”` : "No skills found"}
            body="A skill is a SKILL.md file discovered under one of the agent tools on this machine. Install one, or clear the search."
          />
        ) : (
          <TableFrame minWidthClass="min-w-[38rem]">
            <thead>
              <tr>
                <HeadCell>Skill</HeadCell>
                <HeadCell>Directory</HeadCell>
                <HeadCell numeric>State</HeadCell>
              </tr>
            </thead>
            <tbody>
              {visibleSkills.map((skill) => (
                <DataRow
                  key={skill.id}
                  onOpen={() => openSkill(skill)}
                  ariaLabel={`Open ${skill.name}`}
                >
                  <IdentityCell
                    leading={<ResourceLogo identity={skill.source} label={skill.name} />}
                    label={skill.name}
                    description={`Available in Workbench · ${skill.source}`}
                  />
                  <TextCell mono>{skill.path}</TextCell>
                  <EndCell>
                    <StatusText tone="info">discovered</StatusText>
                  </EndCell>
                </DataRow>
              ))}
            </tbody>
          </TableFrame>
        )}
      </TableSection>
      {selected ? (
        <SkillDrawer
          skill={selected}
          loaded={selectedSkill}
          loading={detailLoading}
          error={error}
          onClose={() => {
            setSelected(null);
            setSelectedSkill(null);
            setError("");
          }}
        />
      ) : null}
    </>
  );
}
