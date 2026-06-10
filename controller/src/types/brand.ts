export type Brand<Primitive, Label extends string> = Primitive & {
  readonly __brand: Label;
};

export type RecipeId = Brand<string, "RecipeId">;

export const asRecipeId = (value: string): RecipeId => value as RecipeId;
