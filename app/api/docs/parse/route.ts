import { chatAllowed, sameOrigin } from "@/lib/chat/web";
import { attachmentBlock, DocError, extractText, MAX_UPLOAD_BYTES } from "@/lib/docs/extract";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

/**
 * POST /api/docs/parse (multipart, field "file") -> { data: { fileName, kind, text, characters, truncated, attachment } }.
 * Extracts text from a PDF, Word (.docx), CSV or plain-text file. Nothing is stored: append `attachment` to
 * the user's chat message and the document stays in the conversation for follow-up questions.
 * Shares the chat rate limit.
 */
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "INVALID_ORIGIN" }, { status: 403, headers });
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_UPLOAD_BYTES + 100_000) return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413, headers });
    if (!await chatAllowed(request)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) return Response.json({ error: "NO_FILE" }, { status: 400, headers });
    if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413, headers });
    const doc = await extractText(new Uint8Array(await file.arrayBuffer()), file.type, file.name);
    return Response.json({ data: { ...doc, attachment: attachmentBlock(doc) } }, { headers });
  } catch (error) {
    if (error instanceof DocError) return Response.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof TypeError) return Response.json({ error: "INVALID_UPLOAD" }, { status: 400, headers }); // not multipart
    console.warn("docs parse failed:", (error as Error)?.message?.slice(0, 200));
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}
