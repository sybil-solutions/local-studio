import type { LlamacppOption } from "./llamacpp-options/types";
import { LLAMACPP_OPTIONS_PART_1A } from "./llamacpp-options/options-part-1a";
import { LLAMACPP_OPTIONS_PART_1B } from "./llamacpp-options/options-part-1b";
import { LLAMACPP_OPTIONS_PART_2 } from "./llamacpp-options/options-part-2";

export type { LlamacppOption, LlamacppOptionType } from "./llamacpp-options/types";

export const LLAMACPP_OPTIONS: LlamacppOption[] = [
  ...LLAMACPP_OPTIONS_PART_1A,
  ...LLAMACPP_OPTIONS_PART_1B,
  ...LLAMACPP_OPTIONS_PART_2,
];

export const LLAMACPP_OPTION_KEYS = LLAMACPP_OPTIONS.map((option) => option.key);
