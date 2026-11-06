import { z } from "zod";

import { requireSession } from "@/lib/access";
import { env } from "@/lib/env";
import { handle, readJson } from "@/lib/http";
import { limit } from "@/lib/limits";
import { mailerFor } from "@/lib/mailer";
import { emailShare } from "@/lib/owner-report-shares";

export const dynamic = "force-dynamic";

/** E-mails the owner link (verikora#130), for the file's manager only: the link's token comes back with the address, a short note and the owner's language. */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireSession(req);
    await limit("reportMail", req, session.account.id);
    const { id } = await params;
    const input = await readJson(
      req,
      z.object({
        token: z.string().min(1).max(200),
        email: z.string().max(254),
        message: z.string().max(500).optional(),
        locale: z.enum(["en", "fr"]),
      }),
    );
    const e = env();
    const { sentTo } = await emailShare(
      session.account,
      id,
      input,
      { mail: mailerFor(e), origin: e.APP_PUBLIC_URL },
      new Date(),
      req.headers,
    );
    return Response.json({ sentTo }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  });
}
