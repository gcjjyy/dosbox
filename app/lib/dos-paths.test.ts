import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

let TMP: string;
beforeAll(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), "dosbox-paths-"));
  process.env.DOS_ROOT = TMP;
});

const importFresh = async () => {
  const mod = await import("./dos-paths");
  return mod;
};

describe("resolveSafe", () => {
  it("accepts a simple relative path", async () => {
    const { resolveSafe, DOS_ROOT } = await importFresh();
    expect(resolveSafe("FOO.TXT")).toBe(path.join(DOS_ROOT, "FOO.TXT"));
  });

  it("normalizes DOS-style backslashes", async () => {
    const { resolveSafe, DOS_ROOT } = await importFresh();
    expect(resolveSafe("BANGJA\\A.SAV")).toBe(path.join(DOS_ROOT, "BANGJA", "A.SAV"));
  });

  it("rejects ../ escape", async () => {
    const { resolveSafe, PathEscapeError } = await importFresh();
    expect(() => resolveSafe("../etc/passwd")).toThrow(PathEscapeError);
  });

  it("rejects absolute path", async () => {
    const { resolveSafe, PathEscapeError } = await importFresh();
    expect(() => resolveSafe("/etc/passwd")).toThrow(PathEscapeError);
  });

  it("rejects NUL byte", async () => {
    const { resolveSafe, PathEscapeError } = await importFresh();
    expect(() => resolveSafe("FOO\x00.TXT")).toThrow(PathEscapeError);
  });

  it("rejects empty component (e.g. //, trailing /)", async () => {
    const { resolveSafe, PathEscapeError } = await importFresh();
    expect(() => resolveSafe("FOO//BAR")).toThrow(PathEscapeError);
  });
});
