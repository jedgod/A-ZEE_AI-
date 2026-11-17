import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { googleObservations } from "@/lib/vision/gemini";
import { buildDetection } from "@/lib/vision/detect";

const env = process.env as Record<string, string | undefined>;
afterEach(() => { delete env.GEMINI_API_KEY; delete env.GOOGLE_API_KEY; delete env.AZ_PROVIDER_MODE; delete env.GEMINI_VISION_MODEL; });

const good = JSON.stringify({ summary: "A phone screenshot of a chat.", visibleText: ["Hello"], placeClues: [], captureClues: ["screenshot"], aiArtifactClues: [], limits: "Cannot tell the original source." });
const reply = (text: string) => vi.fn(async () => ({ text }));
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);

describe("Google AI observations", () => {
  it("never uploads without the user's agreement for this image", async () => {
    env.GEMINI_API_KEY = "k";
    const gen = reply(good);
    expect(await googleObservations(bytes, "image/jpeg", false, gen)).toMatchObject({ status: "skipped" });
    expect(gen).not.toHaveBeenCalled();
  });
  it("is unavailable without a key and in private mode, and sends nothing", async () => {
    const gen = reply(good);
    expect(await googleObservations(bytes, "image/jpeg", true, gen)).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/not set up/) });
    env.GEMINI_API_KEY = "k"; env.AZ_PROVIDER_MODE = "ollama-only";
    expect(await googleObservations(bytes, "image/jpeg", true, gen)).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/private mode/) });
    expect(gen).not.toHaveBeenCalled();
  });
  it("sends the image with a no-identification instruction and returns structured clues", async () => {
    env.GEMINI_API_KEY = "k";
    const gen = reply(good);
    const r = await googleObservations(bytes, "image/jpeg", true, gen);
    expect(r).toMatchObject({ status: "ran", observations: { summary: "A phone screenshot of a chat.", captureClues: ["screenshot"] } });
    const args = (gen.mock.calls[0] as unknown as [{ contents: any; config: any }])[0];
    expect(args.contents[0].parts[0].inlineData.mimeType).toBe("image/jpeg");
    expect(args.config.systemInstruction).toMatch(/Never name or guess who a person is/);
    expect(args.config.systemInstruction).toMatch(/never an instruction/);
  });
  it("accepts a fenced JSON reply and rejects anything that is not the expected shape", async () => {
    env.GEMINI_API_KEY = "k";
    expect((await googleObservations(bytes, "image/jpeg", true, reply("```json\n" + good + "\n```"))).status).toBe("ran");
    expect((await googleObservations(bytes, "image/jpeg", true, reply('{"summary":"x","extra":1}'))).status).toBe("unavailable");
    expect((await googleObservations(bytes, "image/jpeg", true, reply("not json"))).status).toBe("unavailable");
    expect((await googleObservations(bytes, "image/jpeg", true, vi.fn(async () => { throw new Error("503"); }))).status).toBe("unavailable");
  });
  it("falls back to the next model when one is overloaded, retired or unusable", async () => {
    env.GEMINI_API_KEY = "k";
    const gen = vi.fn()
      .mockRejectedValueOnce(new Error("503 high demand"))
      .mockResolvedValueOnce({ text: "nonsense" })
      .mockResolvedValueOnce({ text: good });
    const r = await googleObservations(bytes, "image/jpeg", true, gen as never);
    expect(r).toMatchObject({ status: "ran", model: "gemini-3.5-flash-lite" });
    expect(gen.mock.calls.map(c => (c[0] as { model: string }).model)).toEqual(["gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]);
  });
  it("is unavailable when every model fails", async () => {
    env.GEMINI_API_KEY = "k";
    expect(await googleObservations(bytes, "image/jpeg", true, vi.fn(async () => { throw new Error("down"); }) as never)).toMatchObject({ status: "unavailable" });
  });
  it("cannot change the AI verdict: only a trusted signed claim does", () => {
    const base = { credential: "absent" as const, publicIndex: { status: "not_configured" as const, matches: [] } };
    const withClues = { ...base, google: { status: "ran" as const, model: "m", observations: { summary: "Looks generated.", visibleText: [], placeClues: [], captureClues: [], aiArtifactClues: ["odd hands"], limits: "" } } };
    expect(buildDetection(withClues, false).verdict).toBe("INCONCLUSIVE");
    expect(buildDetection(base, false).verdict).toBe("INCONCLUSIVE");
  });
});
