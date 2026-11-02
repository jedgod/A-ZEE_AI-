import Link from "next/link";

export default function AdminIndexPage() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-3xl font-semibold">15_ADMIN</h1>
      <p className="mt-3 text-muted-foreground">
        This is the admin control plane entrypoint.
      </p>
      <div className="mt-6">
        <Link className="underline" href="/admin/dashboard">
          Open dashboard
        </Link>
      </div>
    </main>
  );
}
