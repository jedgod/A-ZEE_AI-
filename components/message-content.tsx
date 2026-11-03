import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MessageContent({ role, content }: { role: "user" | "assistant"; content: string }) {
  if (role === "user") return <div style={{ whiteSpace: "pre-wrap" }}>{content}</div>;
  return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    // Avoid loading untrusted remote images from generated content.
    img: ({ alt }) => <span>{alt || "[image]"}</span>,
  }}>{content}</ReactMarkdown>;
}
