export async function readJson(request: Request, limit: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw Response.json({ error: "JSON_REQUIRED" }, { status: 415 });
  }
  if (!request.body) throw new SyntaxError("Body required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw Response.json({ error: "BODY_TOO_LARGE" }, { status: 413 });
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
