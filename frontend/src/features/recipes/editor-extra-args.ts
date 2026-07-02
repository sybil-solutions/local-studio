import { INTERNAL_RECIPE_KEYS } from "@local-studio/contracts/engine-args";
import { LLAMACPP_OPTION_KEYS } from "./llamacpp-options";
import { MLX_OPTION_KEYS } from "./mlx-options";
import { EXTRA_ARG_FIELDS } from "./extra-arg-fields";

const RESERVED_EXTRA_ARGS = new Set<string>();

const addReservedKeys = (key: string): void => {
  RESERVED_EXTRA_ARGS.add(key);
  RESERVED_EXTRA_ARGS.add(key.replace(/-/g, "_"));
  RESERVED_EXTRA_ARGS.add(key.replace(/_/g, "-"));
};

for (const field of EXTRA_ARG_FIELDS) {
  addReservedKeys(field.key);
  if (field.aliases) {
    for (const alias of field.aliases) {
      addReservedKeys(alias);
    }
  }
}

for (const key of INTERNAL_RECIPE_KEYS) {
  addReservedKeys(key);
}

["envVars", "default-chat-template-kwargs"].forEach(addReservedKeys);

for (const key of LLAMACPP_OPTION_KEYS) {
  addReservedKeys(key);
}

for (const key of MLX_OPTION_KEYS) {
  addReservedKeys(key);
}

export const filterExtraArgsForEditor = (
  extraArgs: Record<string, unknown>,
): Record<string, unknown> => {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extraArgs ?? {})) {
    if (!RESERVED_EXTRA_ARGS.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
};

export const mergeExtraArgsFromEditor = (
  extraArgs: Record<string, unknown>,
  editorArgs: Record<string, unknown>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...extraArgs };
  for (const key of Object.keys(merged)) {
    if (!RESERVED_EXTRA_ARGS.has(key)) {
      delete merged[key];
    }
  }
  for (const [key, value] of Object.entries(editorArgs ?? {})) {
    merged[key] = value;
  }
  return merged;
};
