import { decodeGltfMesh } from "../mesh";

// Owns browser glTF fetch/decode for the Eve logo mesh.
// INVARIANT: dev no-store fetch behavior is preserved for HMR/content updates.
// Imported only by index.tsx startup.

const DEV_FETCH_OPTIONS = { cache: "no-store" } as const;

function meshFetchOptions() {
  return import.meta.env.PROD ? undefined : DEV_FETCH_OPTIONS;
}

export async function loadMesh(modelUrl: string) {
  const response = await fetch(modelUrl, meshFetchOptions());
  if (!response.ok) throw new Error(`Failed to load ${modelUrl}: ${response.status}`);
  return decodeGltfMesh(await response.json(), (uri) => loadGltfBuffer(uri, modelUrl));
}

async function loadGltfBuffer(uri: string, modelUrl: string) {
  if (uri.startsWith("data:application/octet-stream;base64,")) {
    return Uint8Array.from(atob(uri.split(",")[1]!), (char) => char.charCodeAt(0)).buffer;
  }
  const url = new URL(uri, window.location.origin + modelUrl);
  const response = await fetch(url, meshFetchOptions());
  if (!response.ok)
    throw new Error(`Failed to load glTF buffer ${url.pathname}: ${response.status}`);
  return response.arrayBuffer();
}
