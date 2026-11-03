import { notFound } from "next/navigation";
import { ConnectorsApp } from "@/components/connectors/connectors-app";
import { featureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connectors · AZ_AI", description: "Read-only GitHub and Google Drive connections." };

export default function ConnectorsPage() {
  if (!featureEnabled("connectors")) notFound();
  return <ConnectorsApp />;
}
