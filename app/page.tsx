export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-semibold">AZ_AI</h1>
      <p className="mt-3 text-muted-foreground">
        Host application entrypoint for the admin control plane.
      </p>
      <div className="mt-6">
        <a className="underline" href="/admin">
          Open admin
        </a>
      </div>
    </main>
  );
}
