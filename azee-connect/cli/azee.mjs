#!/usr/bin/env node
// AZee Connect CLI: lets any editor or IDE talk to an AZ_AI server.
// Zero dependencies (Node 18+). Editors without an extension API (Code::Blocks,
// Visual Studio, JetBrains, Vim, Notepad++, Sublime, Emacs) call it as an
// external tool; the answer is printed to stdout as Markdown.
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_CHARS = 20000;
export const AROUND_LINES = 40;
const TOKEN = /^az_[a-f0-9]{64}$/;
const MODES = ["chat", "code", "research"];
const MODELS = ["auto", "reasoning", "code"];

export const EXIT = { OK: 0, REQUEST: 1, USAGE: 2, AUTH: 3 };

export class CliError extends Error {
  constructor(message, code = EXIT.USAGE) { super(message); this.code = code; }
}

const HELP = `AZee Connect — use your AZ_AI server from any editor.

Usage:
  azee configure --url URL [--token TOKEN]   Save server URL and token
  azee status                                Check the connection and token
  azee explain [FILE] [selection options]    Explain code
  azee review  [FILE] [selection options]    Find bugs and risks
  azee ask "QUESTION" [FILE] [options]       Ask anything, optionally about code

Selection options (pick one; default is the whole file):
  --lines A-B        Only lines A to B (1-based, inclusive)
  --around N         ${AROUND_LINES} lines either side of line N (for IDEs that only expose the cursor line)
  --stdin            Read the code from standard input (piped input is also detected)

Other options:
  --mode chat|code|research    Default: code for explain/review, chat for ask
  --model auto|reasoning|code  Default: auto
  --lang NAME                  Language hint when it can't be guessed from the file name
  --out FILE                   Also write the answer to FILE
  --url URL / --token TOKEN    Override saved settings for one call

Settings come from AZEE_URL / AZEE_TOKEN, then the config file
(${"%APPDATA%"}\\azee\\config.json on Windows, ~/.config/azee/config.json elsewhere).
Exit codes: 0 ok, 1 request failed, 2 usage error, 3 authentication problem.`;

const LANGS = {
  ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp",
  ".cs": "csharp", ".java": "java", ".kt": "kotlin", ".py": "python", ".js": "javascript", ".mjs": "javascript",
  ".cjs": "javascript", ".jsx": "jsx", ".ts": "typescript", ".tsx": "tsx", ".go": "go", ".rs": "rust",
  ".rb": "ruby", ".php": "php", ".swift": "swift", ".m": "objectivec", ".sql": "sql", ".sh": "bash",
  ".ps1": "powershell", ".bat": "bat", ".html": "html", ".css": "css", ".json": "json", ".yml": "yaml",
  ".yaml": "yaml", ".md": "markdown", ".lua": "lua", ".r": "r", ".f90": "fortran", ".pas": "pascal",
  ".asm": "asm", ".s": "asm", ".vhd": "vhdl", ".v": "verilog", ".cbp": "xml", ".xml": "xml",
};

export const languageFor = (file) => (file && LANGS[extname(file).toLowerCase()]) || "";

export function parseArgs(argv) {
  const out = { command: argv[0], positional: [], flags: {} };
  const valued = ["lines", "around", "mode", "model", "lang", "out", "url", "token"];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--stdin") out.flags.stdin = true;
    else if (arg === "--help" || arg === "-h") out.flags.help = true;
    else if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split(/=(.*)/s);
      if (!valued.includes(name)) throw new CliError(`Unknown option --${name}`);
      const value = inline ?? argv[++i];
      if (value === undefined || value === "") throw new CliError(`--${name} needs a value`);
      out.flags[name] = value;
    } else out.positional.push(arg);
  }
  const { mode, model } = out.flags;
  if (mode && !MODES.includes(mode)) throw new CliError(`--mode must be one of ${MODES.join(", ")}`);
  if (model && !MODELS.includes(model)) throw new CliError(`--model must be one of ${MODELS.join(", ")}`);
  if ([out.flags.lines, out.flags.around, out.flags.stdin].filter(Boolean).length > 1) {
    throw new CliError("Use only one of --lines, --around, --stdin");
  }
  return out;
}

