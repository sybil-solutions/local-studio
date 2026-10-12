import {
  ENGINE_ARG_SPECS,
  engineArgKey,
  type EngineArgType,
} from "@local-studio/contracts/engine-args";
import type { RecipeEditor } from "./recipe-editor";

export type { EngineArgType as ExtraArgType };

export type ExtraArgField = {
  field: keyof RecipeEditor;
  key: string;
  type: EngineArgType;
  aliases?: readonly string[];
};

export const EXTRA_ARG_FIELDS: readonly ExtraArgField[] = ENGINE_ARG_SPECS.map((spec) => ({
  field: spec.field,
  key: engineArgKey(spec.field),
  type: spec.type,
  ...("aliases" in spec ? { aliases: spec.aliases } : {}),
}));
