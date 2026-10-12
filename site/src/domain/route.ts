import { site } from "./site.ts";

function brandedTitle(label: string): string {
	return `${label} - ${site.products.localStudio.name}`;
}

export const routes = {
	"/": {
		title: brandedTitle("Intelligence Should Be Owned"),
		heading: "Intelligence Should Be Owned",
		summary: "Homepage: Local Studio 3.0, every coding agent on your own models.",
		markdown: "/index.md",
		footerLabel: null,
		priority: 1,
		machineLabel: "home",
	},
	"/product": {
		title: brandedTitle("Product"),
		heading: "One Place to Run Local AI",
		summary: "Agents, bundled controller, Tailscale fleet, registry, phone.",
		markdown: "/product.md",
		footerLabel: null,
		priority: 0.9,
		machineLabel: "product",
	},
	"/docs": {
		title: brandedTitle("Documentation"),
		heading: "Get Local Studio Running",
		summary: "Install, agents, local models, fleet, registry, phone, controller API.",
		markdown: "/docs.md",
		footerLabel: "Docs",
		priority: 0.8,
		machineLabel: "docs",
	},
	"/setup": {
		title: brandedTitle("Setup"),
		heading: "Give This to Any Coding Model",
		summary: "Portable setup prompt for a coding model on the target machine.",
		markdown: "/setup.md",
		footerLabel: "Setup",
		priority: 0.7,
		machineLabel: "setup",
	},
	"/download": {
		title: brandedTitle("Download"),
		heading: "Download Local Studio",
		summary: "Verified installers for macOS, Windows, Linux, and controller binaries.",
		markdown: "/download.md",
		footerLabel: "Download",
		priority: 0.8,
		machineLabel: "download",
	},
	"/overview": {
		title: brandedTitle("Overview"),
		heading: "Everything Around Local Studio",
		summary: "Docs, setup, download, upstream credits, source, discovery.",
		markdown: "/overview.md",
		footerLabel: "Overview",
		priority: 0.6,
		machineLabel: "overview",
	},
	"/machine": {
		title: brandedTitle("Machines"),
		heading: "Machines",
		summary:
			"Dense machine-readable index of company, products, and discovery.",
		markdown: "/machine.md",
		footerLabel: "Machines",
		priority: 0.9,
		machineLabel: "machine",
	},
} as const;

export type RoutePath = keyof typeof routes;

export const routePaths = [
	"/",
	"/product",
	"/docs",
	"/setup",
	"/download",
	"/overview",
	"/machine",
] as const satisfies readonly RoutePath[];

export function isRoutePath(pathname: string): pathname is RoutePath {
	return Object.prototype.hasOwnProperty.call(routes, pathname);
}


export const homePath = "/" satisfies RoutePath;
export const productPath = "/product" satisfies RoutePath;
export const machinePath = "/machine" satisfies RoutePath;
export const downloadPath = "/download" satisfies RoutePath;
export const setupPath = "/setup" satisfies RoutePath;
export const docsPath = "/docs" satisfies RoutePath;
export const overviewPath = "/overview" satisfies RoutePath;
export function isHeroImageRoute(pathname: string): boolean {
	return pathname === "/product";
}

export function routeTitle(path: RoutePath): string {
	return routes[path].title;
}

export function markdownPathFor(pathname: string): string {
	if (pathname === "/") return routes["/"].markdown;
	if (isRoutePath(pathname)) return routes[pathname].markdown;
	return pathname;
}

export const documents = {
	"/mobile.md": "markdown-only",
	"/agents.md": "markdown-only",
	"/services.md": "markdown-only",
	"/people.md": "markdown-only",
	"/showcase.md": "markdown-only",
	"/faq.md": "markdown-only",
} as const;

export type DocumentPath = keyof typeof documents;

function isDocumentPath(pathname: string): pathname is DocumentPath {
	return Object.prototype.hasOwnProperty.call(documents, pathname);
}

export function documentPaths(): readonly DocumentPath[] {
	return Object.keys(documents).filter(isDocumentPath);
}

export const redirects = {
	"/mobile": "/#mobile",
	"/agents": "/setup",
} as const;

type RedirectPath = keyof typeof redirects;

function isRedirectPath(pathname: string): pathname is RedirectPath {
	return Object.prototype.hasOwnProperty.call(redirects, pathname);
}

export function redirectFor(pathname: string): string | null {
	return isRedirectPath(pathname) ? redirects[pathname] : null;
}

export function footerRoutes(): readonly { path: RoutePath; label: string }[] {
	return (
		[
			["/machine", routes["/machine"].footerLabel],
			["/overview", routes["/overview"].footerLabel],
			["/docs", routes["/docs"].footerLabel],
			["/setup", routes["/setup"].footerLabel],
			["/download", routes["/download"].footerLabel],
		] as const
	).flatMap(([path, label]) => (label ? [{ path, label }] : []));
}

export function resourceNav(): readonly { href: RoutePath; label: string }[] {
	return [
		{ href: overviewPath, label: "Overview" },
		{ href: docsPath, label: "Documentation" },
		{ href: setupPath, label: "Setup" },
	];
}

type ProductNavItem = {
	readonly label: string;
	readonly href: string;
	readonly external?: true;
};

export function productNav(): readonly ProductNavItem[] {
	return [
		{ label: site.products.localAi.name, href: site.products.localAi.url, external: true },
		{ label: site.products.localStudio.name, href: downloadPath },
		{ label: site.products.codexShim.name, href: site.products.codexShim.repository, external: true },
	];
}

export function notFoundSuggestions(): readonly {
	href: RoutePath;
	label: string;
}[] {
	return [
		{ href: "/", label: "Overview" },
		{ href: "/product", label: "Product" },
		{ href: "/docs", label: "Docs" },
		{ href: "/setup", label: "Setup Prompt" },
		{ href: "/download", label: "Download" },
	];
}

export function markdownPages(): ReadonlyMap<string, string> {
	const entries: [string, string][] = routePaths.map((path) => [
		path,
		routes[path].markdown,
	]);
	for (const path of documentPaths()) {
		entries.push([path.replace(/\.md$/, ""), path]);
	}
	return new Map(entries);
}

export function normalizePath(pathname: string): string {
	if (pathname !== "/" && pathname.endsWith("/")) {
		return pathname.slice(0, -1);
	}
	return pathname;
}

type LinkDecision =
	| { readonly kind: "external" }
	| { readonly kind: "push"; readonly next: string }
	| { readonly kind: "hash"; readonly hash: string }
	| { readonly kind: "top" };

export function decideSameOriginNavigation(
	href: string,
	currentOrigin: string,
	currentPath: string,
): LinkDecision {
	let target: URL;
	try {
		target = new URL(href, currentOrigin + currentPath);
	} catch {
		return { kind: "external" };
	}
	const current = new URL(currentPath, currentOrigin);
	if (target.origin !== current.origin) return { kind: "external" };
	const next = `${target.pathname}${target.search}${target.hash}`;
	const here = `${current.pathname}${current.search}${current.hash}`;
	if (next !== here) return { kind: "push", next };
	if (target.hash) return { kind: "hash", hash: target.hash };
	return { kind: "top" };
}

export function hashAnchor(hash: string): string {
	return hash.split("=")[0] ?? hash;
}

export function downloadLabel(): string {
	return routes[downloadPath].heading;
}

export function notFoundTitle(): string {
	return brandedTitle("Page not found");
}
