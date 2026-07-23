const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:\//u;
const LINE_SUFFIX = /:\d+(?::\d+)?$/u;

type AbsolutePath = {
  caseInsensitive: boolean;
  root: string;
  segments: string[];
};

function cleanReference(raw: string): string {
  return raw
    .trim()
    .replace(/^`+|`+$/gu, "")
    .replace(LINE_SUFFIX, "");
}

function slashPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function absolutePath(value: string): AbsolutePath | null {
  const path = slashPath(value);
  if (WINDOWS_ABSOLUTE_PATH.test(path)) {
    return {
      caseInsensitive: true,
      root: path.slice(0, 2).toLowerCase(),
      segments: normalizedSegments(path.slice(3).split("/")),
    };
  }
  if (!path.startsWith("/")) return null;
  return {
    caseInsensitive: false,
    root: "/",
    segments: normalizedSegments(path.slice(1).split("/")),
  };
}

function normalizedSegments(values: string[], initial: string[] = []): string[] {
  const segments = [...initial];
  for (const value of values) {
    if (!value || value === ".") continue;
    if (value === "..") {
      segments.pop();
      continue;
    }
    segments.push(value);
  }
  return segments;
}

function decodedFileUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "file:" ||
      (url.hostname && url.hostname.toLowerCase() !== "localhost") ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const path = decodeURIComponent(url.pathname);
    if (path.includes("\0")) return null;
    return /^\/[A-Za-z]:\//u.test(path) ? path.slice(1) : path;
  } catch {
    return null;
  }
}

function homeDirectory(cwd: string): string | null {
  const path = slashPath(cwd);
  return (
    path.match(/^\/(?:Users|home)\/[^/]+/u)?.[0] ??
    path.match(/^[A-Za-z]:\/Users\/[^/]+/iu)?.[0] ??
    null
  );
}

function inputPath(raw: string, cwd: string): string | null {
  const value = cleanReference(raw);
  if (!value || value.includes("\0")) return null;
  if (/^file:\/\//iu.test(value)) return decodedFileUrl(value);
  if (!value.startsWith("~/")) return slashPath(value);
  const home = homeDirectory(cwd);
  return home ? `${home}/${value.slice(2)}` : null;
}

function sameSegment(left: string, right: string, caseInsensitive: boolean): boolean {
  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function workspaceFilePath(raw: string, cwd: string): string | null {
  const root = absolutePath(cwd);
  const path = inputPath(raw, cwd);
  if (!root || !path) return null;
  const absolute = absolutePath(path);
  const target = absolute ?? {
    ...root,
    segments: normalizedSegments(slashPath(path).split("/"), root.segments),
  };
  if (target.root !== root.root || target.caseInsensitive !== root.caseInsensitive) return null;
  if (
    root.segments.some(
      (segment, index) => !sameSegment(segment, target.segments[index] ?? "", root.caseInsensitive),
    )
  ) {
    return null;
  }
  const relative = target.segments.slice(root.segments.length).join("/");
  return relative || null;
}
