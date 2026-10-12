import { MarkdownContent } from "@/ui/markdown-content";

export type ReadablePage = {
  url: string;
  title: string;
  text: string;
  markdown?: string;
  contentType?: string;
};

function resolveBrowserHref(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

export function ReadingView({
  url,
  page,
  error,
  loading,
  onLinkClick,
}: {
  url: string;
  page: ReadablePage | null;
  error: string | null;
  loading: boolean;
  onLinkClick: (url: string) => void;
}) {
  if (loading && !page) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-(--dim)">Loading…</div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-(--dim)">
        <span className="font-medium text-(--err)">Could not read {url}</span>
        <span>{error}</span>
      </div>
    );
  }
  if (!page) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-(--dim)">
        Enter a URL to read.
      </div>
    );
  }
  return (
    <div className="size-full overflow-y-auto bg-(--bg) px-4 py-3 text-sm leading-6 text-(--fg)">
      <div className="mx-auto max-w-3xl">
        <div className="text-xs text-(--dim)">{page.url}</div>
        <h1 className="mt-1 text-base font-semibold tracking-tight text-(--fg)">{page.title}</h1>
        <MarkdownContent
          markdown={page.markdown ?? page.text}
          className="mt-3 text-[length:var(--fs-base)] text-(--fg)"
          components={{
            a: ({ children, href }) => (
              <button
                type="button"
                onClick={() => onLinkClick(resolveBrowserHref(href ?? "", page.url))}
                className="text-(--accent) underline-offset-2 hover:underline"
                title={href}
              >
                {children}
              </button>
            ),
          }}
        />
      </div>
    </div>
  );
}
