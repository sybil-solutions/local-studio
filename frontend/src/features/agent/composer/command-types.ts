// The composer command contract. The core processor (command-registry.ts) only
// knows these shapes; every actual command — builtins, prompt templates, plugin
// skills — lives in an external provider that implements ComposerCommandProvider.

export type ComposerCommandContext = {
  running: boolean;
  compacting: boolean;
};

export type ComposerCommandOutcome =
  // Command consumed the whole input; composer resets to empty.
  | { kind: "handled" }
  // Command consumed its token but leaves text in the composer (e.g. a
  // template that keeps the user's trailing prompt).
  | { kind: "set-input"; input: string }
  | { kind: "error"; message: string };

export type ComposerCommand = {
  id: string;
  /** Slash token without the leading "/". Must be a single word. */
  name: string;
  title: string;
  description?: string;
  /** Where the command comes from — "core", a plugin source dir, etc. */
  source: string;
  /** Menu icon family; the UI maps this to an actual glyph. */
  icon: "command" | "template" | "skill";
  /** Omit or return true to list the command in the current context. */
  when?: (context: ComposerCommandContext) => boolean;
  run: (
    args: string,
    context: ComposerCommandContext,
  ) => Promise<ComposerCommandOutcome> | ComposerCommandOutcome;
};

export type ComposerCommandProvider = {
  id: string;
  commands: () => ComposerCommand[];
};
