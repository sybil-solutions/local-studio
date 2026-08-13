export function resolveFrontendRestartUrl(nextUrl: string, previousUrl?: string): string {
  if (!previousUrl) return nextUrl;

  try {
    const next = new URL(nextUrl);
    const previous = new URL(previousUrl);
    if (previous.protocol !== next.protocol || previous.hostname !== next.hostname) return nextUrl;

    next.pathname = previous.pathname;
    next.search = previous.search;
    next.hash = previous.hash;
    return next.toString();
  } catch {
    return nextUrl;
  }
}

export function shouldReloadAfterFrontendRestart(nextUrl: string, rendererUrl?: string): boolean {
  if (!rendererUrl) return true;
  try {
    return new URL(rendererUrl).origin !== new URL(nextUrl).origin;
  } catch {
    return true;
  }
}
