import { describe, it, expect } from "vitest";
import { assertSameOrigin } from "./origin";

function req(headers: Record<string, string>): Request {
  return new Request("https://dosbox.gcjjyy.dev/api/save", {
    method: "POST",
    headers,
  });
}

describe("assertSameOrigin", () => {
  it("passes when Origin matches the request's host (via Host header)", () => {
    expect(() => assertSameOrigin(req({
      Origin: "https://dosbox.gcjjyy.dev",
      Host: "dosbox.gcjjyy.dev",
    }))).not.toThrow();
  });

  it("rejects mismatched Origin", () => {
    expect(() => assertSameOrigin(req({
      Origin: "https://evil.example",
      Host: "dosbox.gcjjyy.dev",
    }))).toThrow(/origin/i);
  });

  it("rejects missing Origin", () => {
    expect(() => assertSameOrigin(req({ Host: "dosbox.gcjjyy.dev" }))).toThrow(/origin/i);
  });
});
