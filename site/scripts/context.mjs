#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const command = process.argv[2] ?? "report";

const INCLUDE_EXT = new Set([
	".ts",
	".tsx",
	".js",
	".mjs",
	".css",
	".wgsl",
	".txt",
	".html",
	".json",
	".yml",
	".yaml",
]);
const EXCLUDE_DIRS = new Set([
	"node_modules",
	".pnpm-store",
	"dist",
	".git",
	"test-results",
	"playwright-report",
	".context",
]);
const EXCLUDE_FILES = new Set(["pnpm-lock.yaml"]);
const GENERATED_FILES = new Set([
	"asset-manifest.json",
	"design-manifest.json",
	"index.html",
]);
const EXCLUDED_CATEGORIES = new Set([
	"copied-product",
	"logo-renderer",
	"generated",
	"vendored-tooling",
]);
const WORKSPACE_PACKAGES = [
	{
		root: "packages/logo-renderer",
		category: "logo-renderer",
		manifest: "packages/logo-renderer/package.json",
	},
];

const CATEGORY_BUDGETS = {
	"domain/content/agent": { target: 16_000, hard: 19_000 },
	"react pages/components/app": { target: 26_000, hard: 34_000 },
	"demos + scenario": { target: 15_000, hard: 18_000 },
	"StyleX/motion": { target: 11_000, hard: 14_000 },
	tests: { target: 14_000, hard: 17_000 },
	"build/config/tooling": { target: 30_000, hard: 35_000 },
	"package/html/misc": { target: 3_000, hard: 4_000 },
	"copied-product": { target: 0, hard: Number.POSITIVE_INFINITY },
	"logo-renderer": { target: 0, hard: Number.POSITIVE_INFINITY },
	generated: { target: 0, hard: Number.POSITIVE_INFINITY },
	"vendored-tooling": { target: 0, hard: Number.POSITIVE_INFINITY },
	other: { target: 0, hard: Number.POSITIVE_INFINITY },
};

const TOTAL_OPERATING = 96_000;
const TOTAL_HARD = 100_000;
const TOTAL_WARN = 86_000;

function workspacePackageMetadata() {
	return WORKSPACE_PACKAGES.map((workspacePackage) => ({
		...workspacePackage,
		...JSON.parse(readFileSync(join(root, workspacePackage.manifest), "utf8")),
	}));
}

function validateWorkspacePackages() {
	const workspace = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
	const failures = [];
	if (!workspace.includes("packages/*")) {
		failures.push("pnpm-workspace.yaml must include packages/*");
	}
	for (const workspacePackage of workspacePackageMetadata()) {
		if (!workspacePackage.name) {
			failures.push(`${workspacePackage.root} has no package name`);
		}
		if (!workspacePackage.version || workspacePackage.version === "0.0.0") {
			failures.push(`${workspacePackage.root} must have an explicit package version`);
		}
		if (!workspacePackage.scripts?.typecheck) {
			failures.push(`${workspacePackage.root} must expose a typecheck script`);
		}
	}
	if (failures.length > 0) throw new Error(failures.join("\n"));
}

function walk(directory) {
	const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	const files = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!EXCLUDE_DIRS.has(entry.name)) files.push(...walk(path));
			continue;
		}
		const rel = relative(root, path).split("\\").join("/");
		if (EXCLUDE_FILES.has(entry.name)) continue;
		const ext = entry.name.includes(".")
			? `.${entry.name.split(".").pop().toLowerCase()}`
			: "";
		if (!INCLUDE_EXT.has(ext)) continue;
		files.push(rel);
	}
	return files;
}

