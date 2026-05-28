export type LlamacppOptionType = "text" | "number" | "boolean" | "select";

export type LlamacppOption = {
  key: string;
  label: string;
  type: LlamacppOptionType;
  tab: "model" | "resources" | "performance" | "features";
  placeholder?: string;
  options?: string[];
  description?: string;
};
