import { describe, expect, it } from "vitest";
import { HANGUL_LABELS, SC } from "./dos-keymap";

describe("SC", () => {
  it("exports CAPSLOCK as 280 (GLFW)", () => {
    expect(SC.CAPSLOCK).toBe(280);
  });
});

describe("HANGUL_LABELS", () => {
  it("has exactly 26 entries — one per letter scancode", () => {
    expect(Object.keys(HANGUL_LABELS)).toHaveLength(26);
  });

  it("maps each ASCII letter scancode to its 두벌식 jamo", () => {
    const expected: Record<number, string> = {
      [SC.Q]: "ㅂ", [SC.W]: "ㅈ", [SC.E]: "ㄷ", [SC.R]: "ㄱ", [SC.T]: "ㅅ",
      [SC.Y]: "ㅛ", [SC.U]: "ㅕ", [SC.I]: "ㅑ", [SC.O]: "ㅐ", [SC.P]: "ㅔ",
      [SC.A]: "ㅁ", [SC.S]: "ㄴ", [SC.D]: "ㅇ", [SC.F]: "ㄹ", [SC.G]: "ㅎ",
      [SC.H]: "ㅗ", [SC.J]: "ㅓ", [SC.K]: "ㅏ", [SC.L]: "ㅣ",
      [SC.Z]: "ㅋ", [SC.X]: "ㅌ", [SC.C]: "ㅊ", [SC.V]: "ㅍ", [SC.B]: "ㅠ",
      [SC.N]: "ㅜ", [SC.M]: "ㅡ",
    };
    for (const [code, jamo] of Object.entries(expected)) {
      expect(HANGUL_LABELS[Number(code)]).toBe(jamo);
    }
  });

  it("does not contain entries for non-letter keys", () => {
    expect(HANGUL_LABELS[SC.SPACE]).toBeUndefined();
    expect(HANGUL_LABELS[SC.ENTER]).toBeUndefined();
    expect(HANGUL_LABELS[SC.D1]).toBeUndefined();
    expect(HANGUL_LABELS[SC.F1]).toBeUndefined();
  });
});
