// app/lib/options.ts
//
// Pure (DOM-free) options model: type, defaults, validation, and JSON
// parse/serialize. The React hook (use-options.ts) wraps this with
// localStorage. Kept pure so it's unit-testable in the node test env.

import { RESOLUTIONS, DEFAULT_RESOLUTION, type ResolutionId } from "../components/ResolutionPicker";
import { DEFAULT_CYCLES, clampCycles } from "./cpu-cycles";

export type CanvasVAlign = "top" | "middle" | "bottom";

export interface Options {
  cycles: number;
  resolutionId: ResolutionId;
  canvasVAlign: CanvasVAlign;
  keyboardOpacity: number; // 0..1
}

export const DEFAULT_OPTIONS: Options = {
  cycles: DEFAULT_CYCLES,
  resolutionId: DEFAULT_RESOLUTION,
  canvasVAlign: "middle",
  keyboardOpacity: 1,
};

export const OPTIONS_STORAGE_KEY = "dosbox-options";
export const LEGACY_RESOLUTION_KEY = "dosbox-resolution";

function isResolutionId(v: unknown): v is ResolutionId {
  return typeof v === "string" && RESOLUTIONS.some((r) => r.id === v);
}
function isVAlign(v: unknown): v is CanvasVAlign {
  return v === "top" || v === "middle" || v === "bottom";
}
function clamp01(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return DEFAULT_OPTIONS.keyboardOpacity;
  return Math.max(0, Math.min(1, n));
}

// `raw` is the stored blob string (or null). `legacyResolution` is the value of
// the old `dosbox-resolution` key, applied ONLY when no blob exists yet.
export function parseOptions(raw: string | null, legacyResolution?: string | null): Options {
  let obj: Record<string, unknown> = {};
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === "object" && !Array.isArray(p)) obj = p as Record<string, unknown>;
    } catch {
      /* ignore — fall through to defaults */
    }
  }

  const resolutionId: ResolutionId = isResolutionId(obj.resolutionId)
    ? obj.resolutionId
    : raw === null && isResolutionId(legacyResolution)
      ? legacyResolution
      : DEFAULT_OPTIONS.resolutionId;

  return {
    cycles: typeof obj.cycles === "number" ? clampCycles(obj.cycles) : DEFAULT_OPTIONS.cycles,
    resolutionId,
    canvasVAlign: isVAlign(obj.canvasVAlign) ? obj.canvasVAlign : DEFAULT_OPTIONS.canvasVAlign,
    keyboardOpacity: obj.keyboardOpacity === undefined ? DEFAULT_OPTIONS.keyboardOpacity : clamp01(obj.keyboardOpacity),
  };
}

export function serializeOptions(o: Options): string {
  return JSON.stringify(o);
}
