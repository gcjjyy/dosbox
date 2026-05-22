// Shared CPU cycles constants. Imported by both the server bundle builder
// (bundle.ts) and the client toolbar so the dosbox.conf default and the
// displayed start value never drift apart.
//
// Default 8000 cycles (~386-class) — baked into dosbox.conf (`cycles=fixed 8000`)
// and used as the client display default. Step is an ABSOLUTE value (>=100, not
// a percentage) so dosbox and the client compute "1 click = +/-2000" identically.
export const DEFAULT_CYCLES = 8000;
export const CYCLES_STEP = 2000;
export const CYCLES_MIN = 100;
export const CYCLES_MAX = 100000;

export function clampCycles(n: number): number {
  if (Number.isNaN(n)) return DEFAULT_CYCLES;
  return Math.max(CYCLES_MIN, Math.min(CYCLES_MAX, Math.round(n)));
}

// Boot-time replay: the shared server bundle can't be re-baked per user, so a
// saved cycles value is restored by replaying cycleup/cycledown events from the
// baked default. The stepper only moves in CYCLES_STEP increments, so the saved
// target is always DEFAULT_CYCLES + k*CYCLES_STEP and the replay lands exactly.
export function cyclesReplay(saved: number): { dir: "up" | "down"; count: number } {
  const delta = clampCycles(saved) - DEFAULT_CYCLES;
  const count = Math.round(Math.abs(delta) / CYCLES_STEP);
  return { dir: delta >= 0 ? "up" : "down", count };
}
