export function controlTargetHasActiveTurn(
  status: { active?: boolean; running?: boolean } | null | undefined,
): boolean {
  return status?.active === true;
}
