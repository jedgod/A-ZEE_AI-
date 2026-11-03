import { notFound } from "next/navigation";
import { ConnectorsApp } from "@/components/connectors/connectors-app";
import { featureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plugins · AZ_AI", description: "Connect Gmail, Google Drive and GitHub (read-only), and manage skills." };

export default function ConnectorsPage() {
  if (!featureEnabled("connectors")) notFound();
  return <ConnectorsApp />;
}
