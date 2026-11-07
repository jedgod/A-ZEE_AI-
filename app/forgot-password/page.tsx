import { ForgotPassword } from "@/components/user/email-flows";

export const metadata = { title: "Reset password · AZ_AI" };

export default function Page() {
  return <main className="flex min-h-dvh items-center justify-center px-4 py-10"><div className="w-full max-w-sm"><ForgotPassword /></div></main>;
}
