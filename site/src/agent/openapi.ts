import { site } from "../domain/site.ts";

export const apiStatus = {
	status: "ok",
	service: "Local Studio public product API",
	version: "1.0.0",
	documentation: `${site.origin}/developers`,
} as const;

export const apiProducts = {
	products: [
		{
			id: "local-studio",
			name: site.products.localStudio.name,
			description:
				"Desktop app for macOS, Windows and Linux that runs every coding agent on your own models, built on T3 Code.",
			url: `${site.origin}/`,
			repository: site.products.localStudio.repository,
		},
		{
			id: "codex-shim",
			name: site.products.codexShim.name,
			description:
				"Local Responses API shim that exposes bring-your-own-key models to Codex Desktop.",
			url: site.products.codexShim.repository,
			repository: site.products.codexShim.repository,
		},
	],
} as const;

export const jsonNotFound = {
	error: {
		code: "not_found",
		message: "The requested API endpoint does not exist.",
		resolution: "Read /openapi.json or /developers for supported endpoints.",
		hint: "Read /openapi.json or /developers for supported endpoints.",
		documentation: `${site.origin}/developers`,
	},
} as const;

export const jsonMethodNotAllowed = {
	error: {
		code: "method_not_allowed",
		message: "This endpoint does not support the requested HTTP method.",
		resolution: "Use the method declared for this operation in /openapi.json.",
		hint: "Use the method declared for this operation in /openapi.json.",
		documentation: `${site.origin}/developers`,
	},
} as const;

export function openApiSpec(): string {
	return `${JSON.stringify(
		{
			openapi: "3.1.0",
			info: {
				title: "Local Studio Public API",
				version: "1.0.0",
				description:
					"Read-only public product metadata for Local Studio by Sybil Solutions. The desktop controller API runs on the user's machine and is documented separately.",
				contact: { name: site.company.name, email: site.company.contact, url: site.company.url },
				license: { name: "MIT", identifier: "MIT" },
			},
			servers: [
				{ url: "/", description: "Current origin" },
				{ url: site.origin, description: "Canonical production service" },
			],
			externalDocs: { description: "Local Studio developer portal", url: `${site.origin}/developers` },
			paths: {
				"/api/v1/status": {
					get: {
						operationId: "getPublicApiStatus",
						description: "Check whether the public Local Studio product metadata API is reachable.",
						tags: ["Discovery"],
						responses: {
							"200": {
								description: "The service is available.",
								content: { "application/json": { schema: { $ref: "#/components/schemas/Status" } } },
							},
							"405": { $ref: "#/components/responses/MethodNotAllowed" },
						},
					},
				},
				"/api/v1/products": {
					get: {
						operationId: "listLocalStudioProducts",
						description: "List public Sybil Solutions products associated with Local Studio and their canonical resources.",
						tags: ["Products"],
						responses: {
							"200": {
								description: "A typed product collection.",
								content: { "application/json": { schema: { $ref: "#/components/schemas/ProductCollection" } } },
							},
							"405": { $ref: "#/components/responses/MethodNotAllowed" },
						},
					},
				},
			},
			components: {
				schemas: {
					Status: {
						type: "object",
						required: ["status", "service", "version", "documentation"],
						properties: {
							status: { type: "string", const: "ok", description: "Current service state." },
							service: { type: "string", description: "Human-readable service name." },
							version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$", description: "API semantic version." },
							documentation: { type: "string", format: "uri", description: "Developer portal URL." },
						},
					},
					Product: {
						type: "object",
						required: ["id", "name", "description", "url", "repository"],
						properties: {
							id: { type: "string", pattern: "^[a-z0-9-]+$", description: "Stable product identifier." },
							name: { type: "string", description: "Public product name." },
							description: { type: "string", description: "Short product purpose." },
							url: { type: "string", format: "uri", description: "Canonical product URL." },
							repository: { type: "string", format: "uri", description: "Public source repository." },
						},
					},
					ProductCollection: {
						type: "object",
						required: ["products"],
						properties: { products: { type: "array", items: { $ref: "#/components/schemas/Product" } } },
					},
					Error: {
						type: "object",
						required: ["error"],
						properties: {
							error: {
								type: "object",
								required: ["code", "message", "resolution", "documentation"],
								properties: {
									code: { type: "string" }, message: { type: "string" }, resolution: { type: "string" }, hint: { type: "string" }, documentation: { type: "string", format: "uri" },
								},
							},
						},
					},
				},
				responses: {
					MethodNotAllowed: {
						description: "The HTTP method is not supported.",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},
		null,
		2,
	)}\n`;
}
