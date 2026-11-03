import * as vscode from "vscode";

const MAX_CHARS = 20000;
const AROUND_LINES = 40;
const TOKEN = /^az_[a-f0-9]{64}$/;

type Status = { keyId: string; scopes: string[]; expiresAt: string };

const ERRORS: Record<string, string> = {
  INVALID_TOKEN: "The token is invalid, expired, or revoked. Issue a new one with `npm run connect:token -- --local`, then run AZee: Configure API access.",
  INSUFFICIENT_SCOPE: "This token isn't allowed to use chat.",
  RATE_LIMITED: "Too many requests (20 per minute per token). Wait a minute and retry.",
  AI_PROVIDER_UNAVAILABLE: "The server couldn't reach any AI provider. Check its provider keys and billing.",
  AI_PROVIDER_NOT_CONFIGURED: "The server has no AI provider configured.",
  INVALID_INPUT: "The server rejected the request (message too long or malformed).",
  INPUT_BLOCKED: "The server's safety filter blocked this request. Rephrase it and retry.",
};

function validBase(value: string) {
  try {
    const u = new URL(value);
    return !u.username && !u.password && !u.search && !u.hash &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)));
  } catch {
    return false;
  }
}

class AzeeError extends Error {}

async function request<T>(base: string, token: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new AzeeError("Cancelled.");
    throw new AzeeError(`The AZee server at ${base} is unreachable. Is it running?`);
  }
  const payload = await response.json().catch(() => null) as { error?: string; data?: T } | null;
  if (!response.ok) {
    throw new AzeeError(ERRORS[payload?.error ?? ""] ?? `Request failed (HTTP ${response.status}${payload?.error ? `: ${payload.error}` : ""}).`);
  }
  return payload?.data as T;
}

