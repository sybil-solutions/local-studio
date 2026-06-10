export default {
  entry: ["src/main.ts", "scripts/**/*.ts"],
  project: ["src/**/*.ts", "scripts/**/*.ts"],
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
