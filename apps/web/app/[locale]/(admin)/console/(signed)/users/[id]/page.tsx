import { notFound } from "next/navigation";

import { AuditTable } from "@/components/admin/AdminTables";
import { UserCard } from "@/components/admin/UserCard";
import { requirePageAdmin } from "@/lib/access";
import { auditLog, userDetail } from "@/lib/admin";
import { HttpError } from "@/lib/http";

/** One account: its facts, suspend or restore, its history. */
export default async function AdminUser({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  await requirePageAdmin();
  const { id } = await params;
  const user = await userDetail(id).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  });
  if (!user) notFound();
  return (
    <div className="flex flex-col gap-6">
      <UserCard initial={user} />
      <AuditTable entries={await auditLog(100, user.id)} />
    </div>
  );
}
