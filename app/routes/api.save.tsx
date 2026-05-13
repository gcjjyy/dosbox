import type { Route } from "./+types/api.save";
import yauzl from "yauzl";
import { requireAdmin } from "../lib/auth.server";
import { assertSameOrigin } from "../lib/origin";
import { applyChanges, type WriteEntry } from "../lib/apply-changes";
import { rebuildBundle } from "../lib/bundle";
import { toErrorResponse, InvalidPayload, PayloadTooLarge } from "../lib/errors";

const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024; // 64 MB per entry
const MAX_TOTAL_BYTES = 256 * 1024 * 1024; // 256 MB upload cap

function unzipEntries(buf: Buffer): Promise<WriteEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("unzip failed"));
      const out: WriteEntry[] = [];
      zip.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) {
          // directory entry — skip; applyChanges creates dirs as needed
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > MAX_FILE_BYTES) {
          zip.close();
          reject(new PayloadTooLarge(`entry ${entry.fileName} exceeds ${MAX_FILE_BYTES} bytes`));
          return;
        }
        if (out.length >= MAX_FILES) {
          zip.close();
          reject(new PayloadTooLarge(`too many entries (max ${MAX_FILES})`));
          return;
        }
        zip.openReadStream(entry, (rsErr, rs) => {
          if (rsErr || !rs) return reject(rsErr ?? new Error("entry stream failed"));
          const chunks: Buffer[] = [];
          rs.on("data", (c) => chunks.push(c));
          rs.on("end", () => {
            out.push({ path: entry.fileName, bytes: new Uint8Array(Buffer.concat(chunks)) });
            zip.readEntry();
          });
          rs.on("error", reject);
        });
      });
      zip.on("end", () => resolve(out));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

export async function action({ request }: Route.ActionArgs) {
  try {
    assertSameOrigin(request);
    await requireAdmin(request);

    // js-dos v7 ci.persist() returns a zip of the changed FS; the client POSTs
    // those bytes as application/octet-stream. We unzip and apply entry-by-entry.
    const ct = request.headers.get("content-type") ?? "";
    if (!ct.includes("application/octet-stream") && !ct.includes("application/zip")) {
      throw new InvalidPayload("expected application/octet-stream");
    }

    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.byteLength > MAX_TOTAL_BYTES) {
      throw new PayloadTooLarge(`upload exceeds ${MAX_TOTAL_BYTES} bytes`);
    }
    if (buf.byteLength === 0) {
      // empty persist — no changes
      return Response.json({ applied: [], failed: [] }, { status: 200 });
    }

    const writes = await unzipEntries(buf);

    const result = await applyChanges({ writes, deletes: [] });

    if (result.applied.length > 0) {
      try {
        await rebuildBundle();
      } catch (err) {
        console.error("[save] bundle rebuild failed; bundle may be stale:", err);
      }
    }
    console.log(`[save] applied=${result.applied.length} failed=${result.failed.length}`);

    return Response.json(result, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export function loader() {
  return new Response("method not allowed", { status: 405 });
}
