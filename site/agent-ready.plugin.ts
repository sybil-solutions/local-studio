import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import {
	agentDocument,
	agentDocuments,
	HOMEPAGE_LINK_HEADER,
	markdownPathFor,
	markdownTokenCount,
	wantsMarkdown,
} from "./src/agent/documents.ts";
import {
	apiProducts,
	apiStatus,
	jsonMethodNotAllowed,
	jsonNotFound,
} from "./src/agent/openapi.ts";
import { notFoundMarkdown } from "./src/agent/pages.ts";

function requestPath(url: string): string {
	try {
		const parsed = new URL(url, "http://localstudio.invalid");
		if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
			return parsed.pathname.slice(0, -1);
		}
		return parsed.pathname;
	} catch {
		return "";
	}
}

function writeAgentResponse(
	response: ServerResponse,
	body: string,
	contentType: string,
	linkHomepage: boolean,
): void {
	response.statusCode = 200;
	response.setHeader("Content-Type", contentType);
	response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
	response.setHeader("Vary", "Accept");
	response.setHeader(
		"Content-Signal",
		"search=yes, ai-input=yes, ai-train=yes",
	);
	if (contentType.includes("text/markdown")) {
		response.setHeader("x-markdown-tokens", markdownTokenCount(body));
	}
	if (linkHomepage) {
		response.setHeader("Link", HOMEPAGE_LINK_HEADER);
	}
	response.end(body);
}

const handleAgentRequest: Connect.NextHandleFunction = (
	request: IncomingMessage,
	response: ServerResponse,
	next: Connect.NextFunction,
) => {
	const pathname = requestPath(request.url ?? "/");
	const acceptHeader = request.headers.accept;
	const accept = Array.isArray(acceptHeader)
		? acceptHeader.join(",")
		: (acceptHeader ?? "");
	if (pathname.startsWith("/api/")) {
		const body = pathname === "/api/v1/status"
			? apiStatus
			: pathname === "/api/v1/products"
				? apiProducts
				: jsonNotFound;
		const allowed = pathname === "/api/v1/status" || pathname === "/api/v1/products";
		const responseBody = allowed && request.method !== "GET" ? jsonMethodNotAllowed : body;
		response.statusCode = allowed ? (request.method === "GET" ? 200 : 405) : 404;
		response.setHeader("Content-Type", "application/json; charset=utf-8");
		response.end(JSON.stringify(responseBody));
		return;
	}
	const documentPath = wantsMarkdown(accept)
		? markdownPathFor(pathname)
		: pathname;
	const document = agentDocument(documentPath);
	if (document) {
		writeAgentResponse(
			response,
			document.body,
			document.contentType,
			pathname === "/" || documentPath === "/index.md",
		);
		return;
	}
	if (wantsMarkdown(accept)) {
		response.statusCode = 404;
		response.setHeader("Content-Type", "text/markdown; charset=utf-8");
		response.end(notFoundMarkdown);
		return;
	}
	if (pathname === "/") {
		response.setHeader("Link", HOMEPAGE_LINK_HEADER);
		response.setHeader("Vary", "Accept");
		response.setHeader(
			"Content-Signal",
			"search=yes, ai-input=yes, ai-train=yes",
		);
	}
	next();
};

export function agentReady(): Plugin {
	return {
		name: "agent-ready",
		configureServer(server) {
			server.middlewares.use(handleAgentRequest);
		},
		configurePreviewServer(server) {
			server.middlewares.use(handleAgentRequest);
		},
		writeBundle(options) {
			const root = options.dir ?? "dist";
			for (const document of agentDocuments()) {
				const file = join(root, document.path.slice(1));
				mkdirSync(dirname(file), { recursive: true });
				writeFileSync(file, document.body);
			}
		},
	};
}
