export const extractCudaVersion = (output: string): string | null => {
  const match = output.match(/CUDA (?:UMD )?Version\s*:\s*([0-9.]+)/i);
  if (match) return match[1] ?? null;
  return null;
};
