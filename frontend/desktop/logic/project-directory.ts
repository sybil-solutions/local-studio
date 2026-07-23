export function selectedDirectoryPath(selection: {
  canceled: boolean;
  filePaths: readonly string[];
}): string | null {
  return selection.canceled ? null : (selection.filePaths[0] ?? null);
}
