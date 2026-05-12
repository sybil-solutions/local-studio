import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RefreshButton } from "./refresh-button";

describe("RefreshButton", () => {
  it("renders shared refresh affordance", () => {
    const html = renderToStaticMarkup(createElement(RefreshButton, { onRefresh: () => {} }));
    expect(html).toContain("Refresh");
    expect(html).toContain('type="button"');
  });

  it("marks busy and disables while loading", () => {
    const html = renderToStaticMarkup(
      createElement(RefreshButton, { onRefresh: () => {}, loading: true }),
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
    expect(html).toContain("Refreshing");
  });
});
