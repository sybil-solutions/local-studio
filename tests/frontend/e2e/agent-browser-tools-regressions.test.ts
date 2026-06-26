import assert from "node:assert/strict";
import test from "node:test";
import { runBrowserPanelCommand } from "@/features/agent/browser/command";
import { normalizeBrowserInput } from "@/features/agent/tools/browser-url";
import { parseArgsText } from "@/features/plugins/plugins-utils";

declare global {
  var __LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST:
    | ((
        hostname: string,
      ) => Promise<(string | { address: string; family: 4 | 6 })[]>)
    | undefined;
  var __LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST:
    | ((
        url: string,
        address: { address: string; family: 4 | 6 },
      ) => Promise<{
        status: number;
        ok: boolean;
        url: string;
        contentType: string;
        body: string;
        location?: string;
      }>)
    | undefined;
}

test("browser navigate primes the URL while the browser surface is mounting", async () => {
  let browserUrl = "";
  let browserInput = "";

  const result = await runBrowserPanelCommand(
    "navigate",
    { url: "https://example.com/docs" },
    {
      browser: null,
      currentUrl: "",
      isElectron: true,
      setBrowserUrl: (url, input) => {
        browserUrl = url;
        browserInput = input ?? "";
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(browserUrl, "https://example.com/docs");
  assert.equal(browserInput, "https://example.com/docs");
  assert.equal((result.data as { pending?: boolean }).pending, true);
});

test("browser navigate opens the agent's own localhost dev servers but not the LAN", async () => {
  const navigate = (url: string) =>
    runBrowserPanelCommand(
      "navigate",
      { url },
      { browser: null, currentUrl: "", isElectron: true, setBrowserUrl: () => undefined },
    );

  // The pane exists to preview dev servers the agent just started — loopback
  // must work, or "build the app and open it" is dead on arrival.
  assert.equal((await navigate("http://localhost:8765/index.html")).ok, true);
  assert.equal((await navigate("http://127.0.0.1:3005")).ok, true);

  // Other private/LAN hosts stay blocked — the agent drives this browser; don't
  // hand it the local network.
  assert.equal((await navigate("http://192.168.1.50:8080")).ok, false);
  assert.equal((await navigate("http://10.0.0.5")).ok, false);
});

test("free-text browser searches avoid Google webview refresh loops", () => {
  assert.equal(
    normalizeBrowserInput("latest vllm docs", "/workspace/project"),
    "https://duckduckgo.com/?q=latest%20vllm%20docs",
  );
});

test("desktop browser reader fetch renders public markdown and rejects private urls", async () => {
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  let requestCount = 0;
  const connectedAddresses: string[] = [];
  process.env.LOCAL_STUDIO_DATA_DIR = "/tmp/local-studio-desktop-test";
  globalThis.__LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST = async (
    hostname,
  ) =>
    hostname === "private-dns.test"
      ? ["127.0.0.1"]
      : hostname === "mapped-private.test"
        ? ["::ffff:127.0.0.1"]
        : ["93.184.216.34"];
  globalThis.__LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST = async (
    url,
    address,
  ) => {
    requestCount += 1;
    connectedAddresses.push(address.address);
    if (url.includes("redirect.test")) {
      return {
        status: 302,
        ok: false,
        url,
        contentType: "",
        body: "",
        location: "http://localhost:3000/private",
      };
    }
    if (url.includes("html.test")) {
      return {
        status: 200,
        ok: true,
        url,
        contentType: "text/html; charset=utf-8",
        body: "<html><head><title>HTML Works</title><script>bad()</script></head><body><h1>Hello</h1><p>World</p></body></html>",
      };
    }
    return {
      status: 200,
      ok: true,
      url,
      contentType: "text/markdown; charset=utf-8",
      body: "# Reader Works\n\n[Docs](/docs)\n",
    };
  };
  try {
    const { GET } = await import("@/app/api/agent/browser/fetch/route");
    const response = await GET({
      nextUrl: new URL(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fexample.com%2F",
      ),
    } as never);
    const body = (await response.json()) as {
      markdown?: string;
      title?: string;
    };
    assert.equal(response.status, 200);
    assert.equal(body.title, "Reader Works");
    assert.match(body.markdown ?? "", /Reader Works/);

    const htmlResponse = await GET({
      nextUrl: new URL(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fhtml.test%2F",
      ),
    } as never);
    const htmlBody = (await htmlResponse.json()) as {
      text?: string;
      title?: string;
    };
    assert.equal(htmlResponse.status, 200);
    assert.equal(htmlBody.title, "HTML Works");
    assert.match(htmlBody.text ?? "", /Hello/);
    assert.doesNotMatch(htmlBody.text ?? "", /bad\(\)/);

    const rejected = await GET({
      nextUrl: new URL(
        "http://localhost/api/agent/browser/fetch?url=http%3A%2F%2Flocalhost%3A3000%2F",
      ),
    } as never);
    const rejectedBody = (await rejected.json()) as { error?: string };
    assert.equal(rejected.status, 400);
    assert.match(rejectedBody.error ?? "", /public http\/https/);

    const redirectRejected = await GET({
      nextUrl: new URL(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fredirect.test%2F",
      ),
    } as never);
    const redirectBody = (await redirectRejected.json()) as { error?: string };
    assert.equal(redirectRejected.status, 502);
    assert.match(redirectBody.error ?? "", /Redirect rejected/);

    const dnsRejected = await GET({
      nextUrl: new URL(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fprivate-dns.test%2F",
      ),
    } as never);
    const dnsBody = (await dnsRejected.json()) as { error?: string };
    assert.equal(dnsRejected.status, 502);
    assert.match(dnsBody.error ?? "", /Resolved host rejected/);

    const mappedDnsRejected = await GET({
      nextUrl: new URL(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fmapped-private.test%2F",
      ),
    } as never);
    const mappedDnsBody = (await mappedDnsRejected.json()) as {
      error?: string;
    };
    assert.equal(mappedDnsRejected.status, 502);
    assert.match(mappedDnsBody.error ?? "", /Resolved host rejected/);
    assert.equal(requestCount, 3);
    assert.deepEqual(connectedAddresses, [
      "93.184.216.34",
      "93.184.216.34",
      "93.184.216.34",
    ]);
  } finally {
    delete globalThis.__LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST;
    delete globalThis.__LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST;
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
  }
});

test("curated local MCP servers require explicit target args", async () => {
  const { handleMcpAction } = await import("@/features/agent/mcp/service");
  const missing = handleMcpAction({
    action: "add_from_catalogue",
    catalogueId: "catalogue:filesystem",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
  });

  assert.equal(missing.status, 400);
  assert.match(String(missing.payload.error), /requires a local path/);

  const flagOnly = handleMcpAction({
    action: "add_from_catalogue",
    catalogueId: "catalogue:git",
    args: ["-y", "@modelcontextprotocol/server-git", "--readonly"],
  });

  assert.equal(flagOnly.status, 400);
  assert.match(String(flagOnly.payload.error), /requires a local path/);

  const replacedPackage = handleMcpAction({
    action: "add_from_catalogue",
    catalogueId: "catalogue:filesystem",
    args: ["-y", "malicious-package", "/tmp"],
  });

  assert.equal(replacedPackage.status, 400);
  assert.match(String(replacedPackage.payload.error), /reviewed prefix/);

  const urlTarget = handleMcpAction({
    action: "add_from_catalogue",
    catalogueId: "catalogue:filesystem",
    args: [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "https://evil.example",
    ],
  });

  assert.equal(urlTarget.status, 400);
  assert.match(String(urlTarget.payload.error), /requires a local path/);

  const mixedUrlTarget = handleMcpAction({
    action: "add_from_catalogue",
    catalogueId: "catalogue:filesystem",
    args: [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/tmp",
      "https://evil.example",
    ],
  });

  assert.equal(mixedUrlTarget.status, 400);
  assert.match(String(mixedUrlTarget.payload.error), /requires a local path/);

  const mixedPlainTarget = handleMcpAction({
    action: "add_from_catalogue",
    catalogueId: "catalogue:filesystem",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp", "docs"],
  });

  assert.equal(mixedPlainTarget.status, 400);
  assert.match(String(mixedPlainTarget.payload.error), /requires a local path/);
  assert.deepEqual(
    parseArgsText(
      '-y @modelcontextprotocol/server-filesystem "/Users/sero/My Project"',
    ),
    ["-y", "@modelcontextprotocol/server-filesystem", "/Users/sero/My Project"],
  );
});
