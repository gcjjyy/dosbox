import { describe, it, expect, beforeEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

let TMP: string;
beforeEach(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), "dosbox-apply-"));
  process.env.DOS_ROOT = TMP;
});

const importFresh = async () => {
  vi.resetModules();
  return import("./apply-changes");
};

describe("applyChanges", () => {
  it("writes a new file under DOS_ROOT, creating parent dirs", async () => {
    const { applyChanges } = await importFresh();
    const result = await applyChanges({
      writes: [{ path: "BANGJA/A.SAV", bytes: new Uint8Array([1, 2, 3]) }],
      deletes: [],
    });
    expect(result.applied).toEqual(["BANGJA/A.SAV"]);
    expect(result.failed).toEqual([]);
    const written = await fs.readFile(path.join(TMP, "BANGJA", "A.SAV"));
    expect(Array.from(written)).toEqual([1, 2, 3]);
  });

  it("overwrites an existing file atomically (no truncation window)", async () => {
    await fs.writeFile(path.join(TMP, "X.TXT"), "old");
    const { applyChanges } = await importFresh();
    const result = await applyChanges({
      writes: [{ path: "X.TXT", bytes: new TextEncoder().encode("new") }],
      deletes: [],
    });
    expect(result.applied).toEqual(["X.TXT"]);
    expect(await fs.readFile(path.join(TMP, "X.TXT"), "utf8")).toBe("new");
  });

  it("delete is idempotent (ENOENT counted as applied)", async () => {
    const { applyChanges } = await importFresh();
    const result = await applyChanges({
      writes: [],
      deletes: ["NEVER.EXISTED"],
    });
    expect(result.applied).toEqual(["NEVER.EXISTED"]);
    expect(result.failed).toEqual([]);
  });

  it("rejects path escape with failed entry, does not abort batch", async () => {
    const { applyChanges } = await importFresh();
    const result = await applyChanges({
      writes: [
        { path: "../escape.txt", bytes: new Uint8Array([0]) },
        { path: "OK.TXT", bytes: new TextEncoder().encode("ok") },
      ],
      deletes: [],
    });
    expect(result.applied).toEqual(["OK.TXT"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].path).toBe("../escape.txt");
    expect(result.failed[0].reason).toMatch(/invalid_path/i);
  });
});
