import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

beforeEach(() => {
  delete process.env.PUBLIC_BASE_URL;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.PUBLIC_BASE_URL;
  vi.restoreAllMocks();
});

describe("prewarm", () => {
  it("prewarmUrl builds the versioned bundle URL and trims a trailing slash", async () => {
    const { prewarmUrl } = await import("./bundle");
    expect(prewarmUrl("https://dosbox.gcjjyy.dev/", "v9")).toBe(
      "https://dosbox.gcjjyy.dev/dos.zip?v=v9",
    );
  });

  it("prewarmBundle is a no-op (no fetch) when PUBLIC_BASE_URL is unset", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { prewarmBundle } = await import("./bundle");
    await prewarmBundle("v9");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("prewarmBundle fetches the public versioned URL when configured", async () => {
    process.env.PUBLIC_BASE_URL = "https://dosbox.gcjjyy.dev";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "cf-cache-status": "MISS" },
      }),
    );
    const { prewarmBundle } = await import("./bundle");
    await prewarmBundle("v9");
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe("https://dosbox.gcjjyy.dev/dos.zip?v=v9");
  });
});
