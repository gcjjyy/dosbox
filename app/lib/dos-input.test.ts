import { describe, expect, it } from "vitest";
import {
  recoverSDLKeyCodeFromBrokenAsciiEvent,
  toSDLKeyCode,
} from "./dos-input";

describe("toSDLKeyCode", () => {
  it("maps ASCII letters to SDL lowercase key symbols", () => {
    expect(toSDLKeyCode(65)).toBe(97);
    expect(toSDLKeyCode(90)).toBe(122);
  });

  it("maps control keys used by canvas input and cycle controls", () => {
    expect(toSDLKeyCode(256)).toBe(27);
    expect(toSDLKeyCode(263)).toBe(1104);
    expect(toSDLKeyCode(265)).toBe(1106);
    expect(toSDLKeyCode(341)).toBe(1248);
    expect(toSDLKeyCode(300)).toBe(1092);
    expect(toSDLKeyCode(301)).toBe(1093);
  });

  it("maps punctuation directly instead of browser keyCode values", () => {
    expect(toSDLKeyCode(45)).toBe(45);
    expect(toSDLKeyCode(59)).toBe(59);
    expect(toSDLKeyCode(61)).toBe(61);
    expect(toSDLKeyCode(96)).toBe(96);
  });
});

describe("recoverSDLKeyCodeFromBrokenAsciiEvent", () => {
  it("recovers Android IME letter events that arrive as keyCode 229", () => {
    expect(recoverSDLKeyCodeFromBrokenAsciiEvent({
      key: "a",
      code: "",
      keyCode: 229,
      which: 229,
    })).toBe(97);
  });

  it("normalizes shifted letters to the SDL lowercase key symbol", () => {
    expect(recoverSDLKeyCodeFromBrokenAsciiEvent({
      key: "A",
      code: "Unidentified",
      keyCode: 229,
      which: 229,
    })).toBe(97);
  });

  it("recovers broken printable ASCII punctuation", () => {
    expect(recoverSDLKeyCodeFromBrokenAsciiEvent({
      key: "+",
      code: "",
      keyCode: 229,
      which: 229,
    })).toBe(43);
  });

  it("ignores normal events and non-ASCII IME text", () => {
    expect(recoverSDLKeyCodeFromBrokenAsciiEvent({
      key: "a",
      code: "KeyA",
      keyCode: 65,
      which: 65,
    })).toBeNull();
    expect(recoverSDLKeyCodeFromBrokenAsciiEvent({
      key: "ㅁ",
      code: "",
      keyCode: 229,
      which: 229,
    })).toBeNull();
  });
});
