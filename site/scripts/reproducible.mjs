#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

function walk(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...walk(path));
			continue;
		}
		files.push(path);
	}
	return files;
}

function manifest() {
	return walk(join(root, "dist"))
		.map((path) => {
			const rel = path.slice(join(root, "dist").length + 1).split("\\").join("/");
			const raw = readFileSync(path);
			return {
				path: rel,
				bytes: raw.byteLength,
				sha256: createHash("sha256").update(raw).digest("hex"),
			};
		})
		.sort((a, b) => a.path.localeCompare(b.path));
}

function build() {
	rmSync(join(root, "dist"), { recursive: true, force: true });
	const result = spawnSync("pnpm", ["build"], {
		cwd: root,
		stdio: "inherit",
		env: process.env,
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
}

build();
const first = manifest();
build();
const second = manifest();
const left = JSON.stringify(first, null, "\t");
const right = JSON.stringify(second, null, "\t");
if (left !== right) {
	console.error("reproducible:check failed");
	const byPath = new Map(second.map((row) => [row.path, row]));
	for (const row of first) {
		const other = byPath.get(row.path);
		if (!other) {
			console.error(`missing in second build: ${row.path}`);
			continue;
		}
		if (other.sha256 !== row.sha256) {
			console.error(`hash mismatch ${row.path}`);
		}
	}
	process.exit(1);
}
console.log(`reproducible:check passed (${first.length} files)`);
