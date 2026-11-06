import { StorageView } from "@/components/admin/StorageView";

export const dynamic = "force-dynamic";

/** Where documents and avatars are kept (ADR-005, verikora#522): the providers, their tests, their defaults. The data is read by the view through the query client. */
export default function AdminStorage() {
  return <StorageView />;
}
