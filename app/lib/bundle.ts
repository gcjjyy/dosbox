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

const BUNDLE_FORMAT_VERSION = "dos-files-v2";

// Mirrors the native DOSBox 0.74-3 defaults that these games are known to run on
// (~/Library/Preferences/"DOSBox 0.74-3-3 Preferences"). [sdl]/[render] are
// intentionally omitted because the browser canvas/audio pipeline owns them.
export const DOSBOX_CONF = [
  "[sdl]",
  "autolock=false",
  "sensitivity=100",
  "usescancodes=false",
  "",
  "[dosbox]",
  "machine=svga_s3",
  "memsize=16",
  "",
  "[cpu]",
  // Keep core/cputype at the native DOSBox 0.74 auto/auto baseline. We used to
  // pin cputype=486_prefetch, but the WASM build's
  // own help notes "prefetch queue emulation requires the normal core" while
  // core=auto selects the dynamic core for protected-mode code — that mismatch
  // caused intermittent in-game crashes (e.g. 용의기사2/FD2) under the web
  // emulator that never happened in native DOSBox 0.74-3. cycleup/cycledown are
  // absolute (>=100) so one toolbar click is exactly +/-CYCLES_STEP, matching
  // the client's tracker.
  "core=auto",
  "cputype=auto",
  `cycles=fixed ${DEFAULT_CYCLES}`,
  `cycleup=${CYCLES_STEP}`,
  `cycledown=${CYCLES_STEP}`,
  "",
  "[mixer]",
  "nosound=false",
  "rate=44100",
  "blocksize=512",
  "prebuffer=10",
  "",
  "[midi]",
  "mpu401=intelligent",
  "mididevice=default",
  "midiconfig=",
  "",
  "[sblaster]",
  "sbtype=sb16",
  "sbbase=220",
  "irq=7",
  "dma=1",
  "hdma=5",
  "sbmixer=true",
  "oplmode=auto",
  "oplemu=default",
  "oplrate=44100",
  "",
  "[speaker]",
  "pcspeaker=true",
  "pcrate=44100",
  "tandy=auto",
  "tandyrate=44100",
  "disney=true",
  "",
  "[joystick]",
  "joysticktype=auto",
  "timed=true",
  "autofire=false",
  "swap34=false",
  "buttonwrap=false",
  "",
  "[serial]",
  "serial1=dummy",
  "serial2=dummy",
  "serial3=disabled",
  "serial4=disabled",
  "",
  "[dos]",
  "xms=true",
  "ems=true",
  "umb=true",
  "keyboardlayout=none",
  "",
  "[ipx]",
  "ipx=false",
  "",
  "[autoexec]",
  "@ECHO OFF",
  "mount c /c",
  "c:",
  "IF EXIST AUTOEXEC.BAT CALL AUTOEXEC.BAT",
  "",
].join("\n");

function cacheDir(): string {
  return process.env.DOSBOX_CACHE_DIR
    ? path.resolve(process.env.DOSBOX_CACHE_DIR)
    : path.join(os.homedir(), ".cache", "dosbox");
}
function bundlePath(): string { return path.join(cacheDir(), "bundle.zip"); }
function etagPath(): string { return path.join(cacheDir(), "bundle.etag"); }
function formatPath(): string { return path.join(cacheDir(), "bundle.format"); }

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
  h.update(BUNDLE_FORMAT_VERSION);
  h.update("\n");
  for (const f of files) h.update(`${f.rel}:${f.size}:${f.mtime}\n`);
  return `"${h.digest("hex").slice(0, 32)}"`;
}

export function getDosboxConfEtag(): string {
  return `"${createHash("sha256").update(DOSBOX_CONF).digest("hex").slice(0, 32)}"`;
}

let inFlight: Promise<string> | null = null;

export async function rebuildBundle(): Promise<string> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const dir = cacheDir();
    await fs.mkdir(dir, { recursive: true });
    const files = await walkFiles(DOS_ROOT);
    const etag = etagFromFiles(files);
    const tmpZip = path.join(dir, `bundle.zip.${process.pid}-${Date.now()}.tmp`);

    // Use the system `zip` binary so entries have stable local headers. The
    // web runtime now extracts this archive itself; config is served separately.
    await runCmd("zip", ["-r", "-q", tmpZip, ".", "-x", ".*", "*/.*"], DOS_ROOT);

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
    await fs.writeFile(formatPath(), BUNDLE_FORMAT_VERSION);
    return realEtag;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

async function ensureBundle(): Promise<string> {
  try {
    const etag = (await fs.readFile(etagPath(), "utf8")).trim();
    const cachedFormat = (await fs.readFile(formatPath(), "utf8")).trim();
    if (cachedFormat !== BUNDLE_FORMAT_VERSION) return rebuildBundle();
    await fs.access(bundlePath());
    return etag;
  } catch {
    return rebuildBundle();
  }
}

export async function getBundleEtag(): Promise<string> {
  return ensureBundle();
}

export function bundleVersionFromEtag(etag: string): string {
  return etag.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

export interface BundleStream {
  body: ReadableStream<Uint8Array>;
  etag: string;
  size: number;
}

export async function streamDosBundle(): Promise<BundleStream> {
  const etag = await ensureBundle();
  const st = await fs.stat(bundlePath());
  const body = Readable.toWeb(createReadStream(bundlePath())) as unknown as ReadableStream<Uint8Array>;
  return { body, etag, size: st.size };
}
