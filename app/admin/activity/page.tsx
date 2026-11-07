import { PageHeader } from "@/components/admin/admin-ui";
import { ActivityFeed } from "@/components/live/activity-feed";
import { consoleActor } from "@/lib/admin/console";
import { loadActivity } from "@/lib/admin/live";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity · Admin · AZ_AI" };

export default async function ActivityPage() {
  const actor = await consoleActor();
  const initial = await loadActivity(actor, { kinds: ["admin", "pipeline", "feedback"], limit: 30 }).catch(() => null);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="15_ADMIN · activity" title="Live activity"
        description="Everything that just happened: admin changes in this tenant, pipeline errors and failed requests, and user feedback. Updates by itself; metadata only." />
      <ActivityFeed initial={initial} />
    </div>
  );
}
