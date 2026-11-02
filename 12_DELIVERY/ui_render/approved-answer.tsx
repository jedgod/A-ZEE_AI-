// ============================================================
// 12_DELIVERY / UI_RENDER / SHADCN COMPONENT
// File: components/approved-answer.tsx
// Install shadcn: separator. Configure Tailwind.
// ============================================================

import { Separator } from "@/components/ui/separator";

type Props = {
  text: string;
  warnings: string[];
  citations: Array<{ sourceId: string; url: string }>;
};

export function ApprovedAnswer({ text, warnings, citations }: Props) {
  return (
    <article className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Final answer</h1>
      <div className="whitespace-pre-wrap leading-7">{text}</div>
      {warnings.length > 0 && (
        <aside aria-label="Warnings" className="border-l-2 pl-4 text-sm">
          {warnings.map((warning, i) => <p key={i}>{warning}</p>)}
        </aside>
      )}
      <Separator />
      <ul className="space-y-2 text-sm">
        {citations.map(source => {
          let safe = false;
          try {
            const url = new URL(source.url);
            safe = url.protocol === "https:" && !url.username && !url.password;
          } catch {}
          return (
            <li key={source.sourceId}>
              {safe ? (
                <a href={source.url} target="_blank" rel="noopener noreferrer"
                  className="underline underline-offset-4">
                  {source.sourceId}
                </a>
              ) : source.sourceId}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

// Parent must obtain this artifact through owner-scoped delivery API.
// React escapes text. Never insert generated raw HTML.
