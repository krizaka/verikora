import { IncidentsView } from "@/components/admin/IncidentsView";
import { requirePageAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

/** The confidentiality incident register (Loi 25, verikora#418): open, assess, notify, close, export. The data is read by the view through the query client. */
export default async function AdminIncidents() {
  await requirePageAdmin();
  return <IncidentsView />;
}
