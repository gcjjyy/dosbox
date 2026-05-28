// Shared CPU cycles constants. Imported by both the server bundle builder
// (bundle.ts) and the client toolbar so the dosbox.conf default and the
// displayed start value never drift apart.
//
// Default 80000 cycles matches the local DOSBox 0.74-3 profile used for
// compatibility testing. Step is an ABSOLUTE value (>=100, not a percentage)
// so dosbox and the client compute "1 click = +/-1000" identically.
export const DEFAULT_CYCLES = 80000;
export const LEGACY_DEFAULT_CYCLES = 20000;
export const CYCLES_STEP = 1000;
export const CYCLES_MIN = 3000;
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
