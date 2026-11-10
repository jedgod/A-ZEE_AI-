import { api } from "./api";
import { MAX_CONTEXT_MESSAGES, MAX_MESSAGE_CHARACTERS } from "./config";

export type Msg = { role: "user" | "assistant"; content: string };
export type ChatMode = "chat" | "code";
export type ChatSummary = { id: string; title: string; mode: string; messageCount?: number; updatedAt: string; pinned?: boolean };

/** Sends the conversation to A-Zee and returns the answer plus any notes (for example the free-plan notice). */
export async function ask(mode: ChatMode, messages: Msg[]): Promise<{ answer: string; notes: string[] }> {
  // The server accepts at most 24 messages, ending with the user's.
  const context = messages.slice(-MAX_CONTEXT_MESSAGES).map(m => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARACTERS) }));
  const result = await api<{ answer: string; pipeline?: { warnings?: string[] } }>("/api/chat", { method: "POST", body: { mode, model: "auto", messages: context } });
  return { answer: result.answer, notes: result.pipeline?.warnings ?? [] };
}

/** Saves the conversation to the account so it shows up in the website and on other devices. */
export async function saveChat(id: string, mode: ChatMode, messages: Msg[]): Promise<void> {
  const first = messages.find(m => m.role === "user")?.content.replace(/\s+/g, " ").trim() ?? "New chat";
  await api(`/api/chats/${id}`, { method: "PUT", body: { title: first.slice(0, 80) || "New chat", mode, messages: messages.map(m => ({ role: m.role, content: m.content.slice(0, 40_000) })) } });
}

export async function loadChat(id: string): Promise<{ id: string; mode: ChatMode; messages: Msg[] }> {
  const chat = await api<{ id: string; mode: string; messages: { role: "user" | "assistant"; content: string }[] }>(`/api/chats/${id}`);
  return { id: chat.id, mode: chat.mode === "code" ? "code" : "chat", messages: chat.messages.map(m => ({ role: m.role, content: m.content })) };
}

export const listChats = () => api<ChatSummary[]>("/api/chats?limit=100");
export const deleteChat = (id: string) => api(`/api/chats/${id}`, { method: "DELETE" });
