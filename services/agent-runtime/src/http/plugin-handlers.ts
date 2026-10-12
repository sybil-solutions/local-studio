//
// HTTP surface for user plugins: the listing, source reads, writes, enable
// flips, and removal. Moved verbatim from the Next route handlers so plugins
// authored in the UI land in the runtime's extensions directory — the one the
// agent actually loads from.
//

import { Schema } from "effect";
import { listBuiltinPlugins } from "../builtin-plugins";
import { PluginUpsertInputSchema } from "../plugin-contract";
import {
  listUserPlugins,
  readUserPlugin,
  removeUserPlugin,
  resolveUserPluginsDir,
  setUserPluginEnabled,
  writeUserPlugin,
} from "../user-plugins";

const failure = (error: unknown, fallback: string, status: number) =>
  Response.json({ error: error instanceof Error ? error.message : fallback }, { status });

async function listing(): Promise<Response> {
  // Builtins first: the page groups them apart, and on a fresh install they
  // are the difference between "nine extensions run every session" and a
  // blank table that reads as a missing feature.
  const [builtin, user] = await Promise.all([listBuiltinPlugins(), listUserPlugins()]);
  return Response.json({
    directory: resolveUserPluginsDir(),
    plugins: [...builtin, ...user],
  });
}

export async function handlePluginsList(): Promise<Response> {
  return listing();
}

/**
 * Write a plugin's source, flip it on or off, or both.
 *
 * Writing is not running: the file lands in the extensions directory and is
 * picked up the next time a session is built, which is also the next time the
 * user sends a message. Nothing is spawned here.
 */
export async function handlePluginUpsert(request: Request): Promise<Response> {
  let body: typeof PluginUpsertInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(PluginUpsertInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "invalid plugin payload" }, { status: 400 });
  }
  try {
    if (body.source !== undefined) await writeUserPlugin(body.id, body.source);
    if (body.enabled !== undefined) await setUserPluginEnabled(body.id, body.enabled);
    return listing();
  } catch (error) {
    return failure(error, "Plugin could not be saved", 409);
  }
}

export async function handlePluginDelete(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  try {
    await removeUserPlugin(id);
    return listing();
  } catch (error) {
    return failure(error, "Plugin could not be removed", 409);
  }
}

/**
 * One plugin's source. Split from the listing route because a list of plugins
 * is read on every visit to the tab while the code behind them is read only
 * when one is opened, and shipping every file's text to draw a table of names
 * would make the tab slower the more plugins a user writes.
 */
export async function handlePluginSource(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  try {
    return Response.json(await readUserPlugin(id));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Plugin could not be read" },
      { status: 404 },
    );
  }
}
