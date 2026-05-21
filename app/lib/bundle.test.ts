import { describe, it, expect, beforeEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import yauzl from "yauzl";

let TMP: string;
let CACHE_TMP: string;
beforeEach(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), "dosbox-bundle-"));
  CACHE_TMP = await fs.mkdtemp(path.join(os.tmpdir(), "dosbox-cache-"));
  process.env.DOS_ROOT = TMP;
  process.env.DOSBOX_CACHE_DIR = CACHE_TMP;
  vi.resetModules();
  await fs.writeFile(path.join(TMP, "AUTOEXEC.BAT"), "@ECHO OFF\nPATH C:\\");
  await fs.mkdir(path.join(TMP, "BANGJA"), { recursive: true });
  await fs.writeFile(path.join(TMP, "BANGJA", "GAME.EXE"), Buffer.from([0x4d, 0x5a]));
});

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function listZipEntries(buf: Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const entries: string[] = [];
      zip.on("entry", (e) => { entries.push(e.fileName); zip.readEntry(); });
      zip.on("end", () => resolve(entries));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

describe("bundle", () => {
  it("streamJsdosBundle lazy-builds and returns a zip with dosbox.conf + DOS files", async () => {
    const { streamJsdosBundle } = await import("./bundle");
    const { body } = await streamJsdosBundle();
    const buf = await streamToBuffer(body);
    const entries = await listZipEntries(buf);
    expect(entries).toContain(".jsdos/dosbox.conf");
    expect(entries).toContain("AUTOEXEC.BAT");
    expect(entries).toContain("BANGJA/GAME.EXE");
  });

  it("rebuildBundle writes bundle.jsdos and bundle.etag to the cache dir", async () => {
    const { rebuildBundle } = await import("./bundle");
    const etag = await rebuildBundle();
    const bundleStat = await fs.stat(path.join(CACHE_TMP, "bundle.jsdos"));
    const onDiskEtag = (await fs.readFile(path.join(CACHE_TMP, "bundle.etag"), "utf8")).trim();
    expect(bundleStat.size).toBeGreaterThan(0);
    expect(onDiskEtag).toBe(etag);
    expect(etag).toMatch(/^"[\w.-]+"$/);
  });

  it("getBundleEtag returns the same value between calls without changes", async () => {
    const { getBundleEtag } = await import("./bundle");
    const a = await getBundleEtag();
    const b = await getBundleEtag();
    expect(a).toBe(b);
  });

  it("rebuildBundle picks up new files (etag changes)", async () => {
    const { rebuildBundle, getBundleEtag } = await import("./bundle");
    const before = await getBundleEtag();
    await fs.writeFile(path.join(TMP, "NEW.TXT"), "hello");
    await rebuildBundle();
    const after = await getBundleEtag();
    expect(before).not.toBe(after);
  });

  it("concurrent rebuildBundle calls share a single in-flight build", async () => {
    const { rebuildBundle } = await import("./bundle");
    const [a, b] = await Promise.all([rebuildBundle(), rebuildBundle()]);
    expect(a).toBe(b);
  });

  it("pins cycles to 486DX2-66 with an absolute step", async () => {
    const { DOSBOX_CONF } = await import("./bundle");
    expect(DOSBOX_CONF).toContain("cycles=fixed 23880");
    expect(DOSBOX_CONF).toContain("cycleup=2000");
    expect(DOSBOX_CONF).toContain("cycledown=2000");
  });
});
