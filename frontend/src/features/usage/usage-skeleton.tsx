import { AppPage, PageContainer } from "@/ui";
import { TableSkeleton } from "@/features/recipes/recipes-content/catalog-table-shell";

const pulse = "animate-pulse rounded bg-(--ui-surface-2)";

const MODEL_COLUMNS = [
  "Model",
  "Requests",
  "Tokens",
  "Avg/req",
  "Prefill",
  "Decode",
  "TTFT",
  "Latency",
  "Success",
] as const;

/**
 * The loading state is the loaded page with the ink removed.
 *
 * Profile header, headline number, the six-cell grid, tab bar, tab heading,
 * then the Models table with its nine real column labels — every band lands at
 * the height it will occupy once the data arrives, so nothing on the page moves
 * when it does.
 */
export function UsageSkeleton() {
  return (
    <AppPage>
      <PageContainer width="sm" className="pt-5 sm:pt-7">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`${pulse} h-[38px] w-[38px] shrink-0 rounded-full`} />
            <div>
              <div className={`${pulse} h-3.5 w-14`} />
              <div className={`${pulse} mt-1.5 h-5 w-32`} />
            </div>
          </div>
          <div className={`${pulse} h-7 w-7 rounded-md`} />
        </div>

        <div className="mt-8">
          <div className={`${pulse} h-3.5 w-28`} />
          <div className={`${pulse} mt-2 h-12 w-56`} />
          <div className={`${pulse} mt-3 h-3.5 w-72 max-w-full`} />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--rad-xl)] bg-(--ui-border) sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="bg-(--ui-surface) px-3 py-2.5 sm:px-4">
              <div className={`${pulse} h-5 w-16`} />
              <div className={`${pulse} mt-1.5 h-3.5 w-20`} />
            </div>
          ))}
        </div>

        <div className="mt-8 flex gap-1 border-b border-(--ui-separator)">
          {[64, 68, 84, 60].map((width) => (
            <div key={width} className="px-4 py-2">
              <div className={`${pulse} h-4`} style={{ width }} />
            </div>
          ))}
        </div>

        <div className="mt-8">
          <div className={`${pulse} h-6 w-40`} />
          <div className={`${pulse} mt-2 h-3.5 w-[36rem] max-w-full`} />

          <div className="mt-6">
            <TableSkeleton columns={MODEL_COLUMNS} rows={7} minWidthClass="min-w-[64rem]" />
          </div>
        </div>
      </PageContainer>
    </AppPage>
  );
}
