"use client";

import { useCallback, useMemo, useState } from "react";
import { Effect, Schema } from "effect";
import { Button, SearchInput } from "@/ui";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import {
  ModelRow,
  ModelSection,
  ModelStatus,
  ModelValue,
} from "@/features/recipes/recipes-content/model-page";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

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

const requestSkills = <T,>(url: string, schema: Schema.ConstraintDecoder<T>) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error("Skill discovery failed");
      return Schema.decodeUnknownSync(schema)(body);
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });

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
        <ModelStatus tone={error ? "danger" : loading ? "info" : "good"}>SKILL.md</ModelStatus>
      }
      status={`${skill.source} · ${skill.path}`}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard
                .writeText(skill.path)
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
  const [skills, setSkills] = useState<readonly Skill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Skill | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  const loadSkills = useCallback(() => {
    void Effect.runPromise(requestSkills("/api/agent/skills", SkillsResponseSchema))
      .then((payload) => {
        setSkills(payload.skills);
        setError("");
      })
      .catch((loadError: unknown) => {
        setSkills([]);
        setError(loadError instanceof Error ? loadError.message : "Skill discovery failed");
      })
      .finally(() => setLoaded(true));
  }, []);

  useMountSubscription(() => {
    loadSkills();
  }, [loadSkills]);

  const visibleSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return skills;
    return skills.filter((skill) =>
      `${skill.name} ${skill.source} ${skill.path}`.toLowerCase().includes(normalized),
    );
  }, [query, skills]);

  const openSkill = (skill: Skill) => {
    setSelected(skill);
    setSelectedSkill(null);
    setDetailLoading(true);
    setError("");
    void Effect.runPromise(
      requestSkills(
        `/api/agent/skills/load?path=${encodeURIComponent(skill.path)}`,
        SkillResponseSchema,
      ),
    )
      .then((payload) => setSelectedSkill(payload.skill))
      .catch((loadError: unknown) =>
        setError(loadError instanceof Error ? loadError.message : "Skill loading failed"),
      )
      .finally(() => setDetailLoading(false));
  };

  return (
    <>
      <ModelSection
        title="Skills"
        description="Reusable instruction sets discovered across Local Studio, Codex, Claude, Pi, Factory, and OpenCode."
        actions={
          <ModelStatus tone={error ? "warning" : loaded ? "good" : "default"}>
            {loaded ? `${visibleSkills.length} of ${skills.length}` : "discovering"}
          </ModelStatus>
        }
      >
        <ModelRow
          label="Search skills"
          description="Name, source, company, or path."
          control={
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search skills"
              className="w-full"
            />
          }
          status={<ModelStatus>{visibleSkills.length}</ModelStatus>}
        />
        {visibleSkills.map((skill) => (
          <ModelRow
            key={skill.id}
            label={skill.name}
            description={`Available in Workbench · ${skill.source}`}
            leading={<ResourceLogo identity={skill.source} label={skill.name} />}
            value={<ModelValue mono>{skill.path}</ModelValue>}
            status={<ModelStatus tone="info">discovered</ModelStatus>}
            onClick={() => openSkill(skill)}
          />
        ))}
        {loaded && visibleSkills.length === 0 ? (
          <div className="px-4 py-8 text-center text-[length:var(--fs-md)] text-(--ui-muted)">
            {skills.length ? `No skills match “${query}”.` : "No SKILL.md entries were found."}
          </div>
        ) : null}
      </ModelSection>
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
