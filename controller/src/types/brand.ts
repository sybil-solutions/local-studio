export type Brand<Primitive, Label extends string> = Primitive & {
  readonly __brand: Label;
};

export type RecipeId = Brand<string, "RecipeId">;

export type SessionId = Brand<string, "SessionId">;

export const asRecipeId = (value: string): RecipeId => value as RecipeId;

export const asSessionId = (value: string): SessionId => value as SessionId;
