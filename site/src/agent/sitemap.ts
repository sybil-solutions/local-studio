import { site } from "../domain/site.ts";
import { routePaths, routes } from "../domain/route.ts";

export function sitemapXml(): string {
	const SITE_ORIGIN = site.origin;
	const publicPaths = [...routePaths, "/developers", "/about", "/contact", "/privacy"];
	const priorities: ReadonlyMap<string, number> = new Map(
		routePaths.map((path) => [path, routes[path].priority]),
	);
	const urls = publicPaths.map((path) => {
		const loc = `${SITE_ORIGIN}${path === "/" ? "/" : path}`;
		return [
			"  <url>",
			`    <loc>${loc}</loc>`,
			`    <lastmod>${site.lastmod}</lastmod>`,
			"    <changefreq>weekly</changefreq>",
			`    <priority>${(priorities.get(path) ?? 0.6).toFixed(1)}</priority>`,
			"  </url>",
		].join("\n");
	});
	return [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
		...urls,
		"</urlset>",
		"",
	].join("\n");
}
