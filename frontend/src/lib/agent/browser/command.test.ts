import { describe, expect, it, vi } from "vitest";
import { runBrowserPanelCommand, type BrowserCommandDeps } from "./command";

function deps(overrides: Partial<BrowserCommandDeps> = {}): BrowserCommandDeps {
  return {
    browser: null,
    currentUrl: "https://current.example",
    setBrowserUrl: vi.fn(),
    isElectron: false,
    ...overrides,
  };
}

describe("runBrowserPanelCommand", () => {
  it("returns the known URL when the browser panel is not mounted", async () => {
    await expect(runBrowserPanelCommand("get-url", {}, deps())).resolves.toEqual({
      ok: true,
      data: { url: "https://current.example", title: "" },
    });
  });

  it("navigates the iframe fallback for public urls", async () => {
    const iframe = { src: "about:blank" } as HTMLIFrameElement;
    const setBrowserUrl = vi.fn();

    await expect(
      runBrowserPanelCommand(
        "navigate",
        { url: "https://example.com/docs" },
        deps({ browser: { iframe, webview: null }, setBrowserUrl }),
      ),
    ).resolves.toEqual({ ok: true, data: { url: "https://example.com/docs" } });
    expect(iframe.src).toBe("https://example.com/docs");
    expect(setBrowserUrl).toHaveBeenCalledWith(
      "https://example.com/docs",
      "https://example.com/docs",
    );
  });

  it("rejects unsafe urls before mutating iframe state", async () => {
    const iframe = { src: "about:blank" } as HTMLIFrameElement;
    const setBrowserUrl = vi.fn();

    const result = await runBrowserPanelCommand(
      "navigate",
      { url: "file:///etc/passwd" },
      deps({ browser: { iframe, webview: null }, setBrowserUrl }),
    );

    expect(result).toEqual({ ok: false, error: "valid public http(s) url required" });
    expect(iframe.src).toBe("about:blank");
    expect(setBrowserUrl).not.toHaveBeenCalled();
  });

  it("executes desktop webview reads and flags bot protection", async () => {
    const webview = {
      executeJavaScript: vi.fn().mockResolvedValue("captcha not a robot"),
      loadURL: vi.fn(),
      getURL: vi.fn().mockReturnValue("https://example.com"),
      getTitle: vi.fn().mockReturnValue("Example"),
      capturePage: vi.fn(),
    };

    const result = await runBrowserPanelCommand(
      "get-text",
      {},
      deps({ browser: { webview, iframe: null }, isElectron: true }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Bot-protection page detected");
  });
});
