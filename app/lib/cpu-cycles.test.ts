import { describe, it, expect } from "vitest";
import {
  DEFAULT_CYCLES,
  CYCLES_STEP,
  CYCLES_MIN,
  CYCLES_MAX,
  clampCycles,
} from "./cpu-cycles";

describe("cpu-cycles", () => {
  it("exposes 486DX2-66 default and absolute step", () => {
    expect(DEFAULT_CYCLES).toBe(23880);
    expect(CYCLES_STEP).toBe(2000);
    expect(CYCLES_MIN).toBe(100);
    expect(CYCLES_MAX).toBe(100000);
  });

  it("clamps within [MIN, MAX]", () => {
    expect(clampCycles(50)).toBe(CYCLES_MIN);
    expect(clampCycles(999999)).toBe(CYCLES_MAX);
    expect(clampCycles(23880)).toBe(23880);
  });

  it("rounds and falls back to default on NaN", () => {
    expect(clampCycles(23880.7)).toBe(23881);
    expect(clampCycles(Number.NaN)).toBe(DEFAULT_CYCLES);
  });
});
