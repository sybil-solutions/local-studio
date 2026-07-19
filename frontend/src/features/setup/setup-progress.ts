import { Schema } from "effect";
import { scheduleDurableUiPreferencesSave } from "@/lib/desktop-ui-preferences";
import type { StarterPreset } from "@/lib/types";

const SETUP_PROGRESS_KEY = "local-studio-setup-progress";

const StarterPresetSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  kind: Schema.Literals(["download", "remote"]),
  tags: Schema.Array(Schema.String),
  size_gb: Schema.NullOr(Schema.Number),
  min_vram_gb: Schema.NullOr(Schema.Number),
  model_id: Schema.optional(Schema.String),
  allow_patterns: Schema.optional(Schema.Array(Schema.String)),
  backend: Schema.optional(Schema.Literals(["vllm", "llamacpp"])),
  gguf_file: Schema.optional(Schema.String),
  recipe_overrides: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  remote: Schema.optional(
    Schema.Struct({
      base_url: Schema.String,
      model: Schema.String,
    }),
  ),
  fits: Schema.optional(Schema.Boolean),
});

const SetupProgressSchema = Schema.Struct({
  step: Schema.Number,
  hardwareConfirmed: Schema.Boolean,
  selectedModel: Schema.String,
  manualModelId: Schema.String,
  selectedPreset: Schema.NullOr(StarterPresetSchema),
  createdRecipeId: Schema.NullOr(Schema.String),
});

export interface SetupProgress {
  step: number;
  hardwareConfirmed: boolean;
  selectedModel: string;
  manualModelId: string;
  selectedPreset: StarterPreset | null;
  createdRecipeId: string | null;
}

const DEFAULT_SETUP_PROGRESS: SetupProgress = {
  step: 0,
  hardwareConfirmed: false,
  selectedModel: "",
  manualModelId: "",
  selectedPreset: null,
  createdRecipeId: null,
};

export function decodeSetupProgress(value: unknown): SetupProgress {
  try {
    const decoded = Schema.decodeUnknownSync(SetupProgressSchema)(value);
    return {
      ...decoded,
      step: Math.max(0, Math.min(5, Math.trunc(decoded.step))),
      selectedPreset: decoded.selectedPreset as StarterPreset | null,
    };
  } catch {
    return DEFAULT_SETUP_PROGRESS;
  }
}

export function loadSetupProgress(): SetupProgress {
  if (typeof window === "undefined") return DEFAULT_SETUP_PROGRESS;
  try {
    const stored = window.localStorage.getItem(SETUP_PROGRESS_KEY);
    return stored ? decodeSetupProgress(JSON.parse(stored)) : DEFAULT_SETUP_PROGRESS;
  } catch {
    return DEFAULT_SETUP_PROGRESS;
  }
}

export function updateSetupProgress(updates: Partial<SetupProgress>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SETUP_PROGRESS_KEY,
      JSON.stringify({ ...loadSetupProgress(), ...updates }),
    );
    scheduleDurableUiPreferencesSave();
  } catch {}
}

export function clearSetupProgress(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SETUP_PROGRESS_KEY);
    scheduleDurableUiPreferencesSave();
  } catch {}
}
