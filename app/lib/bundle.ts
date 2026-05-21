import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { DOS_ROOT } from "./dos-paths";
import { DEFAULT_CYCLES, CYCLES_STEP } from "./cpu-cycles";

function runCmd(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (b) => { stderr += String(b); });
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}: ${stderr.slice(0, 500)}`));
    });
    p.on("error", reject);
  });
}

// Mirrors the native DOSBox 0.74-3 defaults that these games are known to run on
// (~/Library/Preferences/"DOSBox 0.74-3-3 Preferences"). [sdl]/[render] are
// intentionally omitted — the web client supplies its own WebGL renderer.
export const DOSBOX_CONF = [
  "[dosbox]",
  "machine=svga_s3",
  "memsize=16",
  "",
  "[cpu]",
  "core=auto",
  "cputype=486_prefetch",
  // 486DX2-66 class. cycleup/cycledown are absolute (>=100) so a single
  // toolbar click is exactly +/-CYCLES_STEP, matching the client's tracker.
  `cycles=fixed ${DEFAULT_CYCLES}`,
  `cycleup=${CYCLES_STEP}`,
  `cycledown=${CYCLES_STEP}`,
  "",
  "[dos]",
  "xms=true",
  "ems=true",
  "umb=true",
  "keyboardlayout=auto",
  "",
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

    // Use the system `zip` binary. Node libraries we tried (archiver, yazl)
    // all emit streaming-format ZIPs (general-purpose bit 3 set, sizes/CRCs
    // in trailing data descriptors). js-dos's wlibzip extractor hangs on that
    // format with larger bundles, so ci-ready never fires. system `zip` writes
    // a traditional layout (sizes/CRCs in the local header) which wlibzip
    // handles cleanly.
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), "dosbox-stage-"));
    try {
      await fs.mkdir(path.join(staging, ".jsdos"), { recursive: true });
      await fs.writeFile(path.join(staging, ".jsdos", "dosbox.conf"), DOSBOX_CONF);
      // 1) stage .jsdos/ into the tmp zip. Default zip(1) options — keep UT/ux
      // extra fields. (-X strips them and we saw extraction hang on extra-field-
      // less archives, though that may have been a coincidence; either way the
      // default tracks what the working baseline used.)
      await runCmd("zip", ["-r", "-q", tmpZip, ".jsdos"], staging);
      // 2) append ~/dos contents to the same zip
      await runCmd("zip", ["-r", "-q", tmpZip, ".", "-x", ".jsdos/*"], DOS_ROOT);
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }

    // Move the new zip into place atomically.
    await fs.rename(tmpZip, bundlePath());
    // Derive the ETag from the on-disk zip's stat so each rebuild produces a
    // distinct ETag even when walkFiles() would yield the same content hash
    // (e.g. when only the build tool changed). Without this, browsers that
    // cached an earlier broken zip keep getting 304 against a stale body —
    // observed: archiver-built bundles linger in client cache even after we
    // switched to system zip.
    const zipStat = await fs.stat(bundlePath());
    const realEtag = `"${etag.slice(1, -1)}-${zipStat.mtimeMs.toString(36)}-${zipStat.size}"`;
    await fs.writeFile(etagPath(), realEtag);
    return realEtag;
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
  size: number;
}

export async function streamJsdosBundle(): Promise<BundleStream> {
  const etag = await ensureBundle();
  const st = await fs.stat(bundlePath());
  const body = Readable.toWeb(createReadStream(bundlePath())) as unknown as ReadableStream<Uint8Array>;
  return { body, etag, size: st.size };
}
