import { DocumentsTable } from "@/components/admin/AdminTables";
import { requirePageAdmin } from "@/lib/access";
import { allDocuments } from "@/lib/admin";

export default async function AdminDocuments() {
  await requirePageAdmin();
  return <DocumentsTable rows={await allDocuments()} />;
}
