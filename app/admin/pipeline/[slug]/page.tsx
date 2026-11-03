import { PipelineModulePage } from "@/components/admin/pipeline-module";
import { findModule } from "@/lib/admin/pipeline-catalog";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const entry = findModule((await params).slug);
  return { title: `${entry?.title ?? "Module"} · Pipeline · AZ_AI` };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <PipelineModulePage slug={(await params).slug} />;
}
