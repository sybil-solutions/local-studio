export function parseRelativeSince(value: string | null): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d+)([dhm])$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  const multiplier = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
  return new Date(Date.now() - amount * multiplier);
}

export function archiveQueryOptions(searchParams: URLSearchParams): {
  includeArchived?: boolean;
  archivedOnly?: boolean;
} {
  const archived = searchParams.get("archived")?.toLowerCase();
  const includeArchived = searchParams.get("includeArchived")?.toLowerCase();
  return {
    ...(includeArchived === "1" || includeArchived === "true" ? { includeArchived: true } : {}),
    ...(archived === "1" || archived === "true" || archived === "only"
      ? { archivedOnly: true, includeArchived: true }
      : {}),
  };
}
