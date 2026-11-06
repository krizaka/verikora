import { IncidentsView } from "@/components/admin/IncidentsView";

export const dynamic = "force-dynamic";

/** The confidentiality incident register (Loi 25, verikora#418): open, assess, notify, close, export. The data is read by the view through the query client. */
export default function AdminIncidents() {
  return <IncidentsView />;
}
