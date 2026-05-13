export interface SaveResult {
  applied: string[];
  failed: { path: string; reason: string }[];
}

export async function saveToServer(persistBytes: Uint8Array): Promise<SaveResult> {
  // js-dos v7 ci.persist() returns a Uint8Array zip of the changed FS.
  // We POST the raw bytes; the server unzips and applies entry-by-entry.
  const res = await fetch("/api/save", {
    method: "POST",
    body: new Uint8Array(persistBytes),
    headers: { "Content-Type": "application/octet-stream" },
    credentials: "same-origin",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`save failed: ${res.status} ${detail}`);
  }
  return res.json();
}
