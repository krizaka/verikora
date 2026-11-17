import { AuditTable } from "@/components/admin/AdminTables";
import { requirePageAdmin } from "@/lib/access";
import { auditLog } from "@/lib/admin";

export default async function AdminAudit() {
  await requirePageAdmin();
  return <AuditTable entries={await auditLog()} />;
}
