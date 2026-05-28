import { Unzip, UnzipInflate } from "fflate";

type WorkerRequest =
  | { type: "extract"; id: number; zip: ArrayBuffer }
  | { type: "ack"; id: number; seq: number };

interface PendingEntry {
  name: string;
  data: ArrayBuffer;
  size: number;
}

interface WorkerSelf {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const CHUNK_SIZE = 256 * 1024;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_BATCH_FILES = 64;

const workerSelf = self as unknown as WorkerSelf;
const ackResolvers = new Map<string, () => void>();

function normalizeZipName(name: string): string | null {
  const rel = name.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.endsWith("/")) return null;
  if (rel.split("/").some((part) => part === ".." || part === "" || part.startsWith("."))) return null;
  return rel;
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}

function mergeChunks(chunks: Uint8Array[], total: number): ArrayBuffer {
  if (chunks.length === 1) return exactBuffer(chunks[0]);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

function sleep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function postProgress(id: number, phase: "inflate" | "write", fraction: number): void {
  workerSelf.postMessage({ type: "progress", id, phase, fraction: Math.max(0, Math.min(1, fraction)) });
}

function waitForAck(id: number, seq: number): Promise<void> {
  return new Promise((resolve) => {
    ackResolvers.set(`${id}:${seq}`, resolve);
  });
}

async function postBatch(id: number, seq: number, entries: PendingEntry[], bytes: number): Promise<void> {
  const transfer = entries.map((entry) => entry.data);
  workerSelf.postMessage({ type: "batch", id, seq, bytes, entries }, transfer);
  await waitForAck(id, seq);
}

async function extractZip(id: number, zipBuffer: ArrayBuffer): Promise<void> {
  const zip = new Uint8Array(zipBuffer);
  const entries: PendingEntry[] = [];
  let totalInflated = 0;
  let inflated = 0;
  let lastProgressAt = 0;

  const unzipper = new Unzip((file) => {
    const rel = normalizeZipName(file.name);
    if (!rel) return;

    totalInflated += file.originalSize ?? 0;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, data, final) => {
      if (err) throw err;
      if (data.byteLength > 0) {
        chunks.push(data);
        size += data.byteLength;
        inflated += data.byteLength;
      }
      const now = Date.now();
      if (now - lastProgressAt > 50) {
        postProgress(id, "inflate", totalInflated > 0 ? inflated / totalInflated : 0);
        lastProgressAt = now;
      }
      if (final) {
        entries.push({ name: rel, data: mergeChunks(chunks, size), size });
      }
    };
    file.start();
  });
  unzipper.register(UnzipInflate);

  for (let offset = 0; offset < zip.byteLength; offset += CHUNK_SIZE) {
    const end = Math.min(zip.byteLength, offset + CHUNK_SIZE);
    unzipper.push(zip.subarray(offset, end), end === zip.byteLength);
    if ((offset / CHUNK_SIZE) % 8 === 7) await sleep();
  }
  postProgress(id, "inflate", 1);

  let seq = 0;
  let batch: PendingEntry[] = [];
  let batchBytes = 0;
  let writtenBytes = 0;
  const totalWriteBytes = Math.max(1, entries.reduce((sum, entry) => sum + entry.size, 0));

  const flush = async () => {
    if (batch.length === 0) return;
    const sentBytes = batchBytes;
    await postBatch(id, seq++, batch, sentBytes);
    writtenBytes += sentBytes;
    postProgress(id, "write", writtenBytes / totalWriteBytes);
    batch = [];
    batchBytes = 0;
    await sleep();
  };

  for (const entry of entries) {
    if (batch.length > 0 && (batchBytes + entry.size > MAX_BATCH_BYTES || batch.length >= MAX_BATCH_FILES)) {
      await flush();
    }
    batch.push(entry);
    batchBytes += entry.size;
  }
  await flush();
  postProgress(id, "write", 1);
  workerSelf.postMessage({ type: "done", id });
}

workerSelf.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "ack") {
    const key = `${msg.id}:${msg.seq}`;
    ackResolvers.get(key)?.();
    ackResolvers.delete(key);
    return;
  }

  void extractZip(msg.id, msg.zip).catch((err) => {
    workerSelf.postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  });
};
