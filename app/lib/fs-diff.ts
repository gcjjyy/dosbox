export interface FsNode {
  name: string;
  size: number | null;
  nodes: FsNode[] | null;
}

export interface JsDosCi {
  fsTree: () => Promise<FsNode>;
  fsReadFile: (path: string) => Promise<Uint8Array>;
}

export type Baseline = Map<string, { size: number }>;

export interface Diff {
  writes: { path: string; bytes: Uint8Array }[];
  deletes: string[];
  readErrors: string[];
}

function flatten(root: FsNode): Map<string, { size: number }> {
  const out: Map<string, { size: number }> = new Map();
  function rec(node: FsNode, prefix: string) {
    if (node.nodes !== null) {
      for (const child of node.nodes) {
        const nextPrefix = prefix === "" ? child.name : `${prefix}/${child.name}`;
        rec(child, nextPrefix);
      }
    } else if (node.size !== null) {
      out.set(prefix, { size: node.size });
    }
  }
  rec(root, "");
  return out;
}

export async function snapshotFsTree(ci: JsDosCi): Promise<Baseline> {
  const tree = await ci.fsTree();
  return flatten(tree);
}

export async function computeDiff(ci: JsDosCi, baseline: Baseline): Promise<Diff> {
  const tree = await ci.fsTree();
  const current = flatten(tree);

  const writes: { path: string; bytes: Uint8Array }[] = [];
  const readErrors: string[] = [];

  for (const [p, cur] of current) {
    const base = baseline.get(p);
    if (!base || base.size !== cur.size) {
      try {
        const bytes = await ci.fsReadFile(p);
        writes.push({ path: p, bytes });
      } catch {
        readErrors.push(p);
      }
    }
  }

  const deletes: string[] = [];
  for (const p of baseline.keys()) {
    if (!current.has(p)) deletes.push(p);
  }

  return { writes, deletes, readErrors };
}
