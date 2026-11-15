import { requireAdmin } from "./access";
import { setUserStatus } from "./admin";
import { isUuid } from "./documents";
import { handle, refuse } from "./http";

type Params = { params: Promise<{ id: string }> };
type Admin = { id: string; email: string };

/**
 * The shell of an administrator's route on one flow: an administrator, a flow id that is a UUID (404 otherwise), then the
 * route's own work. The handler returns the JSON body.
 */
export const flowAdminRoute =
  (work: (admin: Admin, flowId: string, req: Request) => Promise<unknown>) =>
  (req: Request, { params }: Params) =>
    handle(async () => {
      const session = await requireAdmin(req);
      const { id } = await params;
      if (!isUuid(id)) {
        throw refuse(404, "NOT_FOUND", "No such flow");
      }
      return Response.json(await work({ id: session.account.id, email: session.account.email }, id, req));
    });

/** The route that puts an account in a status (suspend, restore): an administrator, the account's id, the new status. */
export const userStatusRoute =
  (status: "ACTIVE" | "SUSPENDED") =>
  (req: Request, { params }: Params) =>
    handle(async () => {
      const session = await requireAdmin(req);
      return Response.json({ user: await setUserStatus(session.account, (await params).id, status, req.headers) });
    });
