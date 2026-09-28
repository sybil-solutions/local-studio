import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = process.env.LOCAL_STUDIO_URL ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { proxy: { "/api": target, "/v1": target, "/health": target } },
});
