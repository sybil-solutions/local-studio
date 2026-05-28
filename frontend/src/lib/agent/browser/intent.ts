const BROWSER_INTENT_PATTERNS = [
  /\b(browse|browser|web|website|webpage|page|site|url|link)\b/i,
  /\b(open|navigate|go to|visit)\b.+\b(browser|web|website|webpage|page|site|url|link)\b/i,
  /\b(search|google|look up|lookup|find)\b.+\b(online|on the web|web|website|site|latest|current|today|news)\b/i,
];

export function promptRequestsBrowser(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return BROWSER_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}
