/** Recipe extra_args lookup tolerant of kebab/snake spellings. */

export const getExtraArgument = (
  extraArguments: Record<string, unknown>,
  key: string,
): unknown => {
  if (Object.prototype.hasOwnProperty.call(extraArguments, key)) return extraArguments[key];
  const kebab = key.replace(/_/g, "-");
  if (Object.prototype.hasOwnProperty.call(extraArguments, kebab)) return extraArguments[kebab];
  const snake = key.replace(/-/g, "_");
  return Object.prototype.hasOwnProperty.call(extraArguments, snake)
    ? extraArguments[snake]
    : undefined;
};
