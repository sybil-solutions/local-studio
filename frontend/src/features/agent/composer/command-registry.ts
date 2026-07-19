// The minimal composer command processor: parse a "/name args" invocation,
// aggregate commands from registered providers, and dispatch. Pure TS — no
// React, no fetch, no knowledge of any concrete command.
import { byQuery } from "@/features/agent/composer-context";
import type {
  ComposerCommand,
  ComposerCommandContext,
  ComposerCommandOutcome,
  ComposerCommandProvider,
} from "./command-types";

export type SlashInvocation = { name: string; args: string };

export function parseSlashInvocation(input: string): SlashInvocation | null {
  const match = /^\/([\w][\w.:-]*)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

export type ComposerCommandRegistry = {
  list: (context: ComposerCommandContext) => ComposerCommand[];
  find: (name: string, context: ComposerCommandContext) => ComposerCommand | null;
  match: (query: string, context: ComposerCommandContext, limit?: number) => ComposerCommand[];
  execute: (
    invocation: SlashInvocation,
    context: ComposerCommandContext,
  ) => Promise<ComposerCommandOutcome> | null;
};

export function createComposerCommandRegistry(
  providers: ComposerCommandProvider[],
): ComposerCommandRegistry {
  const list = (context: ComposerCommandContext): ComposerCommand[] => {
    const seen = new Set<string>();
    const commands: ComposerCommand[] = [];
    for (const provider of providers) {
      for (const command of provider.commands()) {
        const key = command.name.toLowerCase();
        if (seen.has(key)) continue;
        if (command.when && !command.when(context)) continue;
        seen.add(key);
        commands.push(command);
      }
    }
    return commands;
  };

  const find = (name: string, context: ComposerCommandContext): ComposerCommand | null => {
    const key = name.toLowerCase();
    return list(context).find((command) => command.name.toLowerCase() === key) ?? null;
  };

  const match = (query: string, context: ComposerCommandContext, limit = 8): ComposerCommand[] => {
    const commands = list(context);
    // Empty query keeps provider order (builtins → templates → skills) so core
    // commands lead the menu; byQuery would sort the whole set alphabetically.
    if (!query.trim()) return commands.slice(0, limit);
    const rows = commands.map((command) => ({
      name: command.name,
      displayName: command.title,
      source: command.source,
      shortDescription: command.description,
      command,
    }));
    return byQuery(rows, query, limit).map((row) => row.command);
  };

  const execute = (invocation: SlashInvocation, context: ComposerCommandContext) => {
    const command = find(invocation.name, context);
    if (!command) return null;
    return Promise.resolve(command.run(invocation.args, context)).catch(
      (error): ComposerCommandOutcome => ({
        kind: "error",
        message: error instanceof Error ? error.message : `/${command.name} failed`,
      }),
    );
  };

  return { list, find, match, execute };
}
