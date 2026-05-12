import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageState } from "./page-state";

describe("PageState", () => {
  it("renders loading state until data exists", () => {
    const html = renderToStaticMarkup(
      createElement(() => PageState({ loading: true, data: null })),
    );
    expect(html).toContain("Loading");
    expect(html).toContain("Fetching the latest data.");
  });

  it("renders error state with retry action", () => {
    const html = renderToStaticMarkup(
      createElement(() =>
        PageState({ loading: false, data: null, error: "boom", onLoad: () => {} }),
      ),
    );
    expect(html).toContain("Could not load");
    expect(html).toContain("boom");
    expect(html).toContain("Retry");
  });

  it("returns null once usable data is present", () => {
    expect(PageState({ loading: false, data: { ok: true }, hasData: true })).toBeNull();
  });
});
