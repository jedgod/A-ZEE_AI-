import { z } from "zod";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(20000),
});

const chatRequestSchema = z.object({
  mode: z.enum(["chat", "code", "research"]).default("chat"),
  model: z.enum(["auto", "reasoning", "code"]).default("auto"),
  messages: z.array(messageSchema).min(1).max(20),
}).strict();

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return Response.json({ error: "Content-Type must be application/json" }, { status: 400 });
    }

    const body = await request.json();
    const input = chatRequestSchema.parse(body);

    const latestMessage = input.messages.at(-1)?.content ?? "";
    const modeLabel = input.mode === "research" ? "research" : input.mode === "code" ? "code" : "chat";
    const answer = [
      `# ${modeLabel.toUpperCase()} response`,
      "",
      `Mode: **${input.mode}**`,
      `Model: **${input.model}**`,
      "",
      "## Prompt summary",
      `> ${latestMessage}`,
      "",
      "## Response",
      "This workspace is ready for a user-facing conversation flow. The request was accepted and routed through the public chat endpoint. Use the message history to continue the thread, switch modes for code or research, and keep the response in markdown format as requested.",
    ].join("\n");

    return Response.json({
      data: {
        answer,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request body";
    return Response.json({ error: message }, { status: 400 });
  }
}
