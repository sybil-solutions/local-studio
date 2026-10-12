/**
 * The waiting state, shaped like the page it stands in for.
 *
 * Configure used to show a centred pulsing "Loading…" — a layout that appears
 * nowhere else in the app, so the first thing every visit did was throw the
 * whole frame away and rebuild it somewhere else. These blocks sit where the
 * section rail, the pool summary and the first machine card land, and both the
 * route's `loading.tsx` and the search-params Suspense boundary render the same
 * one so the shape never changes between them.
 */

/** One machine, before its facts arrive. */
export function MachineCardSkeleton() {
  return (
    <div className="rounded-[var(--rad-lg)] border border-(--ui-border) bg-(--ui-surface) p-3 sm:p-4">
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="h-16 w-24 shrink-0 animate-pulse rounded-[var(--rad-md)] bg-(--ui-hover)" />
        <div className="min-w-0 flex-1 space-y-2 pt-1">
          <div className="h-4 w-40 animate-pulse rounded bg-(--ui-hover)" />
          <div className="h-3 w-64 max-w-full animate-pulse rounded bg-(--ui-hover)/70" />
        </div>
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-(--ui-separator) pt-2.5">
        <div className="h-3.5 w-56 max-w-full animate-pulse rounded bg-(--ui-hover)" />
        <div className="h-3 w-32 animate-pulse rounded bg-(--ui-hover)/70" />
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-x-2 gap-y-3 border-t border-(--ui-separator) pt-2.5">
        {[0, 1, 2].map((cell) => (
          <div key={cell} className="space-y-1.5 px-3 first:pl-0">
            <div className="h-2.5 w-16 animate-pulse rounded bg-(--ui-hover)/70" />
            <div className="h-3.5 w-20 animate-pulse rounded bg-(--ui-hover)" />
          </div>
        ))}
      </div>
    </div>
  );
}

