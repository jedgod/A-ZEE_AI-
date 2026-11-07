// Browser-side. A privacy-conscious hash of ordinary browser properties (no canvas or WebGL
// probing). It is a hint for abuse prevention, never an identifier on its own: many people share
// the same browser setup, so the server only links accounts when it matches together with the
// network, or when the server-issued device cookie matches.
//
// The server decides what each report means (sign-up, sign-in or free use), so the browser only
// ever sends the hash.

type NavigatorExtras = Navigator & { deviceMemory?: number };

export async function browserFingerprint(): Promise<string | undefined> {
  try {
    const nav = navigator as NavigatorExtras;
    const parts = [
      nav.userAgent,
      nav.language,
      nav.languages?.join(",") ?? "",
      nav.platform,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      String(new Date().getTimezoneOffset()),
      String(nav.hardwareConcurrency ?? ""),
      String(nav.deviceMemory ?? ""),
    ].join("|");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch { return undefined; } // insecure context or a privacy tool: simply no fingerprint
}
