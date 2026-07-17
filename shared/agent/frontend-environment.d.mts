export type MutableEnvironment = Record<string, string | undefined>;

export function isReservedFrontendEnvironmentKey(name: string): boolean;
export function scrubReservedFrontendEnvironment<T extends MutableEnvironment>(environment: T): T;
export function frontendSafeEnvironment<T extends MutableEnvironment>(environment: T): T;
