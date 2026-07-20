import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type DownloadTargetReservation = {
  readonly key: string;
  readonly target: string;
  readonly downloadId: string;
  readonly owner: symbol;
};

type DownloadTargetReservationsOptions = {
  readonly caseInsensitive?: boolean;
  readonly unicodeNormalization?: CanonicalNormalization;
};

type CanonicalNormalization = "NFC" | "NFD";

const defaultCaseInsensitive = process.platform === "darwin" || process.platform === "win32";
const defaultUnicodeNormalization: CanonicalNormalization | null =
  process.platform === "darwin" ? "NFD" : null;

const physicalPath = (target: string): string | null => {
  try {
    return realpathSync(target);
  } catch {
    return null;
  }
};

const resolvePhysicalTarget = (target: string): string => {
  const resolved = resolve(target);
  const missingSegments: string[] = [];
  let candidate = resolved;
  while (true) {
    const physical = physicalPath(candidate);
    if (physical) return resolve(physical, ...missingSegments.reverse());
    const parent = dirname(candidate);
    if (parent === candidate) return resolved;
    missingSegments.push(basename(candidate));
    candidate = parent;
  }
};

const canonicalTargetKey = (
  target: string,
  caseInsensitive: boolean,
  unicodeNormalization: CanonicalNormalization | null,
): string => {
  const physical = resolvePhysicalTarget(target);
  const normalized = unicodeNormalization ? physical.normalize(unicodeNormalization) : physical;
  return caseInsensitive ? normalized.toLowerCase() : normalized;
};

const containsTarget = (parent: string, candidate: string): boolean => {
  const nested = relative(parent, candidate);
  return (
    nested === "" || (nested !== ".." && !nested.startsWith(`..${sep}`) && !isAbsolute(nested))
  );
};

const targetsOverlap = (left: string, right: string): boolean =>
  containsTarget(left, right) || containsTarget(right, left);

export class DownloadTargetConflict extends Error {
  public constructor(
    public readonly activeDownloadId: string,
    public readonly target: string,
  ) {
    super(`Download target "${target}" is reserved by active download ${activeDownloadId}`);
    this.name = "DownloadTargetConflict";
  }
}

export class DownloadTargetReservations {
  private readonly reservations = new Map<string, DownloadTargetReservation>();
  private readonly caseInsensitive: boolean;
  private readonly unicodeNormalization: CanonicalNormalization | null;

  public constructor(options: DownloadTargetReservationsOptions = {}) {
    this.caseInsensitive = options.caseInsensitive ?? defaultCaseInsensitive;
    this.unicodeNormalization = options.unicodeNormalization ?? defaultUnicodeNormalization;
  }

  public acquire(target: string, downloadId: string): DownloadTargetReservation {
    const resolvedTarget = resolve(target);
    const key = canonicalTargetKey(resolvedTarget, this.caseInsensitive, this.unicodeNormalization);
    const active = [...this.reservations.values()].find((reservation) =>
      targetsOverlap(reservation.key, key),
    );
    if (active) throw new DownloadTargetConflict(active.downloadId, active.target);
    const reservation = {
      key,
      target: resolvedTarget,
      downloadId,
      owner: Symbol(downloadId),
    };
    this.reservations.set(key, reservation);
    return reservation;
  }

  public release(reservation: DownloadTargetReservation): void {
    const active = this.reservations.get(reservation.key);
    if (active?.owner === reservation.owner) this.reservations.delete(reservation.key);
  }
}
