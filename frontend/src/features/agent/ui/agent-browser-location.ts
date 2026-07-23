export type BrowserLocationUpdate = {
  emittedUrl: string;
  location: string | null;
};

export function browserLocationUpdate(
  emittedUrl: string,
  observedUrl: string,
): BrowserLocationUpdate {
  if (!observedUrl || emittedUrl === observedUrl) {
    return { emittedUrl, location: null };
  }
  return { emittedUrl: observedUrl, location: observedUrl };
}
