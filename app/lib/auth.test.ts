import { describe, it, expect, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.SESSION_SECRET = "x".repeat(40);
  process.env.DOSBOX_ADMIN_PASSWORD = "correct horse battery staple";
});

beforeEach(async () => {
  // reset rate limiter between tests
  const mod = await import("./auth.server");
  mod.__resetRateLimitForTests();
});

describe("verifyPassword", () => {
  it("accepts the configured password", async () => {
    const { verifyPassword } = await import("./auth.server");
    expect(verifyPassword("correct horse battery staple")).toBe(true);
  });

  it("rejects wrong password", async () => {
    const { verifyPassword } = await import("./auth.server");
    expect(verifyPassword("wrong")).toBe(false);
  });

  it("rejects empty password", async () => {
    const { verifyPassword } = await import("./auth.server");
    expect(verifyPassword("")).toBe(false);
  });
});

describe("login rate limit", () => {
  it("allows up to 10 attempts per IP per minute", async () => {
    const { checkLoginRate } = await import("./auth.server");
    for (let i = 0; i < 10; i++) {
      expect(checkLoginRate("1.2.3.4")).toBe(true);
    }
    expect(checkLoginRate("1.2.3.4")).toBe(false);
  });

  it("tracks IPs independently", async () => {
    const { checkLoginRate } = await import("./auth.server");
    for (let i = 0; i < 10; i++) checkLoginRate("1.2.3.4");
    expect(checkLoginRate("1.2.3.4")).toBe(false);
    expect(checkLoginRate("5.6.7.8")).toBe(true);
  });
});
