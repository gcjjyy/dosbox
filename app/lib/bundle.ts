import { promises as fs } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
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

function cacheDir(): string {
  return process.env.DOSBOX_CACHE_DIR
    ? path.resolve(process.env.DOSBOX_CACHE_DIR)
    : path.join(os.homedir(), ".cache", "dosbox");
}
function bundlePath(): string { return path.join(cacheDir(), "bundle.jsdos"); }
function etagPath(): string { return path.join(cacheDir(), "bundle.etag"); }

interface WalkEntry { rel: string; abs: string; size: number; mtime: number; }

async function walkFiles(root: string): Promise<WalkEntry[]> {
  const out: WalkEntry[] = [];
  async function rec(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
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

function etagFromFiles(files: WalkEntry[]): string {
  const h = createHash("sha256");
  h.update(DOSBOX_CONF);
  h.update("\n");
  for (const f of files) h.update(`${f.rel}:${f.size}:${f.mtime}\n`);
  return `"${h.digest("hex").slice(0, 32)}"`;
}

let inFlight: Promise<string> | null = null;

export async function rebuildBundle(): Promise<string> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const dir = cacheDir();
    await fs.mkdir(dir, { recursive: true });
    const files = await walkFiles(DOS_ROOT);
    const etag = etagFromFiles(files);
    const tmpZip = path.join(dir, `bundle.jsdos.${process.pid}-${Date.now()}.tmp`);

    const archive = archiver("zip", { zlib: { level: 6 } });
    const out = createWriteStream(tmpZip);

    const closed = new Promise<void>((resolve, reject) => {
      out.on("close", () => resolve());
      out.on("error", reject);
      archive.on("error", reject);
      archive.on("warning", (err) => {
        if (err.code !== "ENOENT") console.error("archiver warning:", err);
      });
    });

    archive.pipe(out);
    archive.append(DOSBOX_CONF, { name: ".jsdos/dosbox.conf" });
    for (const f of files) archive.append(createReadStream(f.abs), { name: f.rel });
    void archive.finalize();
    await closed;

    // rename ZIP first so a 304 against the old etag never serves new bytes;
    // a 200 in the small gap after rename serves new bytes with old etag, which is
    // harmless (browser thinks it's stale, refetches next time and gets the new etag).
    await fs.rename(tmpZip, bundlePath());
    await fs.writeFile(etagPath(), etag);
    return etag;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

async function ensureBundle(): Promise<string> {
  try {
    const etag = (await fs.readFile(etagPath(), "utf8")).trim();
    await fs.access(bundlePath());
    return etag;
  } catch {
    return rebuildBundle();
  }
}

export async function getBundleEtag(): Promise<string> {
  return ensureBundle();
}

export interface BundleStream {
  body: ReadableStream<Uint8Array>;
  etag: string;
}

export async function streamJsdosBundle(): Promise<BundleStream> {
  const etag = await ensureBundle();
  const body = Readable.toWeb(createReadStream(bundlePath())) as unknown as ReadableStream<Uint8Array>;
  return { body, etag };
}
