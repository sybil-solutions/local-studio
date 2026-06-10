export default {
  entry: ["src/main.ts"],
  project: ["src/**/*.ts"],
  ignore: ["vllm-studio", "node_modules/**"],
  ignoreExportsUsedInFile: true,
};
