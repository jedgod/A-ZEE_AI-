import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/chat/route";

describe("public chat route", () => {
  it("returns a markdown answer shape for the requested chat payload", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "chat",
          model: "auto",
          messages: [{ role: "user", content: "Help me plan the next sprint." }],
        }),
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toHaveProperty("data.answer");
    expect(String(payload.data.answer)).toContain("# CHAT response");
    expect(String(payload.data.answer)).toContain("Mode: **chat**");
  });
});
