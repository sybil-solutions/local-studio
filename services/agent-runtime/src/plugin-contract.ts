import { Schema } from "effect";

/**
 * The wire shape of a user-authored plugin.
 *
 * "Plugin" is the word the app uses for what pi calls an extension: a single
 * TypeScript module that pi loads at session start and that registers tools.
 * The runtime discovers them from `<agentDir>/extensions`, so this contract
 * describes files on disk rather than rows in a database — `file` is the real
 * basename, kept because it is what enable/disable renames and what the user
 * sees in a `ls`.
 */
const PluginFields = {
  id: Schema.String,
  file: Schema.String,
  path: Schema.String,
  enabled: Schema.Boolean,
  bytes: Schema.Number,
  updated_at: Schema.String,
  /**
   * True for anything this surface can list but must not rewrite: directory
   * extensions, package manifests, and the bundled extensions, which pi loads
   * but which are not a single editable file. Listing them anyway is the point
   * — a plugin page that hides half of what actually runs is worse than no
   * page.
   */
  read_only: Schema.Boolean,
  /** True for the extensions this app ships and loads on every session build. */
  builtin: Schema.optional(Schema.Boolean),
  /** One line of honest state for a builtin: what makes it load, or not. */
  note: Schema.optional(Schema.String),
};

export const PluginRowSchema = Schema.Struct(PluginFields);

export const PluginsResponseSchema = Schema.Struct({
  directory: Schema.String,
  plugins: Schema.Array(PluginRowSchema),
});

export const PluginSourceResponseSchema = Schema.Struct({
  plugin: PluginRowSchema,
  source: Schema.String,
});

export const PluginUpsertInputSchema = Schema.Struct({
  id: Schema.String,
  source: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
});

export type PluginRow = typeof PluginRowSchema.Type;

/** Lowercase, hyphenated, and short: the id is also the filename. */
export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const isValidPluginId = (id: string): boolean => PLUGIN_ID_PATTERN.test(id);

/**
 * What a brand-new plugin starts as.
 *
 * Deliberately a working tool rather than a commented-out skeleton: the first
 * thing anyone does with a code editor they have never seen is press Save, and
 * a file that registers one honest tool proves the whole loop — write, save,
 * send a message, watch the model call it — before any of it has to be
 * explained. The comments then say the two things that are not guessable: where
 * the file lives, and that pi compiles the TypeScript itself.
 */
export const PLUGIN_TEMPLATE = `// A Local Studio plugin is a pi extension: one TypeScript module that
// registers tools onto every agent session. It lives in the agent's
// extensions directory and is compiled on load, so there is nothing to build.
//
// Edit, save, and send your next message — the session rebuilds and the tools
// below are registered. Anything this file does runs inside the agent process
// with your own permissions.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "hello_world",
    label: "Hello world",
    description: "Greets someone by name. Replace this with something useful.",
    parameters: Type.Object({
      name: Type.String({ description: "Who to greet." }),
    }),
    // execute(toolCallId, params, signal, onUpdate, ctx) — the id comes first.
    execute: (_id, params) =>
      Promise.resolve({
        content: [{ type: "text", text: \`Hello, \${params.name}!\` }],
        details: { name: params.name },
      }),
  });
}
`;
