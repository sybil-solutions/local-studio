#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { unpluginFactory } from "@stylexjs/unplugin";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const inspectDist = process.argv.includes("--dist");
const excludedDirectories = new Set([
	".context",
	".git",
	"dist",
	"node_modules",
	"playwright-report",
	"test-results",
]);
const textExtensions = new Set([
	".css",
	".html",
	".js",
	".json",
	".mjs",
	".ts",
	".tsx",
	".yaml",
	".yml",
]);
const frameworkName = ["tail", "wind"].join("");
const frameworkPattern = new RegExp(frameworkName, "i");
const frameworkDirective = new RegExp(`@(?:${frameworkName}|apply|config|theme|utility)\\b`, "i");
const allowedCss = new Set(["src/styles/stylex-entry.css"]);

function walk(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
		const absolute = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...walk(absolute));
		else files.push(absolute);
	}
	return files;
}

function projectFiles() {
	return walk(root).filter((absolute) => textExtensions.has(extname(absolute)));
}

function assertSourceContract() {
	const failures = [];
	const files = projectFiles();
	let createCalls = 0;
	let propsCalls = 0;
	let typedVariables = 0;
	let variableGroups = 0;
	for (const absolute of files) {
		const rel = relative(root, absolute).split("\\").join("/");
		const source = readFileSync(absolute, "utf8");
		if (frameworkPattern.test(source) || frameworkDirective.test(source)) {
			failures.push(`${rel}: legacy styling framework reference`);
		}
		if (extname(absolute) === ".css") {
			if (!allowedCss.has(rel)) failures.push(`${rel}: authored CSS is not allowed`);
			else if (/[^\s]/.test(source)) failures.push(`${rel}: StyleX entry CSS must stay empty`);
		}
		if (rel.startsWith("src/") || rel.startsWith("packages/")) {
			if (rel.endsWith(".tsx")) {
				if (/<[A-Za-z][^>]*\bclassName\s*=/.test(source)) failures.push(`${rel}: literal className styling is not allowed`);
				if (/<[A-Za-z][^>]*\bstyle\s*=/.test(source)) failures.push(`${rel}: JSX inline style is not allowed`);
			}
			if (/\.classList\b/.test(source)) failures.push(`${rel}: runtime class mutation is not allowed`);
			if (/\.style(?:\.|\[)/.test(source)) failures.push(`${rel}: runtime inline style mutation is not allowed`);
			if (/var\(\s*--/.test(source)) failures.push(`${rel}: untyped CSS custom-property access is not allowed`);
			if (/<style(?:\s|>)/i.test(source)) failures.push(`${rel}: raw style blocks are not allowed`);
		}
		if (rel.endsWith(".html") && /<style(?:\s|>)/i.test(source)) {
			failures.push(`${rel}: raw style blocks are not allowed`);
		}
		if (/from\s+["'][^"']+\.css["']|import\s+["'][^"']+\.css["']/.test(source)) {
			if (rel !== "src/main.tsx") failures.push(`${rel}: CSS imports are not allowed`);
		}
		createCalls += source.match(/stylex\.create\s*\(/g)?.length ?? 0;
		propsCalls += source.match(/stylex\.props\s*\(/g)?.length ?? 0;
		typedVariables += source.match(/stylex\.types\.[a-zA-Z]+\s*\(/g)?.length ?? 0;
		variableGroups += source.match(/stylex\.define(?:Vars|Consts)\s*\(/g)?.length ?? 0;
	}
	const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	if (packageJson.dependencies?.["@stylexjs/stylex"] === undefined) {
		failures.push("package.json: missing @stylexjs/stylex runtime");
	}
	for (const dependency of ["@stylexjs/eslint-plugin", "@stylexjs/unplugin"]) {
		if (packageJson.devDependencies?.[dependency] === undefined) {
			failures.push(`package.json: missing ${dependency}`);
		}
	}
	if (createCalls < 12) failures.push(`StyleX coverage is too low: ${createCalls} create calls`);
	if (propsCalls < 40) failures.push(`StyleX coverage is too low: ${propsCalls} props calls`);
	if (typedVariables < 10) failures.push(`StyleX typed-variable coverage is too low: ${typedVariables} typed values`);
	if (variableGroups < 2) failures.push(`StyleX token coverage is too low: ${variableGroups} variable groups`);
	if (failures.length > 0) throw new Error(failures.join("\n"));
	console.log(`StyleX source contract passed: ${createCalls} create, ${propsCalls} props, ${typedVariables} typed values, ${variableGroups} token groups`);
}

async function assertDevelopmentCss() {
	const plugin = unpluginFactory(
		{
			dev: true,
			runtimeInjection: false,
			unstable_moduleResolution: { type: "commonJS", rootDir: root },
			useCSSLayers: true,
		},
		{ framework: "vite" },
	);
	const sources = projectFiles().filter((absolute) => {
		const rel = relative(root, absolute).split("\\").join("/");
		return (rel.startsWith("src/") || rel.startsWith("packages/")) && /\.[cm]?[jt]sx?$/.test(rel);
	});
	for (const absolute of sources) {
		await plugin.transform.call(
			{ meta: { watchMode: false } },
			readFileSync(absolute, "utf8"),
			absolute,
		);
		plugin.__stylexCollectCss();
	}
	console.log(`StyleX development CSS passed: ${sources.length} modules`);
}

function assertBuildContract() {
	const dist = join(root, "dist");
	if (!statSync(join(dist, "index.html")).isFile()) throw new Error("StyleX build check needs dist/index.html");
	const files = walk(dist).filter((absolute) => textExtensions.has(extname(absolute)));
	const css = files.filter((absolute) => extname(absolute) === ".css");
	if (css.length === 0) throw new Error("StyleX build emitted no CSS asset");
	const output = files.map((absolute) => readFileSync(absolute, "utf8")).join("\n");
	const legacyVariable = new RegExp(`--${["t", "w"].join("")}-`, "i");
	if (frameworkPattern.test(output) || legacyVariable.test(output)) {
		throw new Error("StyleX build contains legacy framework output");
	}
	if (!/@layer priority\d/.test(output) || !/\.x[a-zA-Z0-9_-]+\s*\{/.test(output)) {
		throw new Error("StyleX atomic output was not found in the production CSS");
	}
	console.log(`StyleX build contract passed: ${css.length} CSS asset${css.length === 1 ? "" : "s"}`);
}

assertSourceContract();
await assertDevelopmentCss();
if (inspectDist) assertBuildContract();
