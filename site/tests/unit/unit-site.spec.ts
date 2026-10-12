import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { site } from "../../src/domain/site";

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return extname(path) === ".ts" || extname(path) === ".tsx" ? [path] : [];
	});
}

test("first-party source does not hardcode product URLs outside site.ts", () => {
	const forbidden = [
		site.company.url,
		site.company.alias,
		site.company.github,
		site.company.contact,
		site.company.x,
		site.products.localStudio.repository,
		site.upstream.repository,
		site.upstream.appStore,
		site.upstream.playStore,
		site.registry.repository,
		site.products.localAi.url,
		site.products.codexShim.repository,
		site.source,
	];
	const violations: string[] = [];
	for (const path of sourceFiles("src")) {
		if (path.endsWith("src/domain/site.ts")) continue;
		const source = readFileSync(path, "utf8");
		for (const value of forbidden) {
			if (source.includes(value)) violations.push(`${path} ${value}`);
		}
	}
	expect(violations).toEqual([]);
});

test("footer copyright reads year and product name from site facts", () => {
	const source = readFileSync("src/components/Footer.tsx", "utf8");
	expect(source.includes("site.copyrightYear")).toBe(true);
	expect(source.includes("site.products.localStudio.name")).toBe(true);
	expect(source.includes("© 2026")).toBe(false);
});

test("header and machine chrome labels read the product name from site facts", () => {
	const header = readFileSync("src/components/Header.tsx", "utf8");
	expect(header.includes("site.products.localStudio.name")).toBe(true);
	expect(header.includes('aria-label="Local Studio"')).toBe(false);
	const machine = readFileSync("src/pages/MachinePage.tsx", "utf8");
	expect(machine.includes("site.products.localStudio.name")).toBe(true);
	const notFound = readFileSync("src/pages/NotFoundPage.tsx", "utf8");
	expect(notFound.includes("site.products.localStudio.name")).toBe(true);
	expect(notFound.includes(">Local Studio<")).toBe(false);
	const docs = readFileSync("src/pages/DocsPage.tsx", "utf8");
	const product = readFileSync("src/pages/ProductPage.tsx", "utf8");
	expect(docs.includes("site.products.localStudio.name")).toBe(true);
	expect(product.includes("site.products.localStudio.name")).toBe(true);
	expect(docs.includes(">Local Studio<")).toBe(false);
	expect(product.includes(">Local Studio<")).toBe(false);
});
