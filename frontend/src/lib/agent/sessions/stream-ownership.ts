type RuntimePromptStreamOwner = {
  controller: AbortController;
  ownerId: string;
};

const runtimePromptStreams = new Map<string, RuntimePromptStreamOwner>();

export function claimRuntimePromptStream(
  runtimeSessionId: string,
  ownerId: string,
  controller: AbortController,
): void {
  const existing = runtimePromptStreams.get(runtimeSessionId);
  if (existing && existing.ownerId !== ownerId) {
    existing.controller.abort();
  }
  runtimePromptStreams.set(runtimeSessionId, { controller, ownerId });
}

export function releaseRuntimePromptStream(runtimeSessionId: string, ownerId: string): void {
  const existing = runtimePromptStreams.get(runtimeSessionId);
  if (existing?.ownerId === ownerId) {
    runtimePromptStreams.delete(runtimeSessionId);
  }
}

export function hasRuntimePromptStream(runtimeSessionId: string): boolean {
  return runtimePromptStreams.has(runtimeSessionId);
}
