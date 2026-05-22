import { describe, it, expect } from "vitest";
import {
  DEFAULT_CYCLES,
  CYCLES_STEP,
  CYCLES_MIN,
  CYCLES_MAX,
  clampCycles,
  cyclesReplay,
} from "./cpu-cycles";

describe("cpu-cycles", () => {
  it("exposes 8000 default and absolute step", () => {
    expect(DEFAULT_CYCLES).toBe(8000);
    expect(CYCLES_STEP).toBe(2000);
    expect(CYCLES_MIN).toBe(100);
    expect(CYCLES_MAX).toBe(100000);
  });

  it("clamps within [MIN, MAX]", () => {
    expect(clampCycles(50)).toBe(CYCLES_MIN);
    expect(clampCycles(999999)).toBe(CYCLES_MAX);
    expect(clampCycles(8000)).toBe(8000);
  });

  it("rounds and falls back to default on NaN", () => {
    expect(clampCycles(8000.7)).toBe(8001);
    expect(clampCycles(Number.NaN)).toBe(DEFAULT_CYCLES);
  });

  it("computes boot replay direction + step count vs the default", () => {
    expect(cyclesReplay(8000)).toEqual({ dir: "up", count: 0 });
    expect(cyclesReplay(12000)).toEqual({ dir: "up", count: 2 });
    expect(cyclesReplay(4000)).toEqual({ dir: "down", count: 2 });
    // clamped target (100) is 7900 below default → 3.95 steps → rounds to 4
    expect(cyclesReplay(0)).toEqual({ dir: "down", count: 4 });
  });
});
