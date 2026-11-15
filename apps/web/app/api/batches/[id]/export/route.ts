import { requireSession } from "@/lib/access";
import { csvCell } from "@/lib/batch/csv-out";
import { batchZipResponse } from "@/lib/batch/export-for";
import { batchView } from "@/lib/batch/run";
import { isUuid } from "@/lib/documents";
import { handle, refuse } from "@/lib/http";
import { asLocale } from "@/lib/i18n";
import { limit } from "@/lib/limits";

export const dynamic = "force-dynamic";

/**
 * The batch's results as CSV, one line per row of the CSV it came from: what each became, and its reason when it did not run.
 * `?format=zip&lang=fr|en` is the archive of its reports instead (verikora#242): the CSV, the signed PDFs, the authenticity signals.
 */
export function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireSession(req);
    const id = (await params).id;
    if (!isUuid(id)) throw refuse(404, "NOT_FOUND", "No such batch");
    if (new URL(req.url).searchParams.get("format") === "zip") {
      await limit("batchExport", req, session.account.id);
      return batchZipResponse(
        session.account.id,
        id,
        asLocale(new URL(req.url).searchParams.get("lang") ?? undefined),
        { action: "batch.exported", actorId: session.account.id, actorLabel: session.account.email },
        req.headers,
      );
    }
    const batch = await batchView(session.account.id, id);
    const lines = [
      ["line", "file", "reference", "state", "reason", "document"].join(","),
      ...batch.items.map((i) => [i.line, i.file, i.reference, i.state, i.error, i.documentId].map(csvCell).join(",")),
    ];
    return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="lot-${id.slice(0, 8)}.csv"`,
      },
    });
  });
}
