import { StorageView } from "@/components/admin/StorageView";
import { requirePageAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Where documents and avatars are kept (ADR-005, verikora#522): the providers, their tests, their defaults. The data is read by the view through the query client. */
export default async function AdminStorage() {
  await requirePageAdmin();
  return <StorageView />;
}
