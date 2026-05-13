import type { Diff } from "./fs-diff";

export interface SaveResult {
  applied: string[];
  failed: { path: string; reason: string }[];
}

export async function saveToServer(diff: Diff): Promise<SaveResult> {
  const form = new FormData();
  form.set("deletes", JSON.stringify(diff.deletes));
  for (const w of diff.writes) {
    const blob = new Blob([new Uint8Array(w.bytes)], { type: "application/octet-stream" });
    form.append("writes", blob, w.path);
  }
  const res = await fetch("/api/save", {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`save failed: ${res.status} ${detail}`);
  }
  return res.json();
}
