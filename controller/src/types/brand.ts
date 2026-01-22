/**
 * Branded type helper for nominal typing.
 */
export type Brand<Primitive, Label extends string> = Primitive & {
  readonly __brand: Label;
};

/**
 * Branded identifier for recipes.
 */
export type RecipeId = Brand<string, "RecipeId">;

/**
 * Branded identifier for chat sessions.
 */
export type SessionId = Brand<string, "SessionId">;

/**
 * Branded identifier for MCP servers.
 */
export type McpServerId = Brand<string, "McpServerId">;

/**
 * Cast a string to a branded recipe id.
 * @param value - Raw identifier.
 * @returns Branded recipe id.
 */
export const asRecipeId = (value: string): RecipeId => value as RecipeId;

/**
 * Cast a string to a branded session id.
 * @param value - Raw identifier.
 * @returns Branded session id.
 */
export const asSessionId = (value: string): SessionId => value as SessionId;

/**
 * Cast a string to a branded MCP server id.
 * @param value - Raw identifier.
 * @returns Branded MCP server id.
 */
export const asMcpServerId = (value: string): McpServerId => value as McpServerId;
