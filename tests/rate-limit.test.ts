import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

describe("rateLimit", () => {
  it("allows requests up to the limit, then blocks", async () => {
    const id = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      const result = await rateLimit(id, 3, 60);
      expect(result.allowed).toBe(true);
    }
    const blocked = await rateLimit(id, 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("keeps separate counters per identifier", async () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    await rateLimit(a, 1, 60);
    const resultA = await rateLimit(a, 1, 60);
    const resultB = await rateLimit(b, 1, 60);
    expect(resultA.allowed).toBe(false);
    expect(resultB.allowed).toBe(true);
  });
});

describe("getClientIp", () => {
  it("reads the first address from x-forwarded-for", () => {
    const req = new NextRequest("http://localhost/api/room", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip, then unknown", () => {
    const withRealIp = new NextRequest("http://localhost/api/room", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(getClientIp(withRealIp)).toBe("9.9.9.9");

    const withNeither = new NextRequest("http://localhost/api/room");
    expect(getClientIp(withNeither)).toBe("unknown");
  });
});
