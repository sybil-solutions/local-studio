import { expect, test } from "@playwright/test";

import { routePaths } from "../../src/domain/route";

const pages = routePaths;

test("robots.txt is plain text with crawl rules, AI bots, sitemap, and content signals", async ({
	request,
}) => {
	const response = await request.get("/robots.txt");
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toMatch(/text\/plain/);
	const body = await response.text();
	expect(body).toContain("User-agent: *");
	expect(body).toContain("Allow: /");
	expect(body).toContain(
		"Content-Signal: search=yes, ai-input=yes, ai-train=yes",
	);
	expect(body).toContain("User-agent: GPTBot");
	expect(body).toContain("User-agent: OAI-SearchBot");
	expect(body).toContain("User-agent: Claude-Web");
	expect(body).toContain("User-agent: Google-Extended");
	expect(body).toContain("User-agent: Amazonbot");
	expect(body).toContain("User-agent: anthropic-ai");
	expect(body).toContain("User-agent: Bytespider");
	expect(body).toContain("User-agent: CCBot");
	expect(body).toContain("User-agent: Applebot-Extended");
	expect(body).toContain("Sitemap: https://localstudio.ai/sitemap.xml");
});

test("sitemap.xml lists canonical HTML routes", async ({ request }) => {
	const response = await request.get("/sitemap.xml");
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toMatch(/xml/);
	const body = await response.text();
	expect(body).toContain("<urlset");
	for (const path of pages) {
		const loc =
			path === "/"
				? "https://localstudio.ai/"
				: `https://localstudio.ai${path}`;
		expect(body).toContain(`<loc>${loc}</loc>`);
	}
});

test("homepage sends RFC 8288 Link headers for agent discovery", async ({
	request,
}) => {
	const response = await request.get("/");
	expect(response.status()).toBe(200);
	const link = response.headers().link ?? "";
	expect(link).toContain('rel="api-catalog"');
	expect(link).toContain("/.well-known/api-catalog");
	expect(link).toContain('rel="describedby"');
	expect(link).toContain("/llms.txt");
	expect(link).toContain('rel="service-doc"');
	expect(link).toContain("/docs");
});

test("Accept text/markdown returns markdown for HTML routes", async ({
	request,
}) => {
	for (const path of pages) {
		const response = await request.get(path, {
			headers: { Accept: "text/markdown" },
		});
		expect(response.status(), path).toBe(200);
		expect(response.headers()["content-type"], path).toMatch(/text\/markdown/);
		expect(response.headers()["x-markdown-tokens"], path).toMatch(/^[1-9]\d*$/);
		const body = await response.text();
		expect(body.length, path).toBeGreaterThan(80);
		expect(body, path).toContain("Sybil Solutions");
	}
});

test("markdown twins and discovery files are served as markdown or catalog types", async ({
	request,
}) => {
	const markdown = await request.get("/llms.txt");
	expect(markdown.status()).toBe(200);
	expect(markdown.headers()["content-type"]).toMatch(/text\/markdown/);
	const llms = await markdown.text();
	expect(llms).toContain("Local Studio");
	expect(llms).toContain("T3 Code");
	expect(llms).toContain("Codex Shim");

	const catalog = await request.get("/.well-known/api-catalog");
	expect(catalog.status()).toBe(200);
	expect(catalog.headers()["content-type"]).toMatch(/linkset\+json/);
	expect(await catalog.text()).toContain("https://localstudio.ai/");

	const card = await request.get("/.well-known/agent-card.json");
	expect(card.status()).toBe(200);
	expect(await card.text()).toContain("Sybil Solutions");
});

test("machine page names the company, products, and upstream", async ({
	page,
}) => {
	await page.goto("/machine");
	const text = await page.locator("[data-page-focus]").innerText();
	expect(text).toContain("Sybil Solutions");
	expect(text).toContain("Local Studio");
	expect(text).toContain("T3 Code");
	expect(text).toContain("Codex Shim");
	expect(text).toContain("https://www.sybilsolutions.ai/");
	expect(text).toContain("https://github.com/sybil-solutions/local-studio");
	expect(text).toContain("https://github.com/pingdotgg/t3code");
	expect(text).toContain("Tailscale");
	expect(text).toContain("vLLM");
});


test("raw homepage is useful without JavaScript and links developer resources", async ({
	request,
}) => {
	const response = await request.get("/");
	const html = await response.text();
	const body = html.match(/<body>([\s\S]+?)<\/body>/)?.[1] ?? "";
	const text = body
		.replace(/<(script|style|template)[^>]*>[\s\S]*?<\/\1>/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	expect(body).toContain("<h1");
	expect(text.length).toBeGreaterThan(500);
	expect(body).toContain('href="/developers"');
	expect(body).toContain('href="/openapi.json"');
});

test("developer and trust pages are server-visible", async ({ request }) => {
	for (const path of ["/developers", "/about", "/contact", "/privacy"]) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(200);
		expect(response.headers()["content-type"], path).toContain("text/html");
		const body = await response.text();
		expect(body, path).toContain("<h1>");
		expect(body.replace(/<[^>]+>/g, " ").length, path).toBeGreaterThan(500);
	}
});

test("OpenAPI and public REST endpoints are reachable", async ({ request }) => {
	const schema = await request.get("/openapi.json");
	expect(schema.status()).toBe(200);
	expect(schema.headers()["content-type"]).toContain("application/json");
	expect((await schema.json()).openapi).toBe("3.1.0");
	const status = await request.get("/api/v1/status");
	expect(status.status()).toBe(200);
	expect((await status.json()).status).toBe("ok");
	const products = await request.get("/api/v1/products");
	expect((await products.json()).products).toHaveLength(2);
	const missing = await request.get("/api/v1/missing");
	expect(missing.status()).toBe(404);
	expect((await missing.json()).error.resolution).toBeTruthy();
});

test("markdown 404 gives agents recovery links", async ({ request }) => {
	const response = await request.get("/path-that-does-not-exist", {
		headers: { Accept: "text/markdown" },
	});
	expect(response.status()).toBe(404);
	expect(response.headers()["content-type"]).toContain("text/markdown");
	const body = await response.text();
	expect(body).toContain("/sitemap.xml");
	expect(body).toContain("/llms.txt");
	expect(body).toContain("/developers");
});
