// CRITICAL
/**
 * Shared service utilities and interfaces.
 */

export interface IService {
  readonly name: string;
}

/**
 * Generic retrieval service interface for project search.
 */
export interface IRetrievalService<TInput, TResult> extends IService {
  search(input: TInput): Promise<TResult>;
}

export interface IParser<TInput, TResult> extends IService {
  parse(input: TInput): TResult;
}

export interface ICacheableService<TKey, TValue> extends IService {
  getCached(key: TKey): TValue | null;
  invalidateCache(key?: TKey): void;
  readonly cacheSize: number;
}

export interface IServiceFactory<TConfig, TService extends IService> {
  create(config: TConfig): TService;
  createDefault?(): TService;
}

export class LRUCache<TKey, TValue> {
  private readonly maxSize: number;
  private readonly cache = new Map<TKey, TValue>();

  constructor(maxSize: number) {
    this.maxSize = Math.max(maxSize, 1);
  }

  get size(): number {
    return this.cache.size;
  }

  get(key: TKey): TValue | null {
    if (!this.cache.has(key)) {
      return null;
    }
    const value = this.cache.get(key) as TValue;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: TKey, value: TValue): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    if (this.cache.size > this.maxSize) {
      const oldestKey = this.cache.keys().next().value as TKey | undefined;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
  }

  delete(key: TKey): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

export function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}
