export type ExecutableIdentityAlgorithm = "macho-unsigned-v1" | "pe-authenticode-v1" | "sha256-v1";

export type ExecutableIdentity = {
  algorithm: ExecutableIdentityAlgorithm;
  digest: string;
};

export const AUDITED_NODE_IDENTITIES: Readonly<Record<string, ExecutableIdentity>>;
export const AUDITED_NODE_EXECUTABLE_SHA256: Readonly<Record<string, string>>;
export const AUDITED_WINDOWS_HELPER_BUILD: Readonly<{
  format: string;
  target: string;
  zigVersion: string;
  arguments: readonly string[];
  sourceSha256: string;
  binarySha256: string;
  codeIdentity: ExecutableIdentity;
}>;
export const AUDITED_WINDOWS_HELPER_IDENTITY: ExecutableIdentity;

export function authenticodeSignaturePresent(bytes: Uint8Array): boolean;

export function executableSignaturePresent(bytes: Uint8Array, platform: NodeJS.Platform): boolean;

export function signingStableExecutableIdentity(
  bytes: Uint8Array,
  platform: NodeJS.Platform,
): ExecutableIdentity;
