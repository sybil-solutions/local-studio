#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import React from "react";
import { renderToPipeableStream } from "react-dom/server";
import { createServer } from "vite";

const projectRoot = new URL("../", import.meta.url).pathname;
const outputPath = new URL("../dist/index.html", import.meta.url);
const server = await createServer({
	root: projectRoot,
	server: { middlewareMode: true },
	appType: "custom",
	logLevel: "error",
});

try {
	const { HomePage } = await server.ssrLoadModule("/src/pages/HomePage.tsx");
	const markup = await new Promise((resolve, reject) => {
		let output = "";
		const destination = new PassThrough();
		destination.setEncoding("utf8");
		destination.on("data", (chunk) => {
			output += chunk;
		});
		destination.on("end", () => resolve(output));
		destination.on("error", reject);
		const stream = renderToPipeableStream(
			React.createElement(
				React.Suspense,
				{ fallback: null },
				React.createElement(HomePage),
			),
			{
				onAllReady() {
					stream.pipe(destination);
				},
				onError: reject,
			},
		);
	});
	const source = await readFile(outputPath, "utf8");
	const root = '<div id="root"></div>';
	if (!source.includes(root)) throw new Error("missing root");
	const routeGuard = '<script>if(location.pathname!=="/")document.getElementById("root").replaceChildren()</script>';
	const rendered = source.replace(
		root,
		`<div id="root">${markup}</div>${routeGuard}`,
	);
	await writeFile(outputPath, rendered);
	console.log("prerendered homepage");
} finally {
	await server.close();
}
process.exit(0);
