import {
	agentDocument,
	HOMEPAGE_LINK_HEADER,
	markdownTokenCount,
	wantsMarkdown,
} from "../agent/documents.ts";
import { apiProducts, apiStatus, jsonMethodNotAllowed, jsonNotFound } from "../agent/openapi.ts";
import { notFoundMarkdown } from "../agent/pages.ts";
import { downloadPath, isRoutePath, markdownPathFor, normalizePath, redirectFor } from "../domain/route.ts";
import { downloadTargets, isDownloadTarget, release } from "../domain/release.ts";
import { latestVerifiedRelease, targetAsset } from "./release.ts";
import { mcpResponse } from "./mcp.ts";

type Env = {
	readonly ASSETS: { fetch: (request: Request) => Promise<Response> };
	readonly GITHUB_TOKEN?: string;
};

const signal = "search=yes, ai-input=yes, ai-train=yes";

function json<Body>(body: Body, status = 200, headers: HeadersInit = {}): Response {
	return Response.json(body, {
		status,
		headers: { "cache-control": status === 200 ? "public, max-age=60" : "no-store", ...headers },
	});
}

function unavailable(label: string, reason: string): Response {
	return json(
		{ error: `The latest verified ${label} build is temporarily unavailable.`, reason },
		503,
		{ "retry-after": "300" },
	);
}

async function download(target: string, env: Env): Promise<Response> {
	if (!isDownloadTarget(target)) {
		return json({ error: "Unknown download target.", targets: Object.keys(downloadTargets) }, 404);
	}
	const { label } = downloadTargets[target];
	try {
		const verified = await latestVerifiedRelease(env.GITHUB_TOKEN, (candidate) => targetAsset(candidate, target) !== null);
		const asset = verified ? targetAsset(verified, target) : null;
		if (!verified || !asset) return unavailable(label, "no verified stable release was found");
		return new Response(null, {
			status: 302,
			headers: {
				location: asset.url,
				"cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
				"x-local-studio-version": verified.version,
				"x-local-studio-commit": verified.commit,
				"x-local-studio-sha256": asset.sha256,
			},
		});
	} catch (error) {
		return unavailable(label, error instanceof Error ? error.message : "GitHub request failed");
	}
}

async function releaseSummary(env: Env): Promise<Response> {
	try {
		const verified = await latestVerifiedRelease(env.GITHUB_TOKEN);
		if (!verified) return json({ error: "No verified stable release was found." }, 503);
		return json(verified, 200, { "cache-control": "public, max-age=300" });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : "GitHub request failed" }, 503);
	}
}

function api(pathname: string, request: Request): Response | null {
	const data = pathname === "/api/v1/status" ? apiStatus : pathname === "/api/v1/products" ? apiProducts : null;
	if (!data) return null;
	return request.method === "GET" ? json(data) : json(jsonMethodNotAllowed, 405, { allow: "GET" });
}

function document(path: string, linkHomepage: boolean): Response | null {
	const found = agentDocument(path);
	if (!found) return null;
	const headers = new Headers({
		"content-type": found.contentType,
		"cache-control": "public, max-age=0, must-revalidate",
		vary: "Accept",
		"content-signal": signal,
	});
	if (found.contentType.includes("text/markdown")) headers.set("x-markdown-tokens", markdownTokenCount(found.body));
	if (linkHomepage) headers.set("link", HOMEPAGE_LINK_HEADER);
	return new Response(found.body, { headers });
}

async function route(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const pathname = normalizePath(url.pathname);
	const redirect = redirectFor(pathname);
	if (redirect) return Response.redirect(new URL(redirect, url.origin).toString(), 308);
	if (pathname.startsWith(`${downloadPath}/`)) return download(pathname.slice(downloadPath.length + 1), env);
	if (pathname === release.api) return releaseSummary(env);
	if (pathname === "/api/mcp" || pathname === "/.well-known/mcp") return mcpResponse(request);
	if (pathname.startsWith("/api/")) return api(pathname, request) ?? json(jsonNotFound, 404);
	const markdown = wantsMarkdown(request.headers.get("accept") ?? "");
	const found = document(markdown ? markdownPathFor(pathname) : pathname, pathname === "/");
	if (found) return found;
	if (markdown) {
		return new Response(notFoundMarkdown, { status: 404, headers: { "content-type": "text/markdown; charset=utf-8" } });
	}
	if (!isRoutePath(pathname)) {
		const asset = await env.ASSETS.fetch(request);
		if (asset.status !== 404) return asset;
	}
	const shell = await env.ASSETS.fetch(new Request(new URL("/", url), request));
	const headers = new Headers(shell.headers);
	headers.set("vary", "Accept");
	headers.set("content-signal", signal);
	if (pathname === "/") headers.set("link", HOMEPAGE_LINK_HEADER);
	return new Response(shell.body, { status: isRoutePath(pathname) ? shell.status : 404, headers });
}

export default { fetch: route };
