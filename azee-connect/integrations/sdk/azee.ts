export class AZeeClient {
  constructor(private baseURL: string, private token: string) {}

  async chat(
    messages: { role: "user" | "assistant"; content: string }[],
    mode: "chat" | "code" | "research" = "chat"
  ): Promise<string> {
    const response = await fetch(this.baseURL.replace(/\/$/, "") + "/api/v1/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.token,
      },
      body: JSON.stringify({ mode, messages }),
      signal: AbortSignal.timeout(70000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "AZee request failed");
    if (typeof body.data?.answer !== "string") throw new Error("Invalid AZee response");
    return body.data.answer;
  }
}
// Keep the token server-side or in OS/IDE secret storage.
