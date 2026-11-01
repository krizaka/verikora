import { handle, refuse } from "@/lib/http";
import { asLocale } from "@/lib/i18n";
import { limit } from "@/lib/limits";
import { issueOwnerReportPdf, ownerPayloadOf } from "@/lib/owner-report-pdf";
import { openShare } from "@/lib/owner-report-shares";
import { signingKey } from "@/lib/report-signer";
import { currentProductName } from "@/lib/settings/display-name";

export const dynamic = "force-dynamic";

/**
 * The signed PDF of the owner report (yomizaka#481), by the owner link's token, while it is valid — nothing else delivers it.
 * Unknown, expired or revoked link → one 404 (nothing leaks). Each download is recorded like a view. Language: `?locale=` (the page's).
 */
export function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const { token } = await ctx.params;
    await limit("applicant", req, null);
    const report = await openShare(token, new Date(), req.headers);
    if (!report) throw refuse(404, "NOT_FOUND", "No such report");
    const lang = asLocale(new URL(req.url).searchParams.get("locale") ?? "en");
    const { bytes } = await issueOwnerReportPdf(ownerPayloadOf(report, lang), signingKey(), await currentProductName());
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="yomizaka-${report.reference}.pdf"`,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  });
}
