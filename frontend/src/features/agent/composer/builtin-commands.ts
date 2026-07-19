// Built-in slash commands. External to the core processor: this module only
// produces a ComposerCommandProvider from an injected actions surface, so the
// registry never knows what "/compact" means — and a pane that lacks an action
// (no terminal, nothing to export) simply doesn't list that command.
import type { ComposerCommand, ComposerCommandProvider } from "./command-types";

export type BuiltinComposerActions = {
  compact: () => void;
  openStatus: () => void;
  toggleBrowserTool: () => void;
  toggleCanvas: () => void;
  openPlugins: () => void;
  openTerminal?: () => void;
  forkSession?: () => void;
  exportSession?: () => void;
};

export function builtinCommandProvider(actions: BuiltinComposerActions): ComposerCommandProvider {
  const command = (
    name: string,
    title: string,
    description: string,
    run: (() => void) | undefined,
    when?: ComposerCommand["when"],
  ): ComposerCommand[] =>
    run
      ? [
          {
            id: `builtin:${name}`,
            name,
            title,
            description,
            source: "core",
            icon: "command",
            when,
            run: () => {
              run();
              return { kind: "handled" as const };
            },
          },
        ]
      : [];

  return {
    id: "builtin",
    commands: () => [
      ...command(
        "compact",
        "Compact",
        "Compact this chat's context",
        actions.compact,
        (context) => !context.running && !context.compacting,
      ),
      ...command("status", "Status", "Open the status panel", actions.openStatus),
      ...command("browser", "Browser", "Toggle the browser tool", actions.toggleBrowserTool),
      ...command("canvas", "Canvas", "Toggle the shared canvas", actions.toggleCanvas),
      ...command("plugins", "Plugins", "Manage plugins and connectors", actions.openPlugins),
      ...command("terminal", "Terminal", "Open the terminal", actions.openTerminal),
      ...command("fork", "Fork", "Fork this session into a new pane", actions.forkSession),
      ...command("export", "Export", "Export this session as Markdown", actions.exportSession),
    ],
  };
}
