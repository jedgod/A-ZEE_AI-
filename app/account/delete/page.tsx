import { DeleteAccount } from "@/components/user/delete-account";

export const metadata = { title: "Delete your account · AZ_AI" };

/** Public: this address is what Google Play's "account deletion" field and the App Store listing point to. */
export default function Page() {
  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 py-10">
      <a href="/" className="text-sm text-muted-foreground hover:text-foreground">← A-Zee</a>
      <h1 className="mb-2 mt-3 text-3xl font-semibold tracking-tight">Delete your account</h1>
      <p className="mb-6 text-sm text-muted-foreground">Permanently delete your A-Zee account and the data in it, from the website or the mobile app.</p>
      <DeleteAccount />
    </main>
  );
}
