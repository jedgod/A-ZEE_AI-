// Browser-safe random ids. `crypto.randomUUID` only exists on secure pages (HTTPS or localhost),
// so opening the app over plain http on a LAN address (npm run dev:lan) would throw. This returns
// the same RFC 4122 version-4 UUIDs either way; the server validates chat and project ids as UUIDs.

export function newId(): string {
  const c = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256); // last resort: ids only need to be unique, not secret
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
