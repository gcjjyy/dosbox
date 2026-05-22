import { describe, it, expect } from "vitest";
import {
  DEFAULT_OPTIONS,
  parseOptions,
  serializeOptions,
} from "./options";

describe("options", () => {
  it("returns defaults for null/garbage input", () => {
    expect(parseOptions(null)).toEqual(DEFAULT_OPTIONS);
    expect(parseOptions("not json")).toEqual(DEFAULT_OPTIONS);
    expect(parseOptions("123")).toEqual(DEFAULT_OPTIONS);
  });

  it("defaults: cycles 8000, valign middle, opacity 1, resolution 640x480", () => {
    expect(DEFAULT_OPTIONS).toEqual({
      cycles: 8000,
      resolutionId: "640x480",
      canvasVAlign: "middle",
      keyboardOpacity: 1,
    });
  });

  it("reads and validates each field", () => {
    const raw = JSON.stringify({
      cycles: 12000,
      resolutionId: "800x600",
      canvasVAlign: "top",
      keyboardOpacity: 0.5,
    });
    expect(parseOptions(raw)).toEqual({
      cycles: 12000,
      resolutionId: "800x600",
      canvasVAlign: "top",
      keyboardOpacity: 0.5,
    });
  });

  it("clamps/falls back invalid field values", () => {
    const raw = JSON.stringify({
      cycles: 9_999_999,
      resolutionId: "bogus",
      canvasVAlign: "sideways",
      keyboardOpacity: 5,
    });
    expect(parseOptions(raw)).toEqual({
      cycles: 100000,
      resolutionId: "640x480",
      canvasVAlign: "middle",
      keyboardOpacity: 1,
    });
  });

  it("migrates legacy resolution key only when no blob exists", () => {
    expect(parseOptions(null, "1024x768").resolutionId).toBe("1024x768");
    // legacy ignored once a blob is present
    const raw = JSON.stringify({ resolutionId: "800x600" });
    expect(parseOptions(raw, "1024x768").resolutionId).toBe("800x600");
    // invalid legacy → default
    expect(parseOptions(null, "nope").resolutionId).toBe("640x480");
  });

  it("round-trips through serialize/parse", () => {
    const o = { cycles: 6000, resolutionId: "fullscreen" as const, canvasVAlign: "bottom" as const, keyboardOpacity: 0 };
    expect(parseOptions(serializeOptions(o))).toEqual(o);
  });
});
