import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveSafe, DOS_ROOT } from "./dos-paths";

export interface WriteEntry { path: string; bytes: Uint8Array; }
export interface ApplyResult {
  applied: string[];
  failed: { path: string; reason: string }[];
}

export async function applyChanges(
  input: { writes: WriteEntry[]; deletes: string[] },
): Promise<ApplyResult> {
  const applied: string[] = [];
  const failed: { path: string; reason: string }[] = [];

  for (const w of input.writes) {
    try {
      const dest = resolveSafe(w.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const tmp = path.join(DOS_ROOT, `.dosbox-tmp-${randomUUID()}`);
      await fs.writeFile(tmp, w.bytes);
      await fs.rename(tmp, dest);
      applied.push(w.path);
    } catch (err) {
      failed.push({
        path: w.path,
        reason: err instanceof Error ? (("code" in err && err.code) ? String(err.code) : err.message) : String(err),
      });
    }
  }

  for (const d of input.deletes) {
    try {
      const dest = resolveSafe(d);
      try {
        await fs.unlink(dest);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      applied.push(d);
    } catch (err) {
      failed.push({
        path: d,
        reason: err instanceof Error ? (("code" in err && err.code) ? String(err.code) : err.message) : String(err),
      });
    }
  }

  return { applied, failed };
}
