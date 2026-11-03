import { describe, expect, it } from "vitest";
import { fieldsOf, settingsPatch, type Field } from "@/lib/plugins/fields";

describe("plugin settings validation", () => {
  it("accepts a plugin's own keys and rejects unknown keys, wrong types and oversize values", () => {
    const gmail = settingsPatch(fieldsOf("gmail"));
    expect(gmail.parse({ defaultQuery: "is:unread" })).toEqual({ defaultQuery: "is:unread" });
    expect(gmail.parse({})).toEqual({});
    expect(() => gmail.parse({ other: "x" })).toThrow();
    expect(() => gmail.parse({ defaultQuery: 5 })).toThrow();
    expect(() => gmail.parse({ defaultQuery: "x".repeat(201) })).toThrow();
  });

  it("supports secret (clearable), boolean and select fields; plugins without settings accept nothing", () => {
    const fields: Field[] = [
      { key: "apiKey", label: "API key", type: "secret" },
      { key: "safe", label: "Safe mode", type: "boolean" },
      { key: "region", label: "Region", type: "select", options: ["eu", "us"] },
    ];
    const schema = settingsPatch(fields);
    expect(schema.parse({ apiKey: "sk-1", safe: true, region: "eu" })).toMatchObject({ region: "eu" });
    expect(schema.parse({ apiKey: null })).toEqual({ apiKey: null });
    expect(() => schema.parse({ apiKey: "" })).toThrow();
    expect(() => schema.parse({ region: "mars" })).toThrow();
    expect(fieldsOf("github")).toEqual([]);
    expect(() => settingsPatch(fieldsOf("github")).parse({ anything: 1 })).toThrow();
  });
});
