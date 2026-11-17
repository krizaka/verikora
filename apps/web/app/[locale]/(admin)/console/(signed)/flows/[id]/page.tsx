import { notFound } from "next/navigation";

import { FlowEditor } from "@/components/admin/FlowEditor";
import { requirePageAdmin } from "@/lib/access";
import { formFromDefinition } from "@/lib/flow-form";
import { listAdminFlows } from "@/lib/flows";

export const dynamic = "force-dynamic";

/** One flow: edit its draft, publish it, enable it per environment. The form opens on the draft, else on the current version. */
export default async function AdminFlow({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  await requirePageAdmin();
  const { id } = await params;
  const flow = (await listAdminFlows()).find((f) => f.id === id);
  if (!flow) notFound();
  const shown =
    flow.versions.find((v) => v.status === "draft") ??
    flow.versions.find((v) => v.version === flow.currentVersion) ??
    flow.versions[0];
  return <FlowEditor flow={flow} initial={shown?.definition ? formFromDefinition(shown.definition) : null} />;
}
