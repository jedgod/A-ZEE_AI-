import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const db = vi.hoisted(() => ({ getScan: vi.fn(), getCaption: vi.fn(), saveCaption: vi.fn() }));
vi.mock("@/lib/vision/scans", () => db);
vi.mock("@/lib/chat/web", () => ({ chatAllowed: async () => true }));
vi.mock("@/lib/sidebar-route", () => ({
  sidebarOwner: async () => "owner",
  body: (request: Request) => request.json(),
  handle: (work: () => Promise<Response>) => work(),
  NO_STORE: { "Cache-Control": "no-store" },
}));

import { checkCaption } from "@/lib/vision/caption";
import { GET as readPreview } from "@/app/api/vision/scans/[id]/compare/[source]/route";
import { GET as readCaption, POST as postCaption } from "@/app/api/vision/scans/[id]/caption/route";

const request = new Request("https://example.org");
const id = "8f18bb75-10cd-4af9-979c-929d810aea9f";
const source = "e".repeat(64);
const context = { params: Promise.resolve({ id, source }) };
const exact = { url: "https://example.org/photo", observedAt: "2024-01-01", kind: "exact" as const, caption: "Flooding in Bowie", previewId: source };

beforeEach(() => vi.resetAllMocks());

describe("image trace evidence", () => {
  it("compares wording only when an exact file has a recorded caption", () => {
    expect(checkCaption("  flooding   in BOWIE ", [exact]).status).toBe("same_wording");
    expect(checkCaption("Flooding in Annapolis", [exact]).status).toBe("different_wording");
    expect(checkCaption("Flooding in Bowie", [{ ...exact, kind: "possible" }]).status).toBe("insufficient_evidence");
    expect(checkCaption("Flooding in Bowie", [{ ...exact, caption: undefined }]).sources).toEqual([]);
  });

  it("loads and writes caption evidence only for the verified owner", async () => {
    const post = () => postCaption(new Request(request.url, { method: "POST", body: JSON.stringify({ caption: "Flooding in Bowie" }) }), context);
    expect((await readCaption(request, context)).status).toBe(404);
    expect((await post()).status).toBe(404);
    expect(db.saveCaption).not.toHaveBeenCalled();
    db.getScan.mockResolvedValue({ verification: { publicIndex: { matches: [exact] } } });
    db.saveCaption.mockResolvedValue({ result: { status: "same_wording" } });
    expect((await post()).status).toBe(200);
    expect(db.saveCaption).toHaveBeenCalledWith("owner", id, "Flooding in Bowie",
      expect.objectContaining({ status: "same_wording" }));
  });

  it("serves only JPEG previews recorded in an owned scan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "azee-preview-"));
    vi.stubEnv("AZ_IMAGE_PREVIEW_DIR", dir);
    const index = join(dir, "index.json");
    vi.stubEnv("AZ_IMAGE_INDEX_FILE", index);
    const entry = { url: exact.url, observedAt: exact.observedAt, sha256: source, dhash: null, comparisonAllowed: true };
    await writeFile(index, JSON.stringify([entry]));
    try {
      const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#abc" } }).jpeg().toBuffer();
      await writeFile(join(dir, `${source}.jpg`), jpeg);
      expect((await readPreview(request, context)).status).toBe(404);
      db.getScan.mockResolvedValue({ verification: { publicIndex: { matches: [] } } });
      expect((await readPreview(request, context)).status).toBe(404);
      db.getScan.mockResolvedValue({ verification: { publicIndex: { matches: [exact] } } });
      expect((await readPreview(request, { params: Promise.resolve({ id, source: "../sensitive" }) })).status).toBe(404);
      const response = await readPreview(request, context);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(jpeg);
      await writeFile(index, JSON.stringify([{ ...entry, comparisonAllowed: false }]));
      expect((await readPreview(request, context)).status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
