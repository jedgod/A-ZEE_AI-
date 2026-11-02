export default function HomePage() {
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
