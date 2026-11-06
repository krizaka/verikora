import { requireAdmin } from "@/lib/access";
import { exportAccount } from "@/lib/admin";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Law 25 portability: everything held about the account, as a JSON download. */
export function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireAdmin(req);
    const { id } = await params;
    const data = await exportAccount(session.account, id, req.headers);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="verikora-account-${id}.json"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
