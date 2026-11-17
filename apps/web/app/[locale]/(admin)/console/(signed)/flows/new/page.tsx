import { FlowEditor } from "@/components/admin/FlowEditor";
import { requirePageAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function NewFlow() {
  await requirePageAdmin();
  return <FlowEditor flow={null} initial={null} />;
}
