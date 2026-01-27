export const safeJsonStringify = (value: unknown, fallback?: string): string => {
  const fallbackValue = fallback ?? (value == null ? "" : String(value));

  try {
    const seen = new WeakSet<object>();
    const result = JSON.stringify(value, (_key, val) => {
      if (typeof val === "bigint") {
        return val.toString();
      }
      if (typeof val === "function") {
        return `[Function ${val.name || "anonymous"}]`;
      }
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) {
          return "[Circular]";
        }
        seen.add(val);
        if (val instanceof Map) {
          return Object.fromEntries(val);
        }
        if (val instanceof Set) {
          return Array.from(val);
        }
      }
      return val;
    });
    return result ?? fallbackValue;
  } catch {
    return fallbackValue;
  }
};
