"use client";

import { useState } from "react";
import { Languages, ThumbsDown, ThumbsUp } from "lucide-react";
import { MessageContent } from "@/components/message-content";
import styles from "./answer-feedback.module.css";

const LANGUAGES = [["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["ja", "Japanese"]] as const;

type State = "idle" | "sending" | "error";

/** 13_FEEDBACK rating/correction and 11_POSTPROCESS translation for one answer. */
export function AnswerFeedback({ requestId, answer }: { requestId: string; answer: string }) {
  const [rating, setRating] = useState<1 | 5 | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState("");
  const [correctionSent, setCorrectionSent] = useState(false);
  const [escalate, setEscalate] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [state, setState] = useState<State>("idle");
  const [translation, setTranslation] = useState<{ language: string; text: string } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState("");

  async function translate(language: string) {
    if (!language) return setTranslation(null);
    setTranslating(true); setTranslateError("");
    try {
      const response = await fetch("/api/translate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: answer.slice(0, 20000), targetLanguage: language }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error === "PLAN_LIMIT_REACHED" ? `Your ${json.plan} plan's monthly messages are used up.` : "Translation isn't available right now.");
      setTranslation({ language, text: json.data.text });
    } catch (error) {
      setTranslateError((error as Error).message);
    } finally {
      setTranslating(false);
    }
  }

  async function send(body: { rating?: number; correction?: string }) {
    setState("sending");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, ...body }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(String(response.status));
      setState("idle");
      return true;
    } catch {
      setState("error");
      return false;
    }
  }

  async function rate(value: 1 | 5) {
    if (state === "sending" || rating === value) return;
    if (await send({ rating: value })) {
      setRating(value);
      setCorrecting(value === 1 && !correctionSent);
    }
  }

  async function submitCorrection(e: React.FormEvent) {
    e.preventDefault();
    if (!correction.trim()) return;
    if (await send({ correction: correction.trim() })) {
      setCorrectionSent(true);
      setCorrecting(false);
      // Optionally hand it to a person: files a complaint in the operations queue, linked to this answer.
      if (escalate) {
        const response = await fetch("/api/support", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: "feedback", subject: "Feedback on an answer", body: correction.trim(), requestId }),
        }).catch(() => null);
        const json = response?.ok ? await response.json() : null;
        setTicket(json?.data?.id ?? null);
        if (!json) setState("error");
      }
    }
  }

  return (
    <div className={styles.feedback}>
      <div className={styles.buttons} role="group" aria-label="Rate this answer">
        <button type="button" aria-pressed={rating === 5} aria-label="Helpful" title="Helpful" onClick={() => rate(5)} disabled={state === "sending"}>
          <ThumbsUp size={14} />
        </button>
        <button type="button" aria-pressed={rating === 1} aria-label="Not helpful" title="Not helpful" onClick={() => rate(1)} disabled={state === "sending"}>
          <ThumbsDown size={14} />
        </button>
        <label className={styles.translate} title="Translate this answer">
          <Languages size={14} aria-hidden="true" />
          <select aria-label="Translate answer" value={translation?.language ?? ""} disabled={translating} onChange={e => translate(e.target.value)}>
            <option value="">{translating ? "Translating…" : "Translate"}</option>
            {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <span className={styles.note} role="status">
          {state === "error" ? "Couldn't save feedback." : ticket ? `Thanks. Sent to support as ${ticket}.` : correctionSent ? "Thanks, correction saved." : rating ? "Thanks for the feedback." : ""}
        </span>
      </div>
      {translateError && <p className={styles.note} role="alert">{translateError}</p>}
      {translation && (
        <section className={styles.translation} aria-label="Translation">
          <div className={styles.translationHead}>{LANGUAGES.find(([c]) => c === translation.language)?.[1]} translation · <button type="button" onClick={() => setTranslation(null)}>Show original only</button></div>
          <MessageContent role="assistant" content={translation.text} />
        </section>
      )}
      {correcting && (
        <form className={styles.correction} onSubmit={submitCorrection}>
          <label htmlFor={`correction-${requestId}`}>What should the answer have said? (optional)</label>
          <textarea id={`correction-${requestId}`} value={correction} onChange={e => setCorrection(e.target.value)} maxLength={5000} rows={3} />
          <label className={styles.escalate}>
            <input type="checkbox" checked={escalate} onChange={e => setEscalate(e.target.checked)} /> Also send to the support team for follow-up
          </label>
          <div className={styles.actions}>
            <button type="button" onClick={() => setCorrecting(false)}>Skip</button>
            <button type="submit" className={styles.primary} disabled={!correction.trim() || state === "sending"}>Send correction</button>
          </div>
        </form>
      )}
    </div>
  );
}
