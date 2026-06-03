import type { HuggingFaceModel } from "@/lib/types";

export async function fetchHuggingFaceModels(params: URLSearchParams): Promise<HuggingFaceModel[]> {
  const query = params.toString();
  const proxyUrl = `/api/proxy/v1/huggingface/models?${query}`;
  const directUrl = `/api/huggingface/models?${query}`;
  const proxyResponse = await fetch(proxyUrl);
  if (proxyResponse.ok) return (await proxyResponse.json()) as HuggingFaceModel[];

  const directResponse = await fetch(directUrl, { cache: "no-store" });
  if (directResponse.ok) return (await directResponse.json()) as HuggingFaceModel[];

  const proxyError = await proxyResponse
    .json()
    .catch(() => ({ detail: "Controller proxy failed" }));
  const directError = await directResponse
    .json()
    .catch(() => ({ error: "Direct Hugging Face fallback failed" }));
  throw new Error(
    directError.error || directError.detail || proxyError.detail || "Failed to fetch models",
  );
}
