export default {
  entry: [
    "src/main.ts",
    "scripts/**/*.ts",
    "src/**/*.test.ts",
    "tests/**/*.test.ts",
  ],
  project: ["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"],
  ignore: [
    "bun.lockb",
    "node_modules/**",
    "dist/**",
    // Barrel/index files for module exports
    "src/**/index.ts",
  ],
  ignoreExportsUsedInFile: true,
  ignoreWorkspaces: [],
};
