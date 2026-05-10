import type { PluginRow } from "./plugin-discovery";

export type PluginsResponse = {
  plugins: PluginRow[];
  validation: {
    browserUseAvailable: boolean;
    browserUse: PluginRow | null;
    computerUseAvailable: boolean;
    computerUse: PluginRow | null;
  };
};

export function buildPluginsResponse(
  allPlugins: PluginRow[],
  options: { includeDisabled?: boolean } = {},
): PluginsResponse {
  const plugins = options.includeDisabled ? allPlugins : allPlugins.filter((row) => row.enabled);
  const computerUse =
    plugins.find((row) => row.enabled && row.name.includes("computer-use")) ?? null;
  const browserUse = plugins.find((row) => row.enabled && row.name.includes("browser-use")) ?? null;
  return {
    plugins,
    validation: {
      browserUseAvailable: Boolean(browserUse),
      browserUse,
      computerUseAvailable: Boolean(computerUse),
      computerUse,
    },
  };
}
