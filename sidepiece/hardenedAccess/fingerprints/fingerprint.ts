// lib/fingerprint.ts
// Client-side fingerprint that matches the server’s expected simple hash.
// Call once per browser session and send the result to /api/signals/record.

export async function generateFingerprint(): Promise<string> {
  const parts = [
    navigator.userAgent,
    navigator.language,
    navigator.languages?.join(",") ?? "",
    screen.width + "x" + screen.height,
    screen.colorDepth?.toString() ?? "",
    new Date().getTimezoneOffset().toString(),
    // Optional lightweight extras (still basic)
    (navigator as any).hardwareConcurrency?.toString() ?? "",
    (navigator as any).deviceMemory?.toString() ?? "",
  ]

  const raw = parts.join("|")
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// Helper to call the record endpoint (include credentials so the HttpOnly az_dev cookie is sent)
export async function recordDeviceSignal(action: "signup" | "login" | "free_usage" = "free_usage") {
  const fingerprint = await generateFingerprint()
  await fetch("/api/signals/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ fingerprint, action }),
  }).catch(() => {})
}
