import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/db", () => ({ pool: {} }));
import { originAllowed } from "@/lib/users/auth";

const LAN = "http://10.0.0.176:3001";
describe("origin check for writes", () => {
  it("always accepts the configured origin", () => {
    expect(originAllowed(LAN, LAN, false)).toBe(true);
    expect(originAllowed(LAN, LAN, true)).toBe(true);
  });
  it("in development also accepts loopback names on the same scheme and port (the localhost vs LAN sign-in problem)", () => {
    for (const o of ["http://localhost:3001", "http://127.0.0.1:3001", "http://[::1]:3001"]) expect(originAllowed(o, LAN, false)).toBe(true);
  });
  it("still refuses other sites, other ports, other schemes and look-alikes in development", () => {
    for (const o of ["http://localhost:3000", "https://localhost:3001", "http://evil.example:3001", "http://localhost.evil.example:3001", "http://10.0.0.99:3001", "null", "not a url"]) expect(originAllowed(o, LAN, false)).toBe(false);
  });
  it("in production only the exact configured origin passes, loopback included", () => {
    for (const o of ["http://localhost:3001", "http://127.0.0.1:3001"]) expect(originAllowed(o, LAN, true)).toBe(false);
    expect(originAllowed("https://app.example.com", "https://app.example.com", true)).toBe(true);
    expect(originAllowed("https://evil.example", "https://app.example.com", true)).toBe(false);
  });
});
