const cache = new Map<string, unknown>();

export function readPageCache<T>(key: string): T | null {
  return (cache.get(key) as T | undefined) ?? null;
}

export function writePageCache<T>(key: string, value: T): void {
  cache.set(key, value);
}
