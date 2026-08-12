import { existsSync } from "node:fs";
import path from "node:path";

type ShellEnvironment = Record<string, string | undefined>;

type ShellOptions = {
  platform?: NodeJS.Platform;
  env?: ShellEnvironment;
  executableExists?: (candidate: string) => boolean;
};

const windowsExecutable = (
  name: string,
  env: ShellEnvironment,
  executableExists: (candidate: string) => boolean,
): string | null => {
  const pathValue = env.Path ?? env.PATH ?? "";
  for (const directory of pathValue.split(path.win32.delimiter).filter(Boolean)) {
    const candidate = path.win32.join(directory, name);
    if (executableExists(candidate)) return candidate;
  }
  return null;
};

export function resolveInteractiveShell(options: ShellOptions = {}): {
  shell: string;
  args: string[];
} {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const executableExists = options.executableExists ?? existsSync;
  if (platform !== "win32") return { shell: env.SHELL || "/bin/zsh", args: [] };

  const pwsh = windowsExecutable("pwsh.exe", env, executableExists);
  if (pwsh) return { shell: pwsh, args: ["-NoLogo"] };

  const powershell = windowsExecutable("powershell.exe", env, executableExists);
  if (powershell) return { shell: powershell, args: ["-NoLogo"] };

  const systemPowerShell = env.SystemRoot
    ? path.win32.join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : null;
  if (systemPowerShell && executableExists(systemPowerShell)) {
    return { shell: systemPowerShell, args: ["-NoLogo"] };
  }

  return { shell: env.COMSPEC || "cmd.exe", args: [] };
}
