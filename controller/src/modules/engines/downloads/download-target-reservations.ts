import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type DownloadTargetReservation = {
  readonly key: string;
  readonly target: string;
  readonly downloadId: string;
  readonly owner: symbol;
};

type ReservationOptions = {
  readonly caseInsensitive?: boolean;
  readonly unicodeNormalization?: "NFC" | "NFD" | null;
};

const physicalTarget = (target: string): string => {
  const missing: string[] = [];
  let candidate = resolve(target);
  while (true) {
    try {
      return resolve(realpathSync(candidate), ...missing.reverse());
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) return resolve(target);
      missing.push(basename(candidate));
      candidate = parent;
    }
  }
};

const contains = (parent: string, candidate: string): boolean => {
  const nested = relative(parent, candidate);
  return (
    nested === "" || (nested !== ".." && !nested.startsWith(`..${sep}`) && !isAbsolute(nested))
  );
};

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
  private readonly normalization: "NFC" | "NFD" | null;

  public constructor(options: ReservationOptions = {}) {
    this.caseInsensitive =
      options.caseInsensitive ?? (process.platform === "darwin" || process.platform === "win32");
    this.normalization =
      options.unicodeNormalization === undefined
        ? process.platform === "darwin"
          ? "NFD"
          : null
        : options.unicodeNormalization;
  }

  public acquire(target: string, downloadId: string): DownloadTargetReservation {
    const resolved = resolve(target);
    const physical = physicalTarget(resolved);
    const normalized = this.normalization ? physical.normalize(this.normalization) : physical;
    const key = this.caseInsensitive ? normalized.toLowerCase() : normalized;
    const active = [...this.reservations.values()].find(
      (reservation) => contains(reservation.key, key) || contains(key, reservation.key),
    );
    if (active) throw new DownloadTargetConflict(active.downloadId, active.target);
    const reservation = { key, target: resolved, downloadId, owner: Symbol(downloadId) };
    this.reservations.set(key, reservation);
    return reservation;
  }

  public release(reservation: DownloadTargetReservation): void {
    if (this.reservations.get(reservation.key)?.owner === reservation.owner) {
      this.reservations.delete(reservation.key);
    }
  }
}
