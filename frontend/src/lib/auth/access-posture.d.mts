export type AccessEnvironment = Readonly<Record<string, string | undefined>>;

export type AccessDecision =
  | {
      readonly kind: "allow";
      readonly reason: "desktop" | "development" | "explicit-unauthenticated";
    }
  | { readonly kind: "require-token"; readonly token: string }
  | { readonly kind: "configuration-error"; readonly message: string };

export function resolveAccessPostureFromEnvironment(
  environment: AccessEnvironment,
): AccessDecision;
