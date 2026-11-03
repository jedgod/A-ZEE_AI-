import { PipelineIndexPage } from "@/components/admin/pipeline-module";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pipeline stages · Admin · AZ_AI" };

export default function Page() {
  return <PipelineIndexPage />;
}
