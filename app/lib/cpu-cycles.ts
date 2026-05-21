// Shared CPU cycles constants. Imported by both the server bundle builder
// (bundle.ts) and the client toolbar so the dosbox.conf default and the
// displayed start value never drift apart.
//
// "486DX4 100" (~33000 cycles) ran too hot; we target 486DX2-66, which maps
// to ~23880 cycles in the DOSBox-X CPU settings guide. Step is an ABSOLUTE
// value (>=100, not a percentage) so dosbox
// and the client compute "1 click = +/-2000" identically.
export const DEFAULT_CYCLES = 23880;
export const CYCLES_STEP = 2000;
export const CYCLES_MIN = 100;
export const CYCLES_MAX = 100000;

export function clampCycles(n: number): number {
  if (Number.isNaN(n)) return DEFAULT_CYCLES;
  return Math.max(CYCLES_MIN, Math.min(CYCLES_MAX, Math.round(n)));
}
