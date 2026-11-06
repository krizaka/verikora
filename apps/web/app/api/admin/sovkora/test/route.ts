import { requireAdmin } from "@/lib/access";
import { audit } from "@/lib/audit";
import { codeOf, handle, HttpError } from "@/lib/http";
import { sovkora } from "@/lib/sovkora";

export const dynamic = "force-dynamic";

/** « Test the connection »: asks Sovkora which Studios this key has installed (the cheapest call that proves key, address and answer). */
export const POST = (req: Request) =>
  handle(async () => {
    const session = await requireAdmin(req);
    const started = performance.now();
    try {
      const studios = await sovkora().studios();
      await audit({
        action: "sovkora.connection_tested",
        actorId: session.account.id,
        actorLabel: session.account.email,
        detail: { ok: true, studios: studios.length },
        headers: req.headers,
      });
      return Response.json({ ok: true, ms: Math.round(performance.now() - started), studios });
    } catch (error) {
      const code = error instanceof HttpError ? codeOf(error, "UNKNOWN") : "UNKNOWN";
      await audit({
        action: "sovkora.connection_tested",
        actorId: session.account.id,
        actorLabel: session.account.email,
        detail: { ok: false, code },
        headers: req.headers,
      });
      return Response.json({ ok: false, ms: Math.round(performance.now() - started), code, studios: [] });
    }
  });