// Selection if there is one; otherwise the whole file, or a window around the cursor when it's too big.
function codeContext(editor: vscode.TextEditor) {
  const doc = editor.document;
  let range: vscode.Range = editor.selection;
  if (editor.selection.isEmpty) {
    range = new vscode.Range(0, 0, doc.lineCount, 0);
    if (doc.getText().length > MAX_CHARS - 1000) {
      const line = editor.selection.active.line;
      range = new vscode.Range(Math.max(0, line - AROUND_LINES), 0, Math.min(doc.lineCount, line + AROUND_LINES + 1), 0);
    }
  }
  const code = doc.getText(range).replace(/\s+$/, "");
  const start = range.start.line + 1;
  const end = Math.max(start, range.end.character === 0 && range.end.line > range.start.line ? range.end.line : range.end.line + 1);
  const name = vscode.workspace.asRelativePath(doc.uri);
  const whole = start === 1 && end >= doc.lineCount;
  const where = doc.isUntitled ? "Code from editor" : `File: ${name}${whole ? "" : ` (lines ${start}-${end} of ${doc.lineCount})`}`;
  const fence = code.includes("```") ? "````" : "```";
  return { code, text: `${where}\n\n${fence}${doc.languageId}\n${code}\n${fence}` };
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("AZee");

  async function settings() {
    const base = await context.secrets.get("azee.base");
    const token = await context.secrets.get("azee.token");
    if (base && token) return { base, token };
    const choice = await vscode.window.showWarningMessage("AZee isn't configured yet.", "Configure");
    if (choice === "Configure") await vscode.commands.executeCommand("azee.configure");
    return null;
  }

  async function allowedToSend() {
    if (context.globalState.get("azee.sendApproved")) return true;
    const choice = await vscode.window.showWarningMessage(
      "Send code to your configured AZee server? Avoid sending secrets.",
      { modal: true }, "Send", "Always send"
    );
    if (choice === "Always send") await context.globalState.update("azee.sendApproved", true);
    return choice === "Send" || choice === "Always send";
  }

  async function ask(instruction: string, mode: "chat" | "code", withCode: boolean) {
    const conf = await settings();
    if (!conf) return;
    let content = instruction;
    if (withCode) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showWarningMessage("Open a file or select code first."); return; }
      const ctx = codeContext(editor);
      if (!ctx.code.trim()) { vscode.window.showWarningMessage("There's no code to send."); return; }
      content = `${instruction}\n\n${ctx.text}`;
    }
    if (content.length > MAX_CHARS) {
      vscode.window.showWarningMessage(`That's ${content.length.toLocaleString()} characters; the limit is ${MAX_CHARS.toLocaleString()}. Select a smaller part.`);
      return;
    }
    if (withCode && !(await allowedToSend())) return;
    try {
      const data = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "AZee is thinking…", cancellable: true },
        (_, cancel) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 95000);
          const listener = cancel.onCancellationRequested(() => controller.abort());
          return request<{ answer: string }>(conf.base, conf.token, "/api/v1/chat",
            { mode, model: "auto", messages: [{ role: "user", content }] }, controller.signal)
            .finally(() => { clearTimeout(timer); listener.dispose(); });
        }
      );
      if (typeof data?.answer !== "string") throw new AzeeError("The server sent an unexpected response.");
      const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: data.answer });
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    } catch (error) {
      const message = error instanceof AzeeError ? error.message : "AZee request failed.";
      output.appendLine(`[${new Date().toISOString()}] ${message}`);
      vscode.window.showErrorMessage(message);
    }
  }

  context.subscriptions.push(
    output,
    vscode.commands.registerCommand("azee.configure", async () => {
      const base = await vscode.window.showInputBox({
        prompt: "AZee server URL",
        value: (await context.secrets.get("azee.base")) ?? "http://localhost:3000",
        ignoreFocusOut: true,
        validateInput: (v) => validBase(v) ? undefined : "Use HTTPS, or http://localhost for local development",
      });
      if (!base) return;
      const token = await vscode.window.showInputBox({
        prompt: "AZee API token (from: npm run connect:token -- --local)",
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => TOKEN.test(v.trim()) ? undefined : "Expected az_ followed by 64 hex characters",
      });
      if (!token) return;
      const clean = base.replace(/\/+$/, "");
      try {
        const status = await request<Status>(clean, token.trim(), "/api/v1/status", undefined, AbortSignal.timeout(15000));
        await context.secrets.store("azee.base", clean);
        await context.secrets.store("azee.token", token.trim());
        vscode.window.showInformationMessage(`AZee connected. Token valid until ${status.expiresAt.slice(0, 10)}.`);
      } catch (error) {
        vscode.window.showErrorMessage(`Not saved: ${error instanceof AzeeError ? error.message : "connection failed."}`);
      }
    }),
    vscode.commands.registerCommand("azee.status", async () => {
      const conf = await settings();
      if (!conf) return;
      try {
        const status = await request<Status>(conf.base, conf.token, "/api/v1/status", undefined, AbortSignal.timeout(15000));
        vscode.window.showInformationMessage(`AZee connected to ${conf.base} · scopes: ${status.scopes.join(", ")} · expires ${status.expiresAt.slice(0, 10)}`);
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof AzeeError ? error.message : "Connection failed.");
      }
    }),
    vscode.commands.registerCommand("azee.explain", () =>
      ask("Explain what this code does, step by step, and point out anything surprising.", "code", true)),
    vscode.commands.registerCommand("azee.review", () =>
      ask("Review this code. List concrete bugs, security risks, and edge cases first (with line numbers), then suggest focused fixes.", "code", true)),
    vscode.commands.registerCommand("azee.ask", async () => {
      const question = await vscode.window.showInputBox({ prompt: "Ask AZee about the current selection or file", ignoreFocusOut: true });
      if (!question?.trim()) return;
      await ask(question.trim(), "code", Boolean(vscode.window.activeTextEditor));
    }),
    vscode.commands.registerCommand("azee.forget", async () => {
      await context.secrets.delete("azee.base");
      await context.secrets.delete("azee.token");
      await context.globalState.update("azee.sendApproved", undefined);
      vscode.window.showInformationMessage("AZee settings and token removed from this machine.");
    })
  );
}

export function deactivate() {}
