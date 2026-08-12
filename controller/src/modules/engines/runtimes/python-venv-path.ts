import { posix, win32 } from "node:path";

export const pythonPathInVenv = (
  venvDirectory: string,
  platform: NodeJS.Platform = process.platform,
): string =>
  platform === "win32"
    ? win32.join(venvDirectory, "Scripts", "python.exe")
    : posix.join(venvDirectory, "bin", "python");
