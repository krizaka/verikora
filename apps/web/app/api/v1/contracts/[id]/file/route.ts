import { systemClock } from "@/app/system-clock";
import { apiCaller } from "@/lib/api-v1/caller";
import { sealedOf } from "@/lib/contracts/store";
import { handle, refuse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The sealed PDF of a contract this key's account sealed (`contracts:seal`), as it was kept. */
export function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const caller = await apiCaller(req, "contracts:seal", systemClock);
    const { id } = await params;
    const row = /^ctr_[0-9a-f]{24}$/.test(id) ? await sealedOf(caller.account.id, id) : null;
    if (!row) throw refuse(404, "NOT_FOUND", "No such contract");
    return new Response(new Uint8Array(row.content), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${row.id}.pdf"`, "cache-control": "private, no-store" } });
  });
}
