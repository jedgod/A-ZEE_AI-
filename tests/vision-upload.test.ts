import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/web", () => ({ chatAllowed: async () => true }));
vi.mock("@/lib/sidebar-route", () => ({
  sidebarOwner: async () => "test-account",
  handle: (fn: () => Promise<Response>) => fn(),
  NO_STORE: { "Cache-Control": "no-store" },
}));
vi.mock("@/lib/vision/scans", () => ({ saveScan: async (_owner: string, result: unknown) => result }));

import { POST } from "@/app/api/vision/detect-ai/route";
import sharp from "sharp";

describe("image scan multipart route", () => {
  it("accepts an actual image even if the mobile client sends a generic MIME type", async () => {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#222" } }).png().toBuffer();
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(png)]), "image");
    const response = await POST(new Request("http://localhost/api/vision/detect-ai", { method: "POST", body: form }));
    expect(response.status).toBe(200);
    expect((await response.json()).data.verification.credential).toBe("absent");
  });

  it("rejects an oversized multipart body without depending on Content-Length", async () => {
    const init = { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=test" },
      body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(11 * 1024 * 1024)); c.close(); } }), duplex: "half" };
    const response = await POST(new Request("http://localhost/api/vision/detect-ai", init));
    expect(response.status).toBe(413);
  });
});
