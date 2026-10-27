#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const command = process.argv[2] ?? "write";
const dest = join(root, "asset-manifest.json");

const ROLE_BY_EXT = {
	".png": "image",
	".webp": "image",
	".jpeg": "image",
	".jpg": "image",
	".svg": "image",
	".ico": "icon",
	".woff2": "font",
	".bin": "mesh",
	".gltf": "mesh",
	".mp4": "video",
};

const TYPE_BY_EXT = {
	".png": "image/png",
	".webp": "image/webp",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".bin": "application/octet-stream",
	".gltf": "model/gltf+json",
	".mp4": "video/mp4",
};

function dimensionsFor(rel, raw) {
	const ext = extname(rel).toLowerCase();
	if (ext === ".png" && raw.subarray(0, 8).equals(Buffer.from("\x89PNG\r\n\x1a\n", "binary"))) {
		return { width: raw.readUInt32BE(16), height: raw.readUInt32BE(20) };
	}
	if (
		ext === ".webp" &&
		raw.toString("ascii", 0, 4) === "RIFF" &&
		raw.toString("ascii", 8, 12) === "WEBP" &&
		raw.toString("ascii", 12, 16) === "VP8X"
	) {
		return {
			width: 1 + raw.readUIntLE(24, 3),
			height: 1 + raw.readUIntLE(27, 3),
		};
	}
	if (ext === ".svg") {
		const source = raw.toString("utf8", 0, 8192);
		const viewBox = source.match(/\bviewBox\s*=\s*["']\s*([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)/i);
		if (viewBox) return { width: Number(viewBox[3]), height: Number(viewBox[4]) };
		const width = source.match(/\bwidth\s*=\s*["']([\d.]+)/i);
		const height = source.match(/\bheight\s*=\s*["']([\d.]+)/i);
		if (width && height) return { width: Number(width[1]), height: Number(height[1]) };
	}
	return null;
}

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

function roleFor(rel) {
	if (rel.startsWith("public/fonts/")) return "font";
	if (rel.startsWith("public/localai/") && !rel.endsWith(".png")) return "logo-mesh";
	if (rel.includes("/sponsors/")) return "sponsor";
	if (rel.includes("favicon")) return "icon";
	return ROLE_BY_EXT[extname(rel).toLowerCase()] ?? "binary";
}

const files = walk(join(root, "public"))
	.map((path) => {
		const rel = path.slice(root.length + 1).split("\\").join("/");
		const raw = readFileSync(path);
		return {
			path: rel,
			role: roleFor(rel),
			type: TYPE_BY_EXT[extname(rel).toLowerCase()] ?? "application/octet-stream",
			dimensions: dimensionsFor(rel, raw),
			bytes: raw.byteLength,
			sha256: createHash("sha256").update(raw).digest("hex"),
		};
	})
	.sort((a, b) => a.path.localeCompare(b.path));

const hashes = files.map((file) => file.sha256);
const duplicates = hashes.filter((hash, index) => hashes.indexOf(hash) !== index);
const uniqueDuplicates = [...new Set(duplicates)];
const duplicateGroups = uniqueDuplicates.map((hash) =>
	files.filter((file) => file.sha256 === hash).map((file) => file.path),
);

const body = `${JSON.stringify({ files, duplicateGroups }, null, "\t")}\n`;

if (command === "write") {
	writeFileSync(dest, body);
	console.log(`wrote asset-manifest.json (${files.length} files)`);
	if (duplicateGroups.length) {
		console.log(`duplicate content groups: ${duplicateGroups.length}`);
	}
} else if (command === "check") {
	const current = readFileSync(dest, "utf8");
	if (current !== body) {
		console.error("asset-manifest.json is stale; run pnpm assets:manifest");
		process.exit(1);
	}
	if (duplicateGroups.length) {
		console.error(`duplicate asset content is not allowlisted:\n${duplicateGroups.map((group) => group.join(" = ")).join("\n")}`);
		process.exit(1);
	}
	console.log(`asset-manifest.json ok (${files.length} files)`);
} else {
	console.error(`unknown command: ${command}`);
	process.exit(1);
}
