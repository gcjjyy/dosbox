import { describe, it, expect, beforeEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import yauzl from "yauzl";

let TMP: string;
beforeEach(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), "dosbox-bundle-"));
  process.env.DOS_ROOT = TMP;
  vi.resetModules();
  // Sample files
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
  it("streams a zip containing .jsdos/dosbox.conf and sample files", async () => {
    const { streamJsdosBundle } = await import("./bundle");
    const { body } = await streamJsdosBundle();
    const buf = await streamToBuffer(body);
    const entries = await listZipEntries(buf);
    expect(entries).toContain(".jsdos/dosbox.conf");
    expect(entries).toContain("AUTOEXEC.BAT");
    expect(entries).toContain("BANGJA/GAME.EXE");
  });

  it("getBundleEtag returns same value within TTL", async () => {
    const { getBundleEtag } = await import("./bundle");
    const a = await getBundleEtag();
    const b = await getBundleEtag();
    expect(a).toBe(b);
    expect(a).toMatch(/^"[a-f0-9]{16,}"$/);
  });

  it("invalidateBundleCache forces recomputation", async () => {
    const { getBundleEtag, invalidateBundleCache } = await import("./bundle");
    const a = await getBundleEtag();
    await fs.writeFile(path.join(TMP, "NEW.TXT"), "hello");
    invalidateBundleCache();
    const b = await getBundleEtag();
    expect(a).not.toBe(b);
  });
});
