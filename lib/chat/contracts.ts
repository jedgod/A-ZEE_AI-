import { z } from "zod";

export const MAX_MESSAGE_CHARACTERS = 20000;
// 09 style control: a fixed set of tones, each mapped to a fixed instruction server-side, so the
// choice can never carry arbitrary prompt text. "default" adds no style instruction.
export const ANSWER_STYLES = ["default", "concise", "professional", "friendly", "technical"] as const;
export type AnswerStyle = (typeof ANSWER_STYLES)[number];
export const chatRequestSchema = z.object({
  mode: z.enum(["chat", "code", "research"]).default("chat"),
  model: z.enum(["auto", "reasoning", "code"]).default("auto"),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(MAX_MESSAGE_CHARACTERS),
  }).strict()).min(1).max(24),
  // "json" asks for a structured {answer, citations, warnings} reply (06 structured_output_spec).
  format: z.enum(["text", "json"]).optional(),
  style: z.enum(ANSWER_STYLES).optional(),
  // The chat's project: its Settings instructions apply (local account only; ownership checked).
  projectId: z.string().uuid().optional(),
}).strict().refine(input => input.messages.at(-1)?.role === "user", {
  message: "The final message must be from the user", path: ["messages"],
});
export type ChatInput = z.infer<typeof chatRequestSchema>;
