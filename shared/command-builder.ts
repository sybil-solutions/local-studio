/**
 * Shared command serialization helpers for recipe launch-command construction.
 *
 * This module intentionally contains ONLY the duplicated extra-args iteration
 * cores (internal-key filtering, JSON-string handling, boolean/array/object
 * emission). Per-side behavior that differs (shell quoting vs argv elements,
 * JSON-key normalization, backend-only internal keys, boolean-false
 * exceptions) is controlled by options so that emitted flags stay
 * byte-identical.
 *
 * The key normalizer here is snake_case, matching the existing frontend
 * (`extra-args.ts`) and controller (`backend-builder.ts`) internal-key lookup.
 * It is deliberately NOT the kebab-case `normalizeEngineArgKey` in
 * `shared/contracts/engine-args.ts`; using the kebab-case normalizer would not
 * change any emitted flag, but it would be an unnecessary behavioral shift in
 * the lookup layer.
 */

/** Internal keys filtered for the vLLM/SGLang extra-args loop. */
export const INTERNAL_EXTRA_ARG_KEYS: Readonly<Record<string, true>> = {
  venv_path: true,
  env_vars: true,
  visible_devices: true,
  cuda_visible_devices: true,
  hip_visible_devices: true,
  rocr_visible_devices: true,
  description: true,
  tags: true,
  status: true,
  launch_command: true,
  custom_command: true,
};

/** Internal keys filtered for the llama.cpp extra-args loop. */
export const INTERNAL_LLAMACPP_EXTRA_ARG_KEYS: Readonly<Record<string, true>> = {
  venv_path: true,
  env_vars: true,
  visible_devices: true,
  cuda_visible_devices: true,
  hip_visible_devices: true,
  rocr_visible_devices: true,
  description: true,
  tags: true,
  status: true,
};

/** Extra-arg keys whose string values are parsed as JSON before emission. */
export const JSON_STRING_EXTRA_ARG_KEYS: Readonly<Record<string, true>> = {
  speculative_config: true,
  default_chat_template_kwargs: true,
};

export interface AppendExtraArgsOptions {
  /** Additional keys to treat as internal/filtered beyond the shared base set. */
  extraInternalKeys?: ReadonlySet<string>;
  /** If `true` (default), boolean `false` values emit the flag. */
  emitFalseBooleans?: boolean;
  /** Normalized internal keys for which boolean `false` must NOT emit the flag. */
  falseBooleanExceptions?: ReadonlySet<string>;
  /** If `true`, emit values as shell-quoted single strings for preview. */
  shellQuoting?: boolean;
  /** Optional JSON-value normalizer (controller uses `normalizeJsonArgument`). */
  normalizeJson?: (value: unknown) => unknown;
  /** If `true`, skip empty string values. */
  skipEmptyString?: boolean;
}

/**
 * Append vLLM/SGLang-style extra arguments to an existing arg list.
 *
 * Arrays and objects are emitted as a single JSON blob. Boolean `false` emits
 * the flag by default (matching current controller behavior), except for keys
 * listed in `falseBooleanExceptions`.
 */
export const appendExtraArguments = (
  args: string[],
  extraArgs: Record<string, unknown>,
  options: AppendExtraArgsOptions = {},
): string[] => {
  const {
    extraInternalKeys,
    emitFalseBooleans = true,
    falseBooleanExceptions = new Set<string>(),
    shellQuoting = false,
    normalizeJson,
    skipEmptyString = false,
  } = options;

  const hasFlag = shellQuoting
    ? (flag: string): boolean => {
        const existingFlags = new Set(
          args
            .flatMap((line) => line.split(" "))
            .filter((part) => part.startsWith("--")),
        );
        return existingFlags.has(flag);
      }
    : (flag: string): boolean => args.includes(flag);

  for (const [key, value] of Object.entries(extraArgs)) {
    const normalizedKey = key.replace(/-/g, "_").toLowerCase();
    if (INTERNAL_EXTRA_ARG_KEYS[normalizedKey]) {
      continue;
    }
    if (extraInternalKeys?.has(normalizedKey)) {
      continue;
    }

    const flag = `--${key.replace(/_/g, "-")}`;
    if (hasFlag(flag)) {
      continue;
    }

    if (value === true) {
      args.push(flag);
      continue;
    }

    if (value === false) {
      if (emitFalseBooleans && !falseBooleanExceptions.has(normalizedKey)) {
        args.push(flag);
      }
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    if (skipEmptyString && value === "") {
      continue;
    }

    if (
      typeof value === "string" &&
      JSON_STRING_EXTRA_ARG_KEYS[normalizedKey]
    ) {
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          const normalized = normalizeJson ? normalizeJson(parsed) : parsed;
          pushQuoted(args, flag, JSON.stringify(normalized), shellQuoting);
          continue;
        } catch {
          pushQuoted(args, flag, value, shellQuoting);
          continue;
        }
      }
    }

    if (Array.isArray(value) || (value && typeof value === "object")) {
      const normalized = normalizeJson ? normalizeJson(value) : value;
      pushQuoted(args, flag, JSON.stringify(normalized), shellQuoting);
      continue;
    }

    pushUnquoted(args, flag, String(value), shellQuoting);
  }

  return args;
};

/**
 * Append llama.cpp-style extra arguments to an existing arg list.
 *
 * Arrays are iterated and each non-empty element is emitted separately.
 * Boolean `false` is always skipped (matching both frontend and controller
 * llama.cpp behavior).
 */
export const appendLlamacppExtraArguments = (
  args: string[],
  extraArgs: Record<string, unknown>,
  options: AppendExtraArgsOptions = {},
): string[] => {
  const { extraInternalKeys, shellQuoting = false, skipEmptyString = false } =
    options;

  const hasFlag = shellQuoting
    ? (flag: string): boolean => args.some((entry) => entry.startsWith(flag))
    : (flag: string): boolean => args.includes(flag);

  for (const [key, value] of Object.entries(extraArgs)) {
    const normalizedKey = key.replace(/-/g, "_").toLowerCase();
    if (INTERNAL_LLAMACPP_EXTRA_ARG_KEYS[normalizedKey]) {
      continue;
    }
    if (extraInternalKeys?.has(normalizedKey)) {
      continue;
    }

    const flag = `--${key.replace(/_/g, "-")}`;
    if (hasFlag(flag)) {
      continue;
    }

    if (value === true) {
      args.push(flag);
      continue;
    }

    if (value === false) {
      continue;
    }

    if (
      value === undefined ||
      value === null ||
      (skipEmptyString && value === "")
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (
          entry === undefined ||
          entry === null ||
          (skipEmptyString && entry === "")
        ) {
          continue;
        }
        pushUnquoted(args, flag, String(entry), shellQuoting);
      }
      continue;
    }

    if (typeof value === "object") {
      pushQuoted(args, flag, JSON.stringify(value), shellQuoting);
      continue;
    }

    pushUnquoted(args, flag, String(value), shellQuoting);
  }

  return args;
};

const pushQuoted = (
  args: string[],
  flag: string,
  value: string,
  shellQuoting: boolean,
): void => {
  if (shellQuoting) {
    args.push(`${flag} '${value}'`);
  } else {
    args.push(flag, value);
  }
};

const pushUnquoted = (
  args: string[],
  flag: string,
  value: string,
  shellQuoting: boolean,
): void => {
  if (shellQuoting) {
    args.push(`${flag} ${value}`);
  } else {
    args.push(flag, value);
  }
};
