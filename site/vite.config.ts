import { createRequire } from "node:module";
import path from "node:path";
import { wgslVitePlugin } from "@vgpu/wgsl/loader-vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";
import { agentReady } from "./agent-ready.plugin.ts";

const root = import.meta.dirname;
// SAFETY: @stylexjs/unplugin 0.19 public types leak undeclared optional bundler packages; this assertion pins the exact official Vite adapter contract.
const stylex = createRequire(import.meta.url)("@stylexjs/unplugin/vite")
	.default as (options: {
	runtimeInjection: false;
	unstable_moduleResolution: { type: "commonJS"; rootDir: string };
	useCSSLayers: true;
}) => PluginOption;

export default defineConfig({
	appType: "spa",
	plugins: [
		stylex({
			runtimeInjection: false,
			unstable_moduleResolution: { type: "commonJS", rootDir: root },
			useCSSLayers: true,
		}),
		react(),
		wgslVitePlugin({ minify: true }),
		agentReady(),
	],
	resolve: {
		alias: [
			{
				find: "@local-ai/logo-renderer/react",
				replacement: path.resolve(
					root,
					"packages/logo-renderer/src/renderer/index.tsx",
				),
			},
		],
	},
});
