import { RunsTable } from "@/components/admin/AdminTables";
import { requirePageAdmin } from "@/lib/access";
import { allRuns } from "@/lib/admin";

export default async function AdminRuns() {
  await requirePageAdmin();
  return <RunsTable rows={await allRuns()} />;
}
