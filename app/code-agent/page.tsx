import { notFound } from "next/navigation";
import { CodeAgentApp } from "@/components/code-agent/code-agent-app";
import { featureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI Code Agent · AZ_AI", description: "Plan, review, apply and roll back repository changes." };

export default function CodeAgentPage() {
  if (!featureEnabled("codeAgent")) notFound();
  return <CodeAgentApp />;
}
