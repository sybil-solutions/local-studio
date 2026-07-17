const runtimeFrontendOriginKey = Symbol.for("local-studio.runtime.frontend-origin");
const defaultFrontendOrigin = "http://127.0.0.1:3000";

type RuntimeScope = typeof globalThis & { [key: symbol]: unknown };

export function setRuntimeFrontendOrigin(origin: string): void {
  (globalThis as RuntimeScope)[runtimeFrontendOriginKey] = origin;
}

export function runtimeFrontendOrigin(): string {
  const origin = (globalThis as RuntimeScope)[runtimeFrontendOriginKey];
  return typeof origin === "string" && origin ? origin : defaultFrontendOrigin;
}
