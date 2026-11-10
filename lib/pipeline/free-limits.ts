// Free-plan limits for coding, development and "build an application" requests.
//
// Free accounts get basic, simple, short code answers: the smallest working snippet, a couple of
// sentences at most, no full applications or multi-file projects. Three layers enforce it, so no
// single one has to be perfect:
//   1. a hard output budget (the provider can't write more than this),
//   2. an instruction that tells the model what a free answer looks like,
//   3. cleanup that closes a code block if the budget cut one off.
// Paid plans are never touched.

export const FREE_CODE_DEFAULT_TOKENS = 450;

/** Output tokens a free code answer may use (about 30 short lines). AZ_FREE_CODE_MAX_TOKENS tunes it, within 100 to 1000. */
export function freeCodeBudget(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.AZ_FREE_CODE_MAX_TOKENS);
  return Number.isFinite(configured) && configured > 0 ? Math.min(1000, Math.max(100, Math.round(configured))) : FREE_CODE_DEFAULT_TOKENS;
}

const LANGUAGES = "python|javascript|typescript|java|c\\+\\+|c#|golang|rust|php|ruby|swift|kotlin|sql|bash|powershell|html|css|react|vue|angular|node(?:\\.js)?|next\\.?js|django|flask|laravel|flutter|android|ios";
const THINGS = "app(?:lication)?s?|web ?app|web ?site|api|bot|chatbot|game|program|script|software|plugin|extension|back-?end|front-?end|dashboard|landing page|saas|crud|microservice|cli|component|function|regex|algorithm|database|schema|endpoint|quer(?:y|ies)|e-?commerce(?: site| store)?";
const VERBS = "write|writing|create|creating|make|making|build|building|develop|developing|generate|implement|code|coding|program|design|scaffold|set up";
const CODE_PATTERNS: RegExp[] = [
  /```/,                                                                                                          // a pasted code block
  new RegExp(`\\b(?:${VERBS})\\b[^.?!\\n]{0,40}\\b(?:${THINGS})\\b`, "i"),
  new RegExp(`\\b(?:${THINGS})\\b[^.?!\\n]{0,40}\\b(?:built|made|written|coded|developed|using|with|in)\\b[^.?!\\n]{0,15}\\b(?:${LANGUAGES})\\b`, "i"),
  new RegExp(`\\b(?:${LANGUAGES})\\b[^.?!\\n]{0,30}\\b(?:code|function|script|program|app|project|snippet|component|example|tutorial)\\b`, "i"),
  /\b(?:debug|refactor|source code|stack ?trace|unit tests?|compile error|syntax error|fix (?:this|my|the) (?:code|bug|error|script))\b/i,
  /\b(?:write|give me|show me)\b[^.?!\n]{0,20}\bcode\b/i,
];

/** A conservative text check, so asking for code in the plain chat mode doesn't sidestep the limit. */
export const looksLikeCodeRequest = (text: string) => CODE_PATTERNS.some(p => p.test(text.slice(0, 4000)));

/** Whether this is a coding request: the code mode, a code task, or a message that asks for code. */
export const isCodeRequest = (mode: string, task: string, text = "") => mode === "code" || task === "code" || looksLikeCodeRequest(text);

/** The limit applies to a Free plan account asking for code. Unknown access (no database) is never limited. */
export const freeCodeLimitApplies = (access: { planId?: string } | null | undefined, mode: string, task: string, text = "") =>
  access?.planId === "free" && isCodeRequest(mode, task, text);

export const FREE_CODE_INSTRUCTION = [
  "The user is on the Free plan, so keep every coding, development and build-an-application answer basic, simple and short:",
  "- Give only the smallest working snippet or a plain outline, at most about 20 lines of code in total.",
  "- Explain in at most two or three short sentences. No step-by-step tutorials, no long background, no alternatives or comparisons.",
  "- Do not write a full application, several files, a complete project structure, tests, or production-grade code with error handling and configuration.",
  "- If the request needs more than that, give just the simplest core of it and end with one short line saying a paid plan gives detailed, complete code.",
].join("\n");

export const FREE_CODE_NOTICE = "Free plan: code answers are kept short and basic. Upgrade for detailed, complete code.";

/** If the output budget cut a fenced code block off, close it so the answer still renders. */
export function closeOpenFences(text: string): string {
  const fences = text.match(/^ {0,3}(```|~~~)/gm)?.length ?? 0;
  return fences % 2 === 1 ? `${text.replace(/\s+$/, "")}\n\`\`\`\n` : text;
}
