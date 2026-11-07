import { AuthForm } from "@/components/user/auth-form";

export const metadata = { title: "Sign in · AZ_AI" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm"><AuthForm mode="signin" next={next ?? "/"} /></div>
    </main>
  );
}
