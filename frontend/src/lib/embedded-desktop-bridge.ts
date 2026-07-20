type LocalStudioDesktopBridge = NonNullable<Window["localStudioDesktop"]>;

export async function embeddedDesktopBridge(): Promise<LocalStudioDesktopBridge | null> {
  if (typeof window === "undefined") return null;
  const desktop = window.localStudioDesktop;
  if (!desktop) return null;
  const runtime = await desktop.getRuntime();
  return runtime.mode === "embedded-standalone" ? desktop : null;
}

export function decodeDesktopBridgeJson<A>(payload: string, decode: (input: unknown) => A): A {
  try {
    return decode(JSON.parse(payload));
  } catch {
    throw new Error("Embedded desktop returned an invalid response");
  }
}
