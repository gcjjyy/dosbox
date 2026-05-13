import type { Route } from "./+types/api.save";
import { z } from "zod";
import { requireAdmin } from "../lib/auth.server";
import { assertSameOrigin } from "../lib/origin";
import { applyChanges } from "../lib/apply-changes";
import { invalidateBundleCache } from "../lib/bundle";
import { toErrorResponse, InvalidPayload, PayloadTooLarge } from "../lib/errors";

const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024; // 64 MB

const DeletesSchema = z.array(z.string().min(1).max(1024)).max(MAX_FILES);

export async function action({ request }: Route.ActionArgs) {
  try {
    assertSameOrigin(request);
    await requireAdmin(request);

    const ct = request.headers.get("content-type") ?? "";
    if (!ct.includes("multipart/form-data")) throw new InvalidPayload("expected multipart/form-data");

    const form = await request.formData();

    const deletesRaw = form.get("deletes");
    let deletes: string[] = [];
    if (typeof deletesRaw === "string" && deletesRaw.length > 0) {
      let parsed: unknown;
      try { parsed = JSON.parse(deletesRaw); } catch { throw new InvalidPayload("deletes is not valid JSON"); }
      const r = DeletesSchema.safeParse(parsed);
      if (!r.success) throw new InvalidPayload("deletes shape invalid");
      deletes = r.data;
    }

    const writeFiles = form.getAll("writes").filter((v): v is File => v instanceof File);
    if (writeFiles.length + deletes.length > MAX_FILES) {
      throw new PayloadTooLarge(`too many entries (max ${MAX_FILES})`);
    }
    for (const f of writeFiles) {
      if (f.size > MAX_FILE_BYTES) {
        throw new PayloadTooLarge(`file ${f.name} exceeds ${MAX_FILE_BYTES} bytes`);
      }
    }

    const writes = await Promise.all(writeFiles.map(async (f) => ({
      path: f.name,
      bytes: new Uint8Array(await f.arrayBuffer()),
    })));

    const result = await applyChanges({ writes, deletes });

    if (result.applied.length > 0) invalidateBundleCache();
    console.log(`[save] applied=${result.applied.length} failed=${result.failed.length}`);

    return Response.json(result, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export function loader() {
  return new Response("method not allowed", { status: 405 });
}
