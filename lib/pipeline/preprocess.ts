// 02_PREPROCESS, TypeScript port of the Python modules in /02_PREPROCESS.
// normalize -> detect language -> safety check -> reversible PII redaction.

export type LanguageResult = { language: string; confidence: number };

// --- normalize_input --------------------------------------------------------
// NFC (not NFKC) so code and string literals keep their exact characters. Zero-width
// joiners (U+200C/U+200D) stay: emoji and several scripts depend on them.
export function normalizeInput(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B\u2060\uFEFF]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split("\n").map(line => line.replace(/[ \t]+$/, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

// --- language_detect --------------------------------------------------------
const SCRIPTS: [string, number, RegExp][] = [
  ["ja", 0.95, /[぀-ヿ]/u],
  ["ko", 0.95, /[가-힯ᄀ-ᇿ]/u],
  ["zh", 0.9, /[一-鿿㐀-䶿]/u],
  ["ru", 0.8, /[Ѐ-ӿ]/u],
  ["ar", 0.85, /[؀-ۿ]/u],
  ["hi", 0.85, /[ऀ-ॿ]/u],
  ["el", 0.9, /[Ͱ-Ͽ]/u],
  ["he", 0.9, /[֐-׿]/u],
  ["th", 0.9, /[฀-๿]/u],
];
const LATIN: Record<string, [string, Set<string>]> = {
  es: ["¿¡ñ", new Set(["el", "la", "los", "las", "que", "de", "y", "es", "por", "para", "con", "una"])],
  de: ["äöüß", new Set(["der", "die", "das", "und", "ist", "nicht", "ich", "mit", "ein", "eine"])],
  fr: ["çœàèùâêîôû", new Set(["le", "la", "les", "et", "est", "pas", "je", "vous", "une", "des", "pour"])],
  pt: ["ãõ", new Set(["o", "os", "não", "uma", "com", "para", "que", "é", "da", "do"])],
  it: ["òì", new Set(["il", "gli", "che", "non", "una", "per", "con", "è", "della"])],
  en: ["", new Set(["the", "and", "is", "are", "you", "to", "of", "it", "that", "with", "for", "this"])],
};
export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", de: "German", fr: "French", pt: "Portuguese", it: "Italian", ja: "Japanese",
  ko: "Korean", zh: "Chinese", ru: "Russian", ar: "Arabic", hi: "Hindi", el: "Greek", he: "Hebrew", th: "Thai",
};

export function detectLanguage(text: string): LanguageResult {
  const letters = [...text].filter(ch => /\p{L}/u.test(ch));
  if (!letters.length) return { language: "unknown", confidence: 0 };
  for (const [language, confidence, script] of SCRIPTS) {
    if (letters.filter(ch => script.test(ch)).length / letters.length >= 0.3) return { language, confidence };
  }
  const lowered = text.toLowerCase();
  const words = new Set(lowered.split(/\s+/).map(w => w.replace(/^[.,;:!?¿¡"'()]+|[.,;:!?¿¡"'()]+$/g, "")));
  const scores = Object.entries(LATIN).map(([lang, [chars, common]]) =>
    [lang, 2 * [...chars].filter(ch => lowered.includes(ch)).length + [...words].filter(w => common.has(w)).length] as const);
  scores.sort((a, b) => b[1] - a[1]);
  const [[best, top], [, second]] = scores;
  if (top === 0) return { language: "en", confidence: 0.4 };
  return { language: best, confidence: Math.round(Math.min(0.95, 0.5 + 0.1 * (top - second)) * 100) / 100 };
}

// --- safety_filter ----------------------------------------------------------
export const DEFAULT_BLOCKED_PHRASES = ["build a bomb", "make malware", "steal credentials", "carding", "phishing kit"];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function safetyCheck(text: string, phrases = DEFAULT_BLOCKED_PHRASES): { passed: boolean; reasons: string[] } {
  // Whole words, any whitespace between them: "discarding" does not trip "carding".
  const lowered = text.toLowerCase();
  const reasons = phrases
    .filter(p => new RegExp(`\\b${p.toLowerCase().split(/\s+/).map(escape).join("\\s+")}\\b`).test(lowered))
    .map(p => `blocked phrase detected: ${p}`);
  return { passed: reasons.length === 0, reasons };
}

// --- pii_redaction ----------------------------------------------------------
export function luhnValid(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

type PiiKind = "EMAIL" | "CARD" | "SSN" | "PHONE" | "IPV4";
const PII: [PiiKind, RegExp, (m: string) => boolean][] = [
  ["EMAIL", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, () => true],
  ["CARD", /(?<![\w-])\d(?:[ -]?\d){12,18}(?![\w-])/g, luhnValid],
  ["SSN", /\b\d{3}-\d{2}-\d{4}\b/g, () => true],
  ["PHONE", /(?<![\w+])(?:\+\d{1,3}[-.\s]?)?(?:\(\d{3}\)\s?|\d{3}[-.\s]?)\d{3}[-.\s]?\d{4}(?!\w)/g, () => true],
  ["IPV4", /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, () => true],
];

/**
 * Reversible redaction: each distinct value gets a stable placeholder such as [EMAIL_1] across
 * every message in the request. The provider only sees placeholders; restore() puts the user's
 * own values back into the answer. The vault lives only for one request and is never logged.
 */
export class PiiVault {
  private byValue = new Map<string, string>();
  private byToken = new Map<string, string>();
  private next: Record<string, number> = {};
  readonly counts: Partial<Record<Lowercase<PiiKind>, number>> = {};

  constructor(private kinds: PiiKind[] = PII.map(([k]) => k)) {}

  redact(text: string): string {
    let out = text;
    for (const [kind, pattern, accept] of PII) {
      if (!this.kinds.includes(kind)) continue;
      out = out.replace(pattern, match => {
        if (!accept(match)) return match;
        let token = this.byValue.get(match);
        if (!token) {
          this.next[kind] = (this.next[kind] || 0) + 1;
          token = `[${kind}_${this.next[kind]}]`;
          this.byValue.set(match, token);
          this.byToken.set(token, match);
          const key = kind.toLowerCase() as Lowercase<PiiKind>;
          this.counts[key] = (this.counts[key] || 0) + 1;
        }
        return token;
      });
    }
    return out;
  }

  restore(text: string): string {
    if (!this.byToken.size) return text;
    return text.replace(/\[(EMAIL|CARD|SSN|PHONE|IPV4)_\d+\]/g, token => this.byToken.get(token) ?? token);
  }
}

// In code mode, phone- and IP-shaped numbers are usually literals, ports, or versions; masking them
// would make the code harder for the model to reason about, so only identity data is redacted.
export const CODE_MODE_PII: PiiKind[] = ["EMAIL", "CARD", "SSN"];
