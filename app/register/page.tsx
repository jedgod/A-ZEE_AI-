import { AuthForm } from "@/components/user/auth-form";

export const metadata = { title: "Create account · AZ_AI" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm"><AuthForm mode="register" next={next ?? "/"} /></div>
    </main>
  );
}
