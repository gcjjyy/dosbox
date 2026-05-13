import { describe, it, expect } from "vitest";
import type { FsNode, JsDosCi } from "./fs-diff";
import { snapshotFsTree, computeDiff } from "./fs-diff";

function leaf(name: string, size: number): FsNode {
  return { name, size, nodes: null };
}
function dir(name: string, ...kids: FsNode[]): FsNode {
  return { name, size: null, nodes: kids };
}

function makeCi(tree: FsNode, files: Record<string, Uint8Array>): JsDosCi {
  return {
    fsTree: async () => tree,
    fsReadFile: async (p: string) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p]!;
    },
  };
}

describe("fs-diff", () => {
  it("snapshotFsTree flattens to relative POSIX paths and sizes (skipping root and dirs)", async () => {
    const tree = dir("",
      leaf("AUTOEXEC.BAT", 100),
      dir("BANGJA", leaf("GAME.EXE", 1024)),
    );
    const ci = makeCi(tree, {});
    const snap = await snapshotFsTree(ci);
    expect(Object.fromEntries(snap)).toEqual({
      "AUTOEXEC.BAT": { size: 100 },
      "BANGJA/GAME.EXE": { size: 1024 },
    });
  });

  it("computeDiff classifies adds, modifies, and deletes", async () => {
    const baseline = new Map([
      ["A.TXT", { size: 10 }],
      ["B.TXT", { size: 20 }],
      ["GONE.TXT", { size: 5 }],
    ]);
    const tree = dir("",
      leaf("A.TXT", 10),            // unchanged
      leaf("B.TXT", 21),            // modified (size diff)
      leaf("NEW.TXT", 7),           // added
    );
    const files = {
      "B.TXT": new Uint8Array([1, 2, 3]),
      "NEW.TXT": new Uint8Array([9]),
    };
    const ci = makeCi(tree, files);
    const diff = await computeDiff(ci, baseline);
    expect(diff.deletes).toEqual(["GONE.TXT"]);
    expect(diff.writes.map(w => w.path).sort()).toEqual(["B.TXT", "NEW.TXT"]);
    expect(diff.readErrors).toEqual([]);
  });

  it("collects readErrors for files that fsReadFile rejects", async () => {
    const baseline = new Map<string, { size: number }>();
    const tree = dir("", leaf("X.SAV", 3));
    const ci = makeCi(tree, {}); // X.SAV intentionally missing → fsReadFile throws
    const diff = await computeDiff(ci, baseline);
    expect(diff.writes).toEqual([]);
    expect(diff.readErrors).toEqual(["X.SAV"]);
  });
});
