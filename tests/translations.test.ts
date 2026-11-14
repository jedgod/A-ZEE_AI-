import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/db", () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

import { clearTranslations, listTranslations, saveTranslation } from "@/lib/translations";
import { TRANSLATION_TARGETS } from "@/lib/pipeline/translate";
import { runTranslation } from "@/11_POSTPROCESS/translation/module";

beforeEach(() => query.mockReset());

describe("translation languages", () => {
  it("covers the ten requested languages", () => {
    for (const code of ["en", "de", "nl", "hi", "sw", "ru", "zh", "ja", "tw", "ee"]) expect(TRANSLATION_TARGETS).toContain(code);
  });
  it("accepts Twi and Ewe but rejects unknown codes", async () => {
    const translator = { translate: async ({ text }: { text: string }) => `T:${text}` };
    await expect(runTranslation({ text: "Good morning", targetLanguage: "tw" }, translator)).resolves.toMatchObject({ language: "tw" });
    await expect(runTranslation({ text: "Good morning", targetLanguage: "ee" }, translator)).resolves.toMatchObject({ language: "ee" });
    await expect(runTranslation({ text: "Good morning", targetLanguage: "xx" }, translator)).rejects.toThrow();
  });
});

describe("translation history", () => {
  it("saves a translation then trims the account to its latest 30", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await saveTranslation("u1", { targetLang: "tw", sourceText: "hello", translatedText: "akwaaba", provider: "ollama" });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1]).toEqual(["u1", "tw", "hello", "akwaaba", "ollama"]);
    expect(String(query.mock.calls[1][0])).toContain("LIMIT 30");
  });
  it("only ever reads and clears the caller's own rows", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 3 });
    await listTranslations("u1", 500);
    expect(query.mock.calls[0][1]).toEqual(["u1", 30]);
    expect(await clearTranslations("u1")).toBe(3);
    expect(query.mock.calls[1][1]).toEqual(["u1"]);
  });
});
