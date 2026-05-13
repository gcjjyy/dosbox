import path from "node:path";
import os from "node:os";
import { PathEscapeError } from "./errors";

export const DOS_ROOT = process.env.DOS_ROOT
  ? path.resolve(process.env.DOS_ROOT)
  : path.join(os.homedir(), "dos");

export { PathEscapeError };

export function resolveSafe(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  // Check for empty components (//, leading/trailing /) and control chars
  // BEFORE path.resolve collapses them away.
  const rawParts = normalized.split("/");
  for (const part of rawParts) {
    if (part === "" || /[\x00-\x1f]/.test(part)) {
      throw new PathEscapeError(relPath);
    }
  }
  const absolute = path.resolve(DOS_ROOT, normalized);
  const rel = path.relative(DOS_ROOT, absolute);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathEscapeError(relPath);
  }
  return absolute;
}
