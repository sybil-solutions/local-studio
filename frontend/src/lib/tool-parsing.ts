// CRITICAL
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const extractLastJsonValue = (text: string): unknown => {
  const raw = (text || '').trim();
  if (!raw) return undefined;

  let lastParsed: unknown = undefined;
  for (let start = 0; start < raw.length; start++) {
    const startChar = raw[start];
    if (startChar !== '{' && startChar !== '[') continue;
    const endChar = startChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === startChar) depth++;
      if (ch === endChar) depth--;

      if (depth === 0) {
        const candidate = raw.slice(start, i + 1);
        try {
          lastParsed = JSON.parse(candidate);
        } catch {
          // ignore
        }
        break;
      }
    }
  }
  return lastParsed;
};

export const normalizeToolArgumentsJson = (raw: string): string => {
  const text = (raw || '').trim();
  if (!text) return '{}';

  try {
    const parsed = JSON.parse(text) as unknown;
    if (isPlainObject(parsed)) return JSON.stringify(parsed);
    return JSON.stringify({ input: parsed });
  } catch {
    const extracted = extractLastJsonValue(text);
    if (extracted !== undefined) {
      if (isPlainObject(extracted)) return JSON.stringify(extracted);
      return JSON.stringify({ input: extracted });
    }

    const m = text.match(/^[a-zA-Z0-9_.:-]+\s*\(([\s\S]*)\)\s*$/);
    if (m) {
      const inside = (m[1] || '').trim();
      if (inside) {
        try {
          const parsed = JSON.parse(inside) as unknown;
          if (isPlainObject(parsed)) return JSON.stringify(parsed);
          return JSON.stringify({ input: parsed });
        } catch {
          const extractedInside = extractLastJsonValue(inside);
          if (extractedInside !== undefined) {
            if (isPlainObject(extractedInside)) return JSON.stringify(extractedInside);
            return JSON.stringify({ input: extractedInside });
          }
        }
      }
    }

    return JSON.stringify({ raw: text });
  }
};

export const isCompleteJson = (text: string): boolean => {
  const t = (text || '').trim();
  if (!t) return false;
  if (!(t.startsWith('{') || t.startsWith('['))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
};

export const mergeToolCallArguments = (existing: string, incoming: string): string => {
  const prev = existing || '';
  const next = incoming || '';
  if (!next) return prev;
  if (!prev) return next;
  if (prev === next) return prev;
  if (isCompleteJson(next)) return next.trim();
  if (prev.endsWith(next)) return prev;
  if (next.startsWith(prev)) return next;
  if (prev.startsWith(next)) return prev;
  return prev + next;
};

