import path from "node:path";
import { Schema } from "effect";
import { resolveProjectsFilePath } from "./data-dir";
import {
  decodeProjectsDocument,
  mergeProjectRecords,
  projectPathKey,
  stableDigest,
  writeOwnerFileAtomic,
  writeProjectsDocument,
  type ProjectsDocument,
} from "./projects-document";
import {
  ownerFileExists,
  readOwnerFile,
  readSourceFile,
  restrictOwnerFile,
  sourceFileExists,
  type OwnerFileSnapshot,
} from "./owner-files";
import { withProjectsFileTransaction } from "./projects-lock";

const MigrationMarkerSchema = Schema.Struct({
  version: Schema.Literal(1),
  legacyPath: Schema.String,
  sourceDigest: Schema.String,
  projectPathKeys: Schema.Array(Schema.String),
  canonicalBackup: Schema.NullOr(Schema.String),
  legacyBackup: Schema.String,
});

type MigrationMarker = typeof MigrationMarkerSchema.Type;

type RegistrySnapshot = {
  filePath: string;
  content: Buffer;
  digest: string;
  document: ProjectsDocument;
  projectPathKeys: readonly string[];
};

type MigrationPlan = {
  source: RegistrySnapshot;
  marker: MigrationMarker | null;
  additions: readonly RegistrySnapshot["document"]["projects"][number][];
};

type MigrationPaths = {
  canonicalFile: string;
  legacyFiles: readonly string[];
};

type LegacyMigrationPath = {
  canonicalFile: string;
  legacyFile: string;
};

export function resolveLegacyProjectsFilePath(cwd = process.cwd()): string {
  return path.resolve(cwd, "..", "data", "agentfs", "projects.json");
}

export function resolveLegacyProjectsFilePaths(
  cwd = process.cwd(),
  projectsFileOverride = process.env.LOCAL_STUDIO_PROJECTS_FILE,
): string[] {
  const override = projectsFileOverride?.trim();
  return [override ? path.resolve(cwd, override) : null, resolveLegacyProjectsFilePath(cwd)]
    .filter((filePath): filePath is string => filePath !== null)
    .filter((filePath, index, files) => files.indexOf(filePath) === index)
    .sort();
}

function migrationKey(legacyFile: string): string {
  return stableDigest(path.resolve(legacyFile)).slice(0, 16);
}

function markerPath(canonicalFile: string, legacyFile: string): string {
  return path.join(
    path.dirname(canonicalFile),
    `.projects-registry-${migrationKey(legacyFile)}.migrated.json`,
  );
}

function readMarker(filePath: string, legacyFile: string): MigrationMarker | null {
  if (!ownerFileExists(filePath)) return null;
  try {
    const marker = Schema.decodeUnknownSync(MigrationMarkerSchema)(
      JSON.parse(readOwnerFile(filePath).content.toString("utf8")),
    );
    if (marker.legacyPath !== path.resolve(legacyFile)) throw new Error();
    return marker;
  } catch {
    throw new Error(`Invalid projects migration marker: ${filePath}`);
  }
}

function snapshot(
  filePath: string,
  readFile: (filePath: string) => OwnerFileSnapshot = readOwnerFile,
): RegistrySnapshot {
  const content = readFile(filePath).content;
  const document = decodeProjectsDocument(content, filePath);
  return {
    filePath,
    content,
    digest: stableDigest(content),
    document,
    projectPathKeys: [...new Set(document.projects.map((project) => projectPathKey(project.path)))],
  };
}

function sourceSnapshot(filePath: string): RegistrySnapshot {
  return snapshot(filePath, readSourceFile);
}

function backupPath(
  canonicalFile: string,
  kind: "canonical" | "legacy",
  content: Uint8Array,
): string {
  return `${canonicalFile}.${kind}-${stableDigest(content)}.backup`;
}

function ensureBackup(
  canonicalFile: string,
  kind: "canonical" | "legacy",
  content: Uint8Array,
): string {
  const target = backupPath(canonicalFile, kind, content);
  const existing = ownerFileExists(target) ? readOwnerFile(target).content : null;
  if (!existing || stableDigest(existing) !== stableDigest(content)) {
    writeOwnerFileAtomic(target, content);
  } else {
    restrictOwnerFile(target);
  }
  return target;
}

