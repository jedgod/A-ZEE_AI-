import { currentStaff } from "@/lib/staff/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff sign-in · AZ_AI" };

/** Only same-site paths are honored after sign-in (no open redirects). */
function safeNext(raw: string | undefined) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : "/operations";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const staff = await currentStaff().catch(() => null);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f6f7f9] px-4 py-10 text-[#1d2637]">
      <div className="w-full max-w-sm">
        <a href="/" className="mb-8 flex items-center justify-center gap-2 text-lg font-extrabold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#315fe9] text-white">a</span> AZ_AI <span className="font-medium text-[#788292]">Operations</span>
        </a>
        <LoginForm next={next} signedInAs={staff && !staff.mustChangePassword ? { name: staff.name, role: staff.role } : null} mustChange={Boolean(staff?.mustChangePassword)} />
        <p className="mt-6 text-center text-xs text-[#788292]">
          Staff accounts are created by an administrator. Lost access? Ask an admin to reset your password.
        </p>
      </div>
    </main>
  );
}
