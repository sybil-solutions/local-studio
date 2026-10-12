import { expect, test } from "@playwright/test";
import {
	HOMEPAGE_LINK_HEADER,
	agentDocument,
	agentDocuments,
	markdownTokenCount,
	wantsMarkdown,
} from "../../src/agent/documents";
import { markdownPages, routePaths } from "../../src/domain/route";
import { site } from "../../src/domain/site";
import { release } from "../../src/domain/release";
import { productFeatures, renderInlineMarkdown } from "../../src/content/product";
import { productMarkdown } from "../../src/agent/markdown";
import { machineText } from "../../src/agent/machine";

test("robots and sitemap stay deterministic", () => {
	const robots = agentDocument("/robots.txt");
	expect(robots?.contentType).toMatch(/text\/plain/);
	expect(robots?.body).toContain("User-agent: *");
	expect(robots?.body).toContain("Allow: /");
	expect(robots?.body).toContain(`Sitemap: ${site.origin}/sitemap.xml`);
	expect(robots?.body).toContain(`# Company: ${site.company.name} - ${site.company.url}`);
	expect(robots?.body).toContain(site.products.localStudio.name);
	expect(robots?.body).toContain("User-agent: GPTBot");

	const sitemap = agentDocument("/sitemap.xml");
	expect(sitemap?.contentType).toMatch(/xml/);
	for (const path of routePaths) {
		const loc = path === "/" ? `${site.origin}/` : `${site.origin}${path}`;
		expect(sitemap?.body).toContain(`<loc>${loc}</loc>`);
	}
});

test("every registered agent document has deterministic markdown", () => {
	for (const document of agentDocuments()) {
		expect(document.path).toMatch(/^\//);
		expect(document.contentType).toMatch(/charset=utf-8/);
		expect(document.body.length, document.path).toBeGreaterThan(20);
	}
});

test("every HTML route has a markdown twin", () => {
	const twins = markdownPages();
	for (const path of routePaths) {
		const markdownPath = twins.get(path);
		expect(markdownPath, path).toBeDefined();
		const document = agentDocument(markdownPath ?? "");
		expect(document?.contentType, path).toMatch(/text\/markdown/);
		expect(document?.body.length, path).toBeGreaterThan(80);
		expect(document?.body, path).toContain("Sybil Solutions");
	}
});

test("discovery documents and Accept negotiation are shared", () => {
	expect(wantsMarkdown("text/markdown")).toBe(true);
	expect(wantsMarkdown("text/html,text/markdown")).toBe(false);
	expect(markdownTokenCount("abcd")).toBe("1");
	expect(HOMEPAGE_LINK_HEADER).toContain('rel="api-catalog"');
	expect(HOMEPAGE_LINK_HEADER).toContain("/.well-known/api-catalog");
	expect(HOMEPAGE_LINK_HEADER).toContain("/llms.txt");

	const llms = agentDocument("/llms.txt");
	expect(llms?.body).toContain("Local Studio");
	expect(llms?.body).toContain("## When to use Local Studio");
	expect(llms?.body).toContain("/developers");
	expect(llms?.body).toContain("/openapi.json");
	expect(agentDocument("/.well-known/api-catalog")?.contentType).toMatch(
		/linkset\+json/,
	);
	expect(agentDocument("/.well-known/agent-card.json")?.body).toContain(
		"Sybil Solutions",
	);
	expect(agentDocuments().map((document) => document.path)).toContain(
		"/machine.md",
	);
});

test("machine routes derive from the canonical HTML route model", () => {
	const body = machineText();
	const routesSection = body.split("── ROUTES\n")[1]?.split("\n── DISCOVERY")[0] ?? "";
	for (const path of routePaths) expect(routesSection).toContain(path);
	expect(routesSection).not.toContain("/mobile");
	expect(routesSection).not.toContain("/agents");
});

test("product markdown is generated from canonical feature prose", () => {
	const body = productMarkdown();
	for (const feature of productFeatures) {
		expect(body).toContain(feature.productTitle);
		expect(body).toContain(renderInlineMarkdown(feature.productText));
	}
});

test("agent documents use canonical site facts", () => {
	const llms = agentDocument("/llms.txt")?.body ?? "";
	expect(llms).toContain(site.company.url);
	expect(llms).toContain(site.products.localStudio.repository);
	expect(llms).toContain(site.upstream.repository);
	expect(llms).toContain(site.products.codexShim.repository);
	expect(llms).toContain(site.company.x);
});

test("release URLs are derived from the Local Studio repository", () => {
	expect(release.releases).toBe(`${site.products.localStudio.repository}/releases`);
	expect(release.latest).toBe(`${site.products.localStudio.repository}/releases/latest`);
});
