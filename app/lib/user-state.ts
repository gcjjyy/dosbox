// app/lib/user-state.ts
//
// localStorage-backed per-user DOS state save. The save itself is the
// Uint8Array returned by emulators' CommandInterface.persist(true) —
// a ZIP of files changed since the initial bundle. Stored as base64
// in localStorage so non-UTF-8 bytes don't get mangled.

const STORAGE_KEY = "dosbox-user-state";

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000; // 32K — avoids "Maximum call stack" on apply with huge args
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function readUserState(): Uint8Array | null {
  try {
    const b64 = localStorage.getItem(STORAGE_KEY);
    if (!b64) return null;
    return base64ToBytes(b64);
  } catch {
    return null;
  }
}

/** Caller must catch QuotaExceededError to show a user-facing error. */
export function writeUserState(bytes: Uint8Array): void {
  const b64 = bytesToBase64(bytes);
  localStorage.setItem(STORAGE_KEY, b64);
}

export function clearUserState(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function hasUserState(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== null; } catch { return false; }
}