// Returns { code, start, end } for the requested part of the text (1-based, inclusive).
export function selectLines(text, { lines, around } = {}) {
  const all = text.replace(/\r\n/g, "\n").split("\n");
  if (all.length > 1 && all.at(-1) === "") all.pop();
  let start = 1, end = all.length;
  if (lines) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(String(lines).trim());
    if (!m) throw new CliError("--lines must look like 10-40 or 12");
    start = Number(m[1]); end = Number(m[2] ?? m[1]);
    if (start < 1 || end < start) throw new CliError("--lines must be ascending and start at 1 or more");
  } else if (around) {
    const n = Number(around);
    if (!Number.isInteger(n) || n < 1) throw new CliError("--around needs a line number");
    start = Math.max(1, n - AROUND_LINES); end = n + AROUND_LINES;
  }
  if (start > all.length) throw new CliError(`The file has only ${all.length} lines`);
  end = Math.min(end, all.length);
  return { code: all.slice(start - 1, end).join("\n"), start, end, total: all.length };
}

const TASKS = {
  explain: "Explain what this code does, step by step, and point out anything surprising.",
  review: "Review this code. List concrete bugs, security risks, and edge cases first (with line numbers), then suggest focused fixes.",
};

export function buildMessage({ task, question, code, file, start, end, total, lang }) {
  const instruction = question || TASKS[task] || "Help with this code.";
  if (!code) return instruction;
  const where = file
    ? `File: ${basename(file)}${start && total && (start > 1 || end < total) ? ` (lines ${start}-${end} of ${total})` : ""}`
    : "Code from editor selection";
  const fence = code.includes("```") ? "````" : "```";
  return `${instruction}\n\n${where}\n\n${fence}${lang || ""}\n${code}\n${fence}`;
}

export function validateBase(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.username || url.password || url.search || url.hash) return false;
  return url.protocol === "https:" ||
    (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
}

export function configPath(env = process.env, platform = process.platform) {
  const base = platform === "win32"
    ? env.APPDATA || join(homedir(), "AppData", "Roaming")
    : env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "azee", "config.json");
}

function loadSettings(flags, env = process.env) {
  let saved = {};
  const path = configPath(env);
  if (existsSync(path)) {
    try { saved = JSON.parse(readFileSync(path, "utf8")); } catch { throw new CliError(`Can't read ${path}; run azee configure again`); }
  }
  const url = (flags.url || env.AZEE_URL || saved.url || "").replace(/\/+$/, "");
  const token = flags.token || env.AZEE_TOKEN || saved.token || "";
  if (!url || !token) throw new CliError("Not configured. Run: azee configure --url http://localhost:3000 --token az_...", EXIT.AUTH);
  if (!validateBase(url)) throw new CliError("The server URL must use https (http is allowed only for localhost)");
  if (!TOKEN.test(token)) throw new CliError("The token should be az_ followed by 64 hex characters", EXIT.AUTH);
  return { url, token };
}

const ERRORS = {
  INVALID_TOKEN: ["The token is invalid, expired, or revoked. Issue a new one with: npm run connect:token -- --local", EXIT.AUTH],
  INSUFFICIENT_SCOPE: ["This token isn't allowed to use chat.", EXIT.AUTH],
  RATE_LIMITED: ["Too many requests (20 per minute per token). Wait a minute and retry.", EXIT.REQUEST],
  AI_PROVIDER_UNAVAILABLE: ["The server couldn't reach any AI provider. Check its provider keys and billing.", EXIT.REQUEST],
  AI_PROVIDER_NOT_CONFIGURED: ["The server has no AI provider configured.", EXIT.REQUEST],
  INVALID_INPUT: ["The server rejected the request (message too long or malformed).", EXIT.REQUEST],
  BODY_TOO_LARGE: ["The request is too large. Send fewer lines.", EXIT.REQUEST],
  INPUT_BLOCKED: ["The server's safety filter blocked this request. Rephrase it and retry.", EXIT.REQUEST],
};

