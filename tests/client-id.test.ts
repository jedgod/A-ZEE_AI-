import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "@/lib/client-id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId (works on insecure http pages)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses crypto.randomUUID when the page is a secure context", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111", getRandomValues: () => { throw new Error("unused"); } });
    expect(newId()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("builds a valid v4 UUID from getRandomValues when randomUUID is missing (http on a LAN address)", () => {
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => { a.fill(0xff); return a; } });
    expect(() => newId()).not.toThrow();
    expect(newId()).toMatch(UUID_V4);
    const ids = new Set<string>();
    let seed = 123456789; // a small xorshift generator: deterministic, but different on every call
    const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) & 0xff; };
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = next(); return a; } });
    for (let i = 0; i < 200; i++) ids.add(newId());
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it("still returns a valid UUID with no Web Crypto at all", () => {
    vi.stubGlobal("crypto", undefined);
    expect(newId()).toMatch(UUID_V4);
  });
});
