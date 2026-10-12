export default function Loading() {
  return (
    <div className="flex h-full min-h-50 items-center justify-center bg-background">
      <span className="text-[length:var(--fs-lg)] text-(--dim) animate-pulse">Loading…</span>
    </div>
  );
}
