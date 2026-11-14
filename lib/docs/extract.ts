import "server-only";

// Text extraction for Docs Analysis. Stateless: the text goes back to the caller, who attaches it to the
// chat message in the pipeline's "Attached file:" format, so follow-up questions keep it in the conversation
// history and nothing from a contract or receipt is stored on the server.

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Under the chat message limit (20,000 characters) so a question still fits next to the document. */
export const MAX_DOC_CHARACTERS = 15_000;

export class DocError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export type Extracted = { fileName: string; kind: "pdf" | "docx" | "text"; text: string; characters: number; truncated: boolean };

const TEXT_EXT = /\.(txt|csv|tsv|md|json|log)$/i;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const clean = (raw: string) => raw.replace(/\r\n?/g, "\n").replace(/[^\S\n]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/\u0000/g, "").trim();

/** A file name that is safe to put on the "Attached file:" line (single line, no path). */
export const safeName = (name: string) => (name.split(/[\\/]/).pop() ?? "document").replace(/[\r\n\u0000-\u001f]+/g, " ").trim().slice(0, 120) || "document";

export async function extractText(bytes: Uint8Array, mimeType: string, fileName: string): Promise<Extracted> {
  const name = safeName(fileName);
  if (bytes.byteLength === 0) throw new DocError(422, "EMPTY_FILE");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new DocError(413, "FILE_TOO_LARGE");
  let kind: Extracted["kind"], raw: string;
  try {
    if (mimeType === "application/pdf" || /\.pdf$/i.test(name)) {
      kind = "pdf";
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes)); // copy: pdf.js takes ownership of the buffer
      raw = (await pdfText(pdf, { mergePages: true })).text as string;
    } else if (mimeType === DOCX_MIME || /\.docx$/i.test(name)) {
      kind = "docx";
      const mammoth = await import("mammoth");
      raw = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    } else if (mimeType.startsWith("text/") || mimeType === "application/json" || TEXT_EXT.test(name)) {
      kind = "text";
      raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } else throw new DocError(415, "UNSUPPORTED_FORMAT");
  } catch (error) {
    if (error instanceof DocError) throw error;
    throw new DocError(422, "UNREADABLE_DOCUMENT"); // corrupt, encrypted, or not really that format
  }
  const text = clean(raw);
  if (!text) throw new DocError(422, "NO_TEXT_FOUND"); // e.g. a scanned PDF with no text layer
  const truncated = text.length > MAX_DOC_CHARACTERS;
  return { fileName: name, kind, text: truncated ? text.slice(0, MAX_DOC_CHARACTERS) : text, characters: text.length, truncated };
}

/** The message body the chat pipeline recognises as an attached file. */
export const attachmentBlock = (doc: Pick<Extracted, "fileName" | "text">) => `\n\nAttached file: ${doc.fileName}\n${doc.text}`;
