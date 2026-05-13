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
  "IF EXIST AUTOEXEC.BAT CALL AUTOEXEC.BAT",
  "",
].join("\n");

const ETAG_TTL_MS = 5_000;
let etagCache: { etag: string; computedAt: number } | null = null;

async function walkFiles(root: string): Promise<{ rel: string; abs: string; size: number; mtime: number }[]> {
  const out: { rel: string; abs: string; size: number; mtime: number }[] = [];
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

async function computeEtag(): Promise<string> {
  const files = await walkFiles(DOS_ROOT);
  const h = createHash("sha256");
  for (const f of files) {
    h.update(`${f.rel}:${f.size}:${f.mtime}\n`);
  }
  return `"${h.digest("hex").slice(0, 32)}"`;
}

export async function getBundleEtag(): Promise<string> {
  if (etagCache && Date.now() - etagCache.computedAt < ETAG_TTL_MS) {
    return etagCache.etag;
  }
  const etag = await computeEtag();
  etagCache = { etag, computedAt: Date.now() };
  return etag;
}

export function invalidateBundleCache(): void {
  etagCache = null;
}

export interface BundleStream {
  body: ReadableStream<Uint8Array>;
  etag: string;
}

export async function streamJsdosBundle(): Promise<BundleStream> {
  const etag = await getBundleEtag();
  const files = await walkFiles(DOS_ROOT);
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
