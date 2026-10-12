export async function register(): Promise<void> {
  // Node-only work (node:net tuning) lives in instrumentation-node.ts and is
  // loaded dynamically behind this gate, so the edge-runtime compile of this
  // file never resolves `node:net` (webpack dev errors on it otherwise).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { register: registerNode } = await import("./instrumentation-node");
  await registerNode();
}
