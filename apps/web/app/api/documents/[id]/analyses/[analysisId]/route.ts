import { requireSession } from "@/lib/access";
import { getAnalysis } from "@/lib/analyses";
import { closingNoteOf } from "@/lib/closing-note/for-analysis";
import { handle } from "@/lib/http";
import { asLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** One analysis, brought up to date with its Sovkora run while it runs (the page and the apps poll this). With its plain-language closing note in `?lang=en|fr`. */
export function GET(req: Request, { params }: { params: Promise<{ id: string; analysisId: string }> }) {
  return handle(async () => {
    const session = await requireSession(req);
    const { id, analysisId } = await params;
    const found = await getAnalysis(session.account.id, id, analysisId);
    const lang = asLocale(new URL(req.url).searchParams.get("lang") ?? undefined);
    return Response.json({ analysis: found, closingNote: closingNoteOf(found, lang) });
  });
}
