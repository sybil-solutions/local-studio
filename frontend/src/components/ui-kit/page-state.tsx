// CRITICAL
import type { ReactNode } from "react";

type PageStateArgs<T> = {
  loading: boolean;
  data: T | null | undefined;
  hasData?: boolean;
  error?: string | null;
  onLoad?: () => void | Promise<void>;
};

/** Renders a compact shared loading / error / empty state, or null once data is ready. */
export function PageState<T>({
  loading,
  data,
  hasData,
  error,
  onLoad,
}: PageStateArgs<T>): ReactNode | null {
  if (loading && !data) return <StateShell title="Loading" body="Fetching the latest data." />;
  if (error) {
    return (
      <StateShell title="Could not load" body={error}>
        {onLoad ? (
          <button
            type="button"
            onClick={onLoad}
            className="border border-(--border) px-3 py-2 text-xs"
          >
            Retry
          </button>
        ) : null}
      </StateShell>
    );
  }
  if (hasData === false) return <StateShell title="No data" body="Nothing to show yet." />;
  return null;
}

function StateShell({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6 text-(--fg)">
      <div className="border border-(--border) bg-(--surface) p-5 font-mono">
        <div className="text-sm font-semibold uppercase tracking-[0.18em]">{title}</div>
        <div className="mt-2 max-w-xl text-sm text-(--dim)">{body}</div>
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    </div>
  );
}
