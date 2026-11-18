import { FlowsTable } from "@/components/admin/FlowsTable";
import { requirePageAdmin } from "@/lib/access";
import { listAdminFlows } from "@/lib/flows";

export const dynamic = "force-dynamic";

/** The flows of the product, administered here (ADR-0003). */
export default async function AdminFlows() {
  await requirePageAdmin();
  return <FlowsTable flows={await listAdminFlows()} />;
}
