// CRITICAL

const escapeRegex = (value: string): string => value.replace(/[.+^${}()|[\]\\]/g, "\\$&");

const compileGlob = (pattern: string): RegExp => {
  const escaped = escapeRegex(pattern);
  const regex = "^" + escaped.replace(/\*/g, ".*") + "$";
  return new RegExp(regex, "i");
};

export const matchesAny = (value: string, patterns: string[]): boolean => {
  if (patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => compileGlob(pattern).test(value));
};

