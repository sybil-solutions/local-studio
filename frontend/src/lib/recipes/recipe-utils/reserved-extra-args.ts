import { LLAMACPP_OPTION_KEYS } from "../llamacpp-options";
import { EXTRA_ARG_FIELDS } from "./extra-arg-fields";

export const RESERVED_EXTRA_ARGS = new Set<string>();

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

["env_vars", "env-vars", "envVars", "status", "launch_command", "custom_command"].forEach(
  addReservedKeys,
);
["default-chat-template-kwargs", "default_chat_template_kwargs"].forEach(addReservedKeys);

for (const key of LLAMACPP_OPTION_KEYS) {
  addReservedKeys(key);
}