function classify(rel) {
	if (GENERATED_FILES.has(rel)) return "generated";
	if (
		rel.startsWith("src/ls/") ||
		rel.startsWith("src/ls-shared/") ||
		rel.startsWith("src/ls-contracts/")
	) {
		return "copied-product";
	}
	if (rel.startsWith("packages/logo-renderer/")) return "logo-renderer";
	if (rel.startsWith("packages/demo-ui/")) return "copied-product";
	if (
		rel.startsWith("src/sections/localai-logo-shader/") ||
		rel.startsWith("packages/logo-renderer/")
	) {
		return "logo-renderer";
	}
	if (
		rel.startsWith("src/agent/") ||
		rel.startsWith("src/content/") ||
		rel.startsWith("src/domain/") ||
		rel === "src/images.ts"
	) {
		return "domain/content/agent";
	}
	if (
		rel.startsWith("src/demo/") ||
		rel.startsWith("src/sections/hero/") ||
		rel.startsWith("src/sections/story/")
	) {
		return "demos + scenario";
	}
	if (rel.startsWith("tools/oxlint/anti-slop/")) return "vendored-tooling";
	if (rel.startsWith("src/styles/") || rel.endsWith(".css")) {
		return "StyleX/motion";
	}
	if (rel.startsWith("tests/")) return "tests";
	if (
		rel.startsWith("scripts/") ||
		rel.startsWith("src/worker/") ||
		rel.startsWith("tools/") ||
		rel.startsWith(".github/") ||
		[
			"vite.config.ts",
			"eslint.config.js",
			"oxlint.config.ts",
			"playwright.config.ts",
			"agent-ready.plugin.ts",
			"wrangler.jsonc",
			"tsconfig.json",
			"tsconfig.app.json",
			"tsconfig.node.json",
			"src/wgsl.d.ts",
		].includes(rel)
	) {
		return "build/config/tooling";
	}
	if (
		rel.startsWith("src/pages/") ||
		rel.startsWith("src/components/") ||
		rel.startsWith("src/hooks/") ||
		rel.startsWith("src/sections/") ||
		rel === "src/app/App.tsx" ||
		rel === "src/main.tsx" ||
		rel.startsWith("src/app/")
	) {
		return "react pages/components/app";
	}
	if (["package.json", "index.html", "README.md", "pnpm-workspace.yaml", ".mcp.json", "architecture.json"].includes(rel)) {
		return "package/html/misc";
	}
	return "other";
}

function tokenize(text) {
	return Math.ceil(text.length / 4) || 0;
}

function collect() {
	const files = walk(root).sort((a, b) => a.localeCompare(b));
	const rows = [];
	for (const rel of files) {
		const raw = readFileSync(join(root, rel));
		if (raw.includes(0)) {
			throw new Error(`unexpected null byte: ${rel}`);
		}
		const text = raw.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		rows.push({
			path: rel,
			bytes: raw.byteLength,
			chars: text.length,
			tokens: tokenize(text),
			category: classify(rel),
			sha256: createHash("sha256").update(raw).digest("hex"),
			text,
		});
	}
	return rows;
}

function categoryTotals(rows) {
	const totals = {};
	for (const row of rows) {
		const current = totals[row.category] ?? { files: 0, bytes: 0, tokens: 0 };
		current.files += 1;
		current.bytes += row.bytes;
		current.tokens += row.tokens;
		totals[row.category] = current;
	}
	return totals;
}

function counted(rows) {
	return rows.filter((row) => !EXCLUDED_CATEGORIES.has(row.category));
}

