import { describe, expect, it } from "vitest";
import { containWithin, resolveViewportCssVars } from "./viewport-layout";

describe("resolveViewportCssVars", () => {
  it("uses visualViewport height so browser chrome does not cover the app", () => {
    expect(resolveViewportCssVars({
      innerHeight: 844,
      visualViewport: { height: 724, offsetTop: 0 },
    })).toEqual({
      "--app-viewport-height": "724px",
      "--app-viewport-offset-top": "0px",
    });
  });

  it("keeps visual viewport offset when Safari shifts the visible area", () => {
    expect(resolveViewportCssVars({
      innerHeight: 844,
      visualViewport: { height: 520.5, offsetTop: 91.25 },
    })).toEqual({
      "--app-viewport-height": "520.5px",
      "--app-viewport-offset-top": "91.25px",
    });
  });

  it("falls back to layout viewport height when visualViewport is unavailable", () => {
    expect(resolveViewportCssVars({ innerHeight: 667 })).toEqual({
      "--app-viewport-height": "667px",
      "--app-viewport-offset-top": "0px",
    });
  });
});

describe("containWithin", () => {
  it("fits a fixed DOS canvas into a short mobile stage without changing aspect ratio", () => {
    const size = containWithin({
      source: { width: 640, height: 480 },
      bounds: { width: 390, height: 220 },
      maxScale: 1,
    });

    expect(size.width).toBeCloseTo(293.333, 3);
    expect(size.height).toBe(220);
  });

  it("does not upscale fixed-resolution canvases beyond their requested size", () => {
    expect(containWithin({
      source: { width: 640, height: 480 },
      bounds: { width: 1200, height: 900 },
      maxScale: 1,
    })).toEqual({ width: 640, height: 480 });
  });

  it("can upscale fullscreen canvases while preserving the source ratio", () => {
    expect(containWithin({
      source: { width: 640, height: 480 },
      bounds: { width: 1200, height: 900 },
    })).toEqual({ width: 1200, height: 900 });
  });
});
