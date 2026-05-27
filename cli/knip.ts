export default {
  entry: ["src/main.ts"],
  project: ["src/**/*.ts"],
  ignore: ["vllm-studio", "node_modules/**"],
  ignoreDependencies: ["bun-types"],
  ignoreExportsUsedInFile: true,
  rules: {
    exports: "off",
    types: "off",
  },
};
