#!/usr/bin/env node
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const command = process.argv[2] ?? "check";

const budgets = {
	sharedCssGzip: 20_480,
	criticalJsGzip: 122_880,
	routeChunkGzip: 61_440,
};

function walk(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...walk(path));
			continue;
		}
		files.push(path);
	}
	return files;
}

function gzipBytes(path) {
	return gzipSync(readFileSync(path)).byteLength;
}

const dist = join(root, "dist");
try {
	statSync(join(dist, "index.html"));
} catch {
	console.error("bundle:check needs a production build in dist/");
	process.exit(1);
}

const files = walk(join(dist, "assets"))
	.map((path) => {
		const name = path.slice(join(dist, "assets").length + 1).split("\\").join("/");
		return {
			name,
			bytes: statSync(path).size,
			gzip: gzipBytes(path),
		};
	})
	.sort((a, b) => a.name.localeCompare(b.name));

const css = files.filter((file) => file.name.endsWith(".css"));
const js = files.filter((file) => file.name.endsWith(".js"));
const sharedCss = css.length === 1 ? css[0] : undefined;
const criticalJs = js.find((file) => file.name.startsWith("index-"));
const lazyHints = ["shader"];
const routeChunks = js.filter(
	(file) =>
		!file.name.startsWith("index-") &&
		!file.name.startsWith("jsx-runtime-") &&
		!lazyHints.some((hint) => file.name.startsWith(`${hint}-`)),
);
const report = {
	sharedCss,
	criticalJs,
	routeChunks,
	lazy: js.filter((file) => lazyHints.some((hint) => file.name.startsWith(`${hint}-`))),
};

console.log(`shared CSS ${sharedCss?.name ?? "missing"} ${sharedCss?.gzip ?? 0} gzip`);
console.log(`critical JS ${criticalJs?.name ?? "missing"} ${criticalJs?.gzip ?? 0} gzip`);
for (const file of routeChunks) {
	console.log(`route ${file.name} ${file.gzip} gzip`);
}
for (const file of report.lazy) {
	console.log(`lazy ${file.name} ${file.gzip} gzip`);
}

if (command !== "check") process.exit(0);

const failures = [];
if (css.length !== 1) failures.push(`expected one extracted StyleX CSS asset, found ${css.length}`);
if (!sharedCss) failures.push("missing shared StyleX CSS chunk");
else if (sharedCss.gzip > budgets.sharedCssGzip) {
	failures.push(`shared CSS ${sharedCss.gzip} exceeds ${budgets.sharedCssGzip}`);
}
if (!criticalJs) failures.push("missing critical JS chunk");
else if (criticalJs.gzip > budgets.criticalJsGzip) {
	failures.push(`critical JS ${criticalJs.gzip} exceeds ${budgets.criticalJsGzip}`);
}
for (const file of routeChunks) {
	if (file.gzip > budgets.routeChunkGzip) {
		failures.push(`route chunk ${file.name} ${file.gzip} exceeds ${budgets.routeChunkGzip}`);
	}
}
if (js.some((file) => file.name.startsWith("shader-") && file === criticalJs)) {
	failures.push("WebGPU shader chunk is eager");
}
for (const hint of lazyHints) {
	if (!js.some((file) => file.name.startsWith(`${hint}-`))) {
		failures.push(`missing lazy ${hint} chunk`);
	}
}
if (failures.length) {
	console.error(failures.join("\n"));
	process.exit(1);
}
console.log("bundle:check passed");
