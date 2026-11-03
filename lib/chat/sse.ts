// Browser side of /api/chat/stream (12 streaming delivery). Also accepts a plain JSON response,
// which is what the route returns for errors found before streaming starts.

export type StreamEvent =
  | { event: "status"; data: { stage: string } }
  | { event: "tool"; data: { name: string; status: string } }
  | { event: "delta"; data: { text: string } };

export type ChatResult = { ok: boolean; result: any };

const MAX_BUFFER = 2_000_000;

/** Parses one SSE frame ("event: x\ndata: {...}"). Unknown or malformed frames are ignored. */
export function parseFrame(frame: string): { event: string; data: any } | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try { return { event, data: JSON.parse(data.join("\n")) }; } catch { return null; }
}

export async function readChatResponse(res: Response, onEvent: (e: StreamEvent) => void): Promise<ChatResult> {
  if (!(res.headers.get("content-type") || "").includes("text/event-stream") || !res.body) {
    return { ok: res.ok, result: await res.json() };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > MAX_BUFFER) throw new Error("The answer was too large to display.");
      let cut: number;
      while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const frame = parseFrame(buffer.slice(0, cut));
        buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");
        if (!frame) continue;
        if (frame.event === "final") return { ok: true, result: { data: { answer, pipeline: frame.data.pipeline ?? {} } } };
        if (frame.event === "error") return { ok: false, result: frame.data };
        if (frame.event === "delta" && typeof frame.data.text === "string") answer += frame.data.text;
        if (frame.event === "status" || frame.event === "tool" || frame.event === "delta") onEvent(frame as StreamEvent);
      }
      if (done) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  throw new Error("The answer stream ended early. Please retry.");
}
