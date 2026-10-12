export const site = {
	origin: "https://localstudio.ai",
	lastmod: "2026-10-05",
	copyrightYear: 2026,
	source: "https://github.com/sybil-solutions/local-studio-site",
	company: {
		name: "Sybil Solutions",
		url: "https://www.sybilsolutions.ai/",
		alias: "https://sybilsolutions.ai",
		github: "https://github.com/sybil-solutions",
		contact: "sherif@sybilsolutions.ai",
		x: "https://x.com/0xsero",
	},
	products: {
		localStudio: {
			name: "Local Studio",
			repository: "https://github.com/sybil-solutions/local-studio",
		},
		localAi: {
			name: "Local AI",
			url: "https://local.ai",
		},
		codexShim: {
			name: "Codex Shim",
			repository: "https://github.com/sybil-solutions/codex-shim",
		},
	},
	upstream: {
		name: "T3 Code",
		authors: "Theo Browne, Julius Marminge and T3 Tools",
		license: "MIT",
		repository: "https://github.com/pingdotgg/t3code",
		appStore: "https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824",
		playStore: "https://play.google.com/store/apps/details?id=com.t3tools.t3code",
	},
	registry: {
		name: "local-ai-registry",
		repository: "https://github.com/0xSero/local-ai-registry",
	},
} as const;

export type Site = typeof site;