function additionsFrom(
  source: RegistrySnapshot,
  marker: MigrationMarker | null,
): readonly RegistrySnapshot["document"]["projects"][number][] {
  if (!marker) return source.document.projects;
  if (marker.sourceDigest === source.digest) return [];
  const imported = new Set(marker.projectPathKeys);
  return source.document.projects.filter((project) => !imported.has(projectPathKey(project.path)));
}

function sameDocument(left: ProjectsDocument, right: ProjectsDocument): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function markerDocument(
  plan: MigrationPlan,
  canonicalBackup: string | null,
  legacyBackup: string,
): MigrationMarker {
  const projectPathKeys = [
    ...new Set([...(plan.marker?.projectPathKeys ?? []), ...plan.source.projectPathKeys]),
  ].sort();
  return {
    version: 1,
    legacyPath: plan.source.filePath,
    sourceDigest: plan.source.digest,
    projectPathKeys,
    canonicalBackup:
      (canonicalBackup ? path.basename(canonicalBackup) : plan.marker?.canonicalBackup) ?? null,
    legacyBackup: path.basename(legacyBackup),
  };
}

function writeMarkerIfChanged(
  canonicalFile: string,
  plan: MigrationPlan,
  marker: MigrationMarker,
): void {
  if (plan.marker && JSON.stringify(plan.marker) === JSON.stringify(marker)) return;
  writeOwnerFileAtomic(
    markerPath(canonicalFile, plan.source.filePath),
    `${JSON.stringify(marker, null, 2)}\n`,
  );
}

function sourceSnapshots(legacyFiles: readonly string[]): RegistrySnapshot[] {
  return [...new Set(legacyFiles.map((filePath) => path.resolve(filePath)))]
    .sort()
    .filter(sourceFileExists)
    .map(sourceSnapshot);
}

function migrateSnapshots(canonicalFile: string, snapshots: readonly RegistrySnapshot[]): void {
  const canonical = path.resolve(canonicalFile);
  const sources = snapshots
    .filter((source) => source.filePath !== canonical)
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
  if (sources.length === 0) return;
  withProjectsFileTransaction(canonical, () => {
    const canonicalExists = ownerFileExists(canonical);
    const canonicalSnapshot = canonicalExists ? snapshot(canonical) : null;
    const plans = sources.map((source): MigrationPlan => {
      const marker = readMarker(markerPath(canonical, source.filePath), source.filePath);
      return { source, marker, additions: additionsFrom(source, marker) };
    });
    if (canonicalExists) restrictOwnerFile(canonical);
    for (const plan of plans) {
      const marker = markerPath(canonical, plan.source.filePath);
      if (ownerFileExists(marker)) restrictOwnerFile(marker);
    }

    const currentDocument = canonicalSnapshot?.document ?? { projects: [] };
    const mergedDocument = {
      projects: mergeProjectRecords(currentDocument.projects, ...plans.map((plan) => plan.additions)),
    };
    const canonicalChanged = !canonicalSnapshot || !sameDocument(currentDocument, mergedDocument);
    const legacyBackups = plans.map((plan) =>
      ensureBackup(canonical, "legacy", plan.source.content),
    );
    const canonicalBackup =
      canonicalChanged && canonicalSnapshot
        ? ensureBackup(canonical, "canonical", canonicalSnapshot.content)
        : null;

    if (canonicalChanged) writeProjectsDocument(canonical, mergedDocument);
    plans.forEach((plan, index) => {
      const legacyBackup = legacyBackups[index];
      if (!legacyBackup)
        throw new Error(`Missing projects migration backup: ${plan.source.filePath}`);
      writeMarkerIfChanged(canonical, plan, markerDocument(plan, canonicalBackup, legacyBackup));
    });
  });
}

export function migrateProjectsRegistries({ canonicalFile, legacyFiles }: MigrationPaths): void {
  const canonical = path.resolve(canonicalFile);
  migrateSnapshots(
    canonical,
    sourceSnapshots(legacyFiles).filter((source) => source.filePath !== canonical),
  );
}

export function migrateProjectsRegistry({ canonicalFile, legacyFile }: LegacyMigrationPath): void {
  migrateProjectsRegistries({ canonicalFile, legacyFiles: [legacyFile] });
}

export function migrateLegacyProjectsRegistry(): void {
  const sources = sourceSnapshots(resolveLegacyProjectsFilePaths());
  const canonical = resolveProjectsFilePath();
  migrateSnapshots(
    canonical,
    sources.filter((source) => source.filePath !== canonical),
  );
}
