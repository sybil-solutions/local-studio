#!/usr/bin/env node
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { relative, join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const forbidden = [
	["src/styles", ["global", "css"].join(".")].join("/"),
	["packages/demo-ui/src/styles", ["workbench", "demo.css"].join("-")].join("/"),
	"src/styles/ls-app.css",
	"packages/demo-ui/src/styles/ls-app.css",
	"src/styles/ls",
	"src/ls",
	"src/ls-shared",
	"src/ls-contracts",
	"src/sections/story",
	"src/sections/HeroDemo.tsx",
	"src/agent/catalog.ts",
	"src/machine.ts",
	"src/routes.ts",
	"src/images.ts",
	"src/routing.ts",
];
const generated = [
	{
		label: "design-manifest",
		args: ["--experimental-strip-types", "scripts/design-manifest.mjs", "write"],
		files: ["design-manifest.json"],
	},
	{ label: "asset-manifest", args: ["scripts/assets.mjs", "write"], files: ["asset-manifest.json"] },
	{
		label: "index.html",
		args: ["--experimental-strip-types", "scripts/index-html.mjs", "write"],
		files: ["index.html"],
	},
];
const excludedCopyParts = new Set([
	".git",
	".context",
	"dist",
	"node_modules",
	"playwright-report",
	"test-results",
]);

function assertNoForbiddenPaths() {
	const present = forbidden.filter((rel) => existsSync(join(root, rel)));
	if (present.length) {
		throw new Error(`generated:check found leftover paths:\n${present.join("\n")}`);
	}
}

function copyFilter(source) {
	const rel = relative(root, source);
	return !rel.split(/[\\/]/).some((part) => excludedCopyParts.has(part));
}

function runGenerator(directory, { label, args }) {
	const result = spawnSync(process.execPath, args, {
		cwd: directory,
		encoding: "utf8",
		stdio: "inherit",
	});
	if (result.status !== 0) throw new Error(`${label} generation failed`);
}

function compareGenerated(directory, files) {
	for (const rel of files) {
		const expected = readFileSync(join(directory, rel));
		const current = readFileSync(join(root, rel));
		if (!expected.equals(current)) throw new Error(`generated output is stale: ${rel}`);
	}
}

assertNoForbiddenPaths();
const temporaryRoot = mkdtempSync(join(tmpdir(), "ls-web-generated-"));
try {
	cpSync(root, temporaryRoot, { recursive: true, filter: copyFilter });
	// The logo generator is checked in place because it uses the package-owned earcut dependency.
	runGenerator(root, {
		label: "logo mesh",
		args: ["packages/logo-renderer/scripts/generate-logo-mesh.mjs", "--check"],
	});
	for (const output of generated) {
		runGenerator(temporaryRoot, output);
		compareGenerated(temporaryRoot, output.files);
	}
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}
console.log("generated outputs are deterministic and current");
