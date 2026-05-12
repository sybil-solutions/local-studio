// CRITICAL
// Frontend uses extensive barrel exports (index.ts) which knip doesn't handle well.
// This config is deliberately lenient to avoid false positives.
const config = {
  entry: ["src/app/**/*.{ts,tsx}", "desktop/**/*.{ts,tsx}"],
  project: ["src/**/*.{ts,tsx}", "desktop/**/*.{ts,tsx}"],
  ignore: [
    ".next/**",
    "node_modules/**",
    ".husky/**",
    "playwright-report/**",
    "**/*.test.ts",
    "**/*.test.tsx",
  ],
  // Some tooling is used implicitly (CSS/postcss pipeline, git hooks), which knip can't reliably
  // infer from source imports. Keep this list small and intentional.
  ignoreDependencies: ["tailwindcss", "postcss", "husky", "enhanced-resolve"],
  ignoreExportsUsedInFile: true,
};

export default config;
