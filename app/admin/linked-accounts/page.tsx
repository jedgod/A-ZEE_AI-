import { PageHeader } from "@/components/admin/admin-ui";
import { LinkedAccounts } from "@/components/admin/linked-accounts";
import { consoleActor } from "@/lib/admin/console";

export const dynamic = "force-dynamic";
export const metadata = { title: "Linked accounts · Admin · AZ_AI" };

export default async function Page() {
  await consoleActor();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="15_ADMIN · abuse prevention" title="Linked free accounts"
        description="Free accounts that share a device with accounts that already used their free allowance. Review false positives (shared Wi-Fi, family computers) and clear them." />
      <LinkedAccounts />
    </div>
  );
}