async function call(settings, path, init = {}, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(settings.url + path, {
      ...init,
      headers: { Authorization: `Bearer ${settings.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(path === "/api/v1/status" ? 15000 : 95000),
    });
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? "timed out" : "is unreachable";
    throw new CliError(`The AZee server at ${settings.url} ${reason}. Is it running?`, EXIT.REQUEST);
  }
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const [message, code] = ERRORS[body?.error] || [`Request failed (HTTP ${response.status}${body?.error ? `: ${body.error}` : ""}).`, response.status === 401 || response.status === 403 ? EXIT.AUTH : EXIT.REQUEST];
    throw new CliError(message, code);
  }
  return body?.data;
}

// Pipes report isTTY as undefined, not false. When stdin is merely inherited (some IDEs
// leave it open without writing), stop waiting if nothing arrives within firstByteMs.
async function readStdin(stdin = process.stdin, firstByteMs = 0) {
  const chunks = [];
  const iterator = stdin[Symbol.asyncIterator]();
  let first;
  if (firstByteMs > 0) {
    let timer;
    first = await Promise.race([
      iterator.next(),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), firstByteMs); }),
    ]);
    clearTimeout(timer);
    if (first === null) { stdin.destroy?.(); return ""; }
  } else first = await iterator.next();
  for (let step = first; !step.done; step = await iterator.next()) chunks.push(Buffer.from(step.value));
  return Buffer.concat(chunks).toString("utf8");
}

export async function run(argv, io = {}) {
  const { stdout = process.stdout, stdin = process.stdin, env = process.env, fetchImpl = fetch } = io;
  const print = (text) => stdout.write(text.endsWith("\n") ? text : text + "\n");
  const args = parseArgs(argv);

  if (!args.command || args.command === "help" || args.flags.help) { print(HELP); return EXIT.OK; }

  if (args.command === "configure") {
    const url = (args.flags.url || "http://localhost:3000").replace(/\/+$/, "");
    const token = args.flags.token || env.AZEE_TOKEN;
    if (!validateBase(url)) throw new CliError("The server URL must use https (http is allowed only for localhost)");
    if (!token || !TOKEN.test(token)) throw new CliError("Pass --token az_... (from: npm run connect:token -- --local)");
    const status = await call({ url, token }, "/api/v1/status", {}, fetchImpl);
    const path = configPath(env);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ url, token }, null, 2) + "\n", { mode: 0o600 });
    try { chmodSync(path, 0o600); } catch {}
    print(`Connected to ${url}. Token valid until ${status.expiresAt.slice(0, 10)}.\nSaved to ${path}`);
    return EXIT.OK;
  }

  const settings = loadSettings(args.flags, env);

  if (args.command === "status") {
    const status = await call(settings, "/api/v1/status", {}, fetchImpl);
    print(`Connected to ${settings.url}\nKey: ${status.keyId}\nScopes: ${status.scopes.join(", ")}\nExpires: ${status.expiresAt}\nModes: ${status.modes.join(", ")}`);
    return EXIT.OK;
  }

  if (!["explain", "review", "ask"].includes(args.command)) throw new CliError(`Unknown command "${args.command}". Run azee help.`);

  const positional = [...args.positional];
  const question = args.command === "ask" ? positional.shift() : undefined;
  if (args.command === "ask" && !question) throw new CliError('Usage: azee ask "QUESTION" [FILE]');
  const file = positional.shift();
  if (positional.length) throw new CliError(`Unexpected argument: ${positional[0]}`);

  let source = "";
  if (file && args.flags.stdin) throw new CliError("Use either a FILE or --stdin, not both");
  if (file) {
    try { source = readFileSync(file, "utf8"); } catch { throw new CliError(`Can't read ${file}`); }
  } else if (args.flags.stdin) {
    source = await readStdin(stdin);
  } else if (!stdin.isTTY) {
    source = await readStdin(stdin, io.stdinWaitMs ?? 1500);
  }
  if (!source && args.command !== "ask") {
    throw new CliError(`Give a file, or pipe code in: azee ${args.command} FILE`);
  }

  const part = source ? selectLines(source, args.flags) : { code: "" };
  if (source && !part.code.trim()) throw new CliError("The selected code is empty");
  const content = buildMessage({
    task: args.command, question, file, lang: args.flags.lang || languageFor(file), ...part,
  });
  if (content.length > MAX_CHARS) {
    throw new CliError(`That's ${content.length.toLocaleString("en-US")} characters; the limit is ${MAX_CHARS.toLocaleString("en-US")}. Narrow it with --lines or --around.`);
  }

  const mode = args.flags.mode || (args.command === "ask" ? "chat" : "code");
  const data = await call(settings, "/api/v1/chat", {
    method: "POST",
    body: JSON.stringify({ mode, model: args.flags.model || "auto", messages: [{ role: "user", content }] }),
  }, fetchImpl);
  if (typeof data?.answer !== "string") throw new CliError("The server sent an unexpected response.", EXIT.REQUEST);
  print(data.answer);
  if (args.flags.out) writeFileSync(args.flags.out, data.answer.endsWith("\n") ? data.answer : data.answer + "\n");
  return EXIT.OK;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(
    code => { process.exitCode = code; },
    error => {
      process.stderr.write(`azee: ${error instanceof CliError ? error.message : error?.message || error}\n`);
      process.exitCode = error instanceof CliError ? error.code : EXIT.REQUEST;
    },
  );
}
