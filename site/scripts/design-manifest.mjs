#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assets } from "../src/domain/asset.ts";
import { documents, redirects, routePaths } from "../src/domain/route.ts";
import { motion } from "../src/domain/motion.ts";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const command = process.argv[2] ?? "write";
const architecture = JSON.parse(readFileSync(`${root}/architecture.json`, "utf8"));
const tokenSources = {
	public: "src/styles/public-tokens.stylex.ts",
};

function stylexTokenIds(rel) {
	const source = readFileSync(`${root}/${rel}`, "utf8");
	return [
		...new Set(
			[...source.matchAll(/^(?:\t| {2})([A-Za-z_$][\w$]*)\s*:/gm)].map(
				(match) => match[1],
			),
		),
	];
}

const manifest = {
	routes: [...routePaths],
	documents: Object.keys(documents),
	redirects: Object.keys(redirects),
	assets: Object.keys(assets),
	motion: Object.keys(motion),
	tokens: Object.fromEntries(
		Object.entries(tokenSources).map(([name, rel]) => [name, stylexTokenIds(rel)]),
	),
	components: architecture.singleConsumerComponents,
};

const serialized = `${JSON.stringify(manifest, null, "\t")}\n`;
const hash = createHash("sha256").update(serialized).digest("hex");
const output = {
	hash,
	...manifest,
};
const body = `${JSON.stringify(output, null, "\t")}\n`;
const dest = `${root}/design-manifest.json`;

if (command === "write") {
	writeFileSync(dest, body);
	console.log(`wrote design-manifest.json ${hash}`);
} else if (command === "check") {
	const current = readFileSync(dest, "utf8");
	if (current !== body) {
		console.error("design-manifest.json is stale; run pnpm design:manifest");
		process.exit(1);
	}
	console.log(`design-manifest.json ${hash}`);
} else {
	console.error(`unknown command: ${command}`);
	process.exit(1);
}
