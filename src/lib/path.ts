const SEGMENT_RE = /[\\/]+/;

export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) return path;
  const parts = trimmed.split(SEGMENT_RE).filter(Boolean);
  return parts.at(-1) ?? trimmed;
}

export function dirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) {
    return path.startsWith("/") ? "/" : path;
  }

  if (/^[A-Za-z]:$/.test(trimmed)) {
    return `${trimmed}\\`;
  }

  const parts = trimmed.split(SEGMENT_RE).filter(Boolean);
  if (parts.length <= 1) {
    return path.startsWith("/") ? "/" : "";
  }

  const hasBackslash = path.includes("\\");
  const sep = hasBackslash ? "\\" : "/";

  if (/^[A-Za-z]:$/.test(parts[0])) {
    return `${parts[0]}${sep}${parts.slice(1, -1).join(sep)}`;
  }

  const joined = parts.slice(0, -1).join(sep);
  return path.startsWith("/") ? `${sep}${joined}` : joined;
}

export function relativePath(path: string, basePath: string): string {
  const normalizedPath = path.replace(/[\\/]+$/, "");
  const normalizedBase = basePath.replace(/[\\/]+$/, "");
  if (!normalizedBase) return basename(normalizedPath);

  const pathLower = normalizedPath.toLowerCase();
  const baseLower = normalizedBase.toLowerCase();
  if (pathLower === baseLower) return "";
  if (!pathLower.startsWith(baseLower)) return basename(normalizedPath);

  return normalizedPath
    .slice(normalizedBase.length)
    .replace(/^[\\/]+/, "");
}
