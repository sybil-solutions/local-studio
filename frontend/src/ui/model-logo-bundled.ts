/**
 * Owners whose avatar ships with the app, in `frontend/public/model-logos/`.
 *
 * The curated catalog is a known, fixed set of publishers, so their logos have
 * no business being fetched at runtime: the old path could not even *start* the
 * request until the catalog had loaded and the table had rendered (measured at
 * 492ms), then spent another 160-470ms per owner resolving an org avatar
 * through Hugging Face — so every cold load showed a row of coloured initials
 * flipping to logos. Serving them as static assets makes the first paint the
 * final paint, and works with no network at all.
 *
 * Unknown owners — anything found through Search Hugging Face — still resolve
 * through `/api/huggingface/avatar`, which caches and is fine for the long tail.
 *
 * To add one: drop `<owner>.webp` in `public/model-logos/` and add the exact
 * owner id here. The id must match Hugging Face's casing.
 */
const BUNDLED_OWNERS = new Set([
  "LiquidAI",
  "MiniMaxAI",
  "Motif-Technologies",
  "Qwen",
  "deepseek-ai",
  "google",
  "meta-llama",
  "microsoft",
  "mistralai",
  "moonshotai",
  "nvidia",
  "openai",
  "stepfun-ai",
  "tencent",
  "zai-org",
]);

/** The bundled asset path for an owner, or null when we do not ship one. */
export function bundledLogoUrl(owner: string | undefined | null): string | null {
  const trimmed = owner?.trim();
  if (!trimmed || !BUNDLED_OWNERS.has(trimmed)) return null;
  return `/model-logos/${trimmed}.webp`;
}
