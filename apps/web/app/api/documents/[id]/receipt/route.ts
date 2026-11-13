import { requireSession } from "@/lib/access";
import { query } from "@/lib/db";
import { isUuid } from "@/lib/documents";
import { handle, refuse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The signed deletion receipt of a document (krizaka-internal#3381), to its owner only, as a JSON file the report's verify page
 * checks. `?rule=` picks one when a document has more than one (a purge, then an erasure); the latest otherwise.
 */
export function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireSession(req);
    const id = (await params).id;
    if (!isUuid(id)) {
      throw refuse(404, "NOT_FOUND", "No such receipt");
    }
    const rule = new URL(req.url).searchParams.get("rule");
    const [row] = await query<{ body: string }>(
      "SELECT body FROM deletion_receipts WHERE document_id = $1 AND owner_id = $2 AND ($3::text IS NULL OR rule = $3) ORDER BY issued_at DESC LIMIT 1",
      [id, session.account.id, rule],
    );
    if (!row) {
      throw refuse(404, "NOT_FOUND", "No such receipt");
    }
    return new Response(row.body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="deletion-receipt-${id}.json"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
