import { UsersTable } from "@/components/admin/UsersTable";
import { requirePageAdmin } from "@/lib/access";
import { listUsers } from "@/lib/accounts";

export default async function AdminUsers() {
  await requirePageAdmin();
  return <UsersTable users={await listUsers()} />;
}