function printReport(rows) {
	const all = categoryTotals(rows);
	const countedRows = counted(rows);
	const countedTotal = countedRows.reduce((sum, row) => sum + row.tokens, 0);
	const lines = [
		`files ${rows.length}`,
		`counted tokens ${countedTotal} (operating ${TOTAL_OPERATING}, hard ${TOTAL_HARD})`,
		"",
		"categories",
	];
	for (const [category, stats] of Object.entries(all).sort((a, b) => b[1].tokens - a[1].tokens)) {
		const budget = CATEGORY_BUDGETS[category];
		lines.push(
			`  ${category.padEnd(32)} ${String(stats.tokens).padStart(7)} tokens  ${stats.files} files  target ${budget.target} hard ${Number.isFinite(budget.hard) ? budget.hard : "inf"}`,
		);
	}
	const excludedRows = rows.filter((row) => EXCLUDED_CATEGORIES.has(row.category));
	const excludedTokens = excludedRows.reduce((sum, row) => sum + row.tokens, 0);
	lines.push(
		"",
		`excluded tokens ${excludedTokens} (workspace packages, generated outputs, and copied assets)`,
		"exclusion basis",
		...workspacePackageMetadata().map(
			({ root: packageRoot, name, version, category }) =>
				`  ${name}@${version}  ${packageRoot}  (${category}; package typecheck runs in pnpm check)`,
		),
		`  generated files: ${[...GENERATED_FILES].join(", ")}`,
		`  excluded files: ${[...EXCLUDE_FILES].join(", ")}`,
		"",
		"top 50",
	);
	for (const row of [...rows].sort((a, b) => b.tokens - a.tokens).slice(0, 50)) {
		lines.push(`  ${String(row.tokens).padStart(6)}  ${row.category.padEnd(28)}  ${row.path}`);
	}
	console.log(lines.join("\n"));
	return { countedTotal, all };
}

function writeBundle(rows) {
	const countedRows = counted(rows);
	mkdirSync(join(root, ".context"), { recursive: true });
	const body = countedRows
		.map((row) => `<!-- file: ${row.path} sha256:${row.sha256} -->\n\`\`\`\n${row.text}\n\`\`\`\n`)
		.join("\n");
	writeFileSync(join(root, ".context/implementation.md"), body);
	writeFileSync(
		join(root, ".context/manifest.json"),
		`${JSON.stringify(
			{
				tokenizer: "approx ceil(utf8_chars/4) after newline normalize",
				exclusions: {
					workspacePackages: workspacePackageMetadata().map(
						({ root: packageRoot, name, version, category }) => ({
							root: packageRoot,
							name,
							version,
							category,
						}),
					),
					categories: [...EXCLUDED_CATEGORIES],
					files: [...EXCLUDE_FILES],
					generatedFiles: [...GENERATED_FILES],
				},
				files: rows.map(({ path, bytes, tokens, category, sha256 }) => ({
					path,
					bytes,
					tokens,
					category,
					sha256,
				})),
			},
			null,
			"\t",
		)}\n`,
	);
}

function check(rows) {
	const countedRows = counted(rows);
	const countedTotal = countedRows.reduce((sum, row) => sum + row.tokens, 0);
	const failures = [];
	if (countedTotal > TOTAL_HARD) {
		failures.push(`total ${countedTotal} exceeds hard ceiling ${TOTAL_HARD}`);
	}
	if (countedTotal > TOTAL_OPERATING) {
		failures.push(`total ${countedTotal} exceeds operating gate ${TOTAL_OPERATING}`);
	}
	const totals = categoryTotals(countedRows);
	for (const [category, stats] of Object.entries(totals)) {
		const budget = CATEGORY_BUDGETS[category];
		if (Number.isFinite(budget.hard) && stats.tokens > budget.hard) {
			failures.push(`${category} ${stats.tokens} exceeds hard ${budget.hard}`);
		}
	}
	if (countedTotal >= TOTAL_WARN && countedTotal <= TOTAL_OPERATING) {
		console.warn(`warning: counted tokens ${countedTotal} >= ${TOTAL_WARN}`);
	}
	if (failures.length > 0) {
		console.error(failures.join("\n"));
		process.exitCode = 1;
	}
}

const rows = collect();
validateWorkspacePackages();
if (command === "report") {
	printReport(rows);
} else if (command === "bundle") {
	printReport(rows);
	writeBundle(rows);
} else if (command === "check") {
	printReport(rows);
	check(rows);
} else {
	console.error(`unknown command: ${command}`);
	process.exit(1);
}
