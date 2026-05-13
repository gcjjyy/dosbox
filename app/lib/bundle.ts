import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import archiver from "archiver";
import { DOS_ROOT } from "./dos-paths";

const DOSBOX_CONF = [
  "[autoexec]",
  "@ECHO OFF",
  "mount c .",
  "c:",
  "IF EXIST AUTOEXEC.BAT CALL AUTOEXEC.BAT",
  "",
].join("\n");

const ETAG_TTL_MS = 5_000;

interface WalkEntry { rel: string; abs: string; size: number; mtime: number; }
interface Snapshot { etag: string; files: WalkEntry[]; computedAt: number; }
let cache: Snapshot | null = null;

async function walkFiles(root: string): Promise<WalkEntry[]> {
  const out: WalkEntry[] = [];
  async function rec(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue; // skip symlinks (security)
      if (e.isDirectory()) {
        await rec(abs);
      } else if (e.isFile()) {
        const st = await fs.stat(abs);
        out.push({
          rel: path.relative(root, abs).split(path.sep).join("/"),
          abs,
          size: st.size,
          mtime: Math.floor(st.mtimeMs),
        });
      }
    }
  }
  await rec(root);
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

async function refreshCache(): Promise<Snapshot> {
  const files = await walkFiles(DOS_ROOT);
  const h = createHash("sha256");
  for (const f of files) h.update(`${f.rel}:${f.size}:${f.mtime}\n`);
  const etag = `"${h.digest("hex").slice(0, 32)}"`;
  cache = { etag, files, computedAt: Date.now() };
  return cache;
}

async function getOrRefresh(): Promise<Snapshot> {
  if (cache && Date.now() - cache.computedAt < ETAG_TTL_MS) return cache;
  return refreshCache();
}

export async function getBundleEtag(): Promise<string> {
  return (await getOrRefresh()).etag;
}

export function invalidateBundleCache(): void {
  cache = null;
}

export interface BundleStream {
  body: ReadableStream<Uint8Array>;
  etag: string;
}

export async function streamJsdosBundle(): Promise<BundleStream> {
  const { etag, files } = await getOrRefresh();
  const archive = archiver("zip", { zlib: { level: 6 } });

  archive.on("warning", (err) => {
    if (err.code !== "ENOENT") console.error("archiver warning:", err);
  });
  archive.on("error", (err) => { console.error("archiver error:", err); });

  archive.append(DOSBOX_CONF, { name: ".jsdos/dosbox.conf" });
  for (const f of files) {
    archive.append(createReadStream(f.abs), { name: f.rel });
  }
  archive.finalize().catch((err) => console.error("archiver finalize error:", err));

  const body = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;
  return { body, etag };
}
