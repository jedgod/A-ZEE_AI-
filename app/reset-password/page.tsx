import { ResetPassword } from "@/components/user/email-flows";

export const metadata = { title: "Choose a new password · AZ_AI" };

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <main className="flex min-h-dvh items-center justify-center px-4 py-10"><div className="w-full max-w-sm"><ResetPassword token={token ?? null} /></div></main>;
}
