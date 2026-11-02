"use client";

import { useState } from "react";

export default function HomePage() {
  const [mode, setMode] = useState<"chat" | "code" | "research">("chat");
  const [model, setModel] = useState<"auto" | "reasoning" | "code">("auto");
  const [prompt, setPrompt] = useState("Summarize the product strategy for a new AI workflow workspace.");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          model,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const payload = await response.json();
      setAnswer(payload?.data?.answer ?? "Unable to generate a response.");
    } catch {
      setAnswer("Unable to reach the chat API right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
            AZ_AI
          </p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-900">
            Build smarter workflows with AI, safely.
          </h1>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <a className="rounded-md border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50" href="/signin">
            Sign in
          </a>
          <a className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700" href="/get-started">
            Get started
          </a>
        </nav>
      </header>

      <section className="mt-12 grid gap-8 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-6">
          <p className="max-w-xl text-lg text-slate-600">
            Coordinate agents, tools, policies, and approvals from one modern platform designed for everyday work and dependable execution.
          </p>
          <div className="flex flex-wrap gap-4">
            <a className="rounded-lg bg-slate-900 px-5 py-3 font-medium text-white hover:bg-slate-700" href="/get-started">
              Get started
            </a>
            <a className="rounded-lg border border-slate-200 px-5 py-3 font-medium text-slate-700 hover:bg-slate-50" href="/signin">
              Sign in
            </a>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Platform overview
          </p>
          <ul className="mt-6 space-y-4 text-sm text-slate-700">
            <li>• Shared project workspace</li>
            <li>• AI workflow orchestration</li>
            <li>• Guardrails and approvals</li>
            <li>• Team collaboration</li>
          </ul>
        </div>
      </section>

      <section className="mt-16 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Workspace
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Public chat workspace</h2>
          </div>
          <a href="/admin" className="text-sm font-medium text-slate-700 underline underline-offset-4">
            Open admin
          </a>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-700">
              Mode
              <select
                className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2"
                value={mode}
                onChange={event => setMode(event.target.value as "chat" | "code" | "research")}
              >
                <option value="chat">chat</option>
                <option value="code">code</option>
                <option value="research">research</option>
              </select>
            </label>

            <label className="text-sm text-slate-700">
              Model
              <select
                className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2"
                value={model}
                onChange={event => setModel(event.target.value as "auto" | "reasoning" | "code")}
              >
                <option value="auto">auto</option>
                <option value="reasoning">reasoning</option>
                <option value="code">code</option>
              </select>
            </label>
          </div>

          <label className="block text-sm text-slate-700">
            Prompt
            <textarea
              className="mt-2 min-h-[120px] w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900"
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-slate-900 px-5 py-3 font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Sending..." : "Send to /api/chat"}
          </button>
        </form>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Response</p>
          <div className="prose max-w-none whitespace-pre-wrap text-sm text-slate-700">
            {answer || "No response yet."}
          </div>
        </div>
      </section>

      <section className="mt-16 grid gap-6 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Streamlined workflows</h2>
          <p className="mt-3 text-sm text-slate-600">
            Turn fragmented tasks into repeatable, guided operations with clear execution paths.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Team visibility</h2>
          <p className="mt-3 text-sm text-slate-600">
            Keep stakeholders aligned with shared status, outputs, and operational context.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Safe by default</h2>
          <p className="mt-3 text-sm text-slate-600">
            Policy checks, approvals, and permissions help keep the system governed and accountable.
          </p>
        </article>
      </section>
    </main>
  );
}
