import { OperationsView } from "@/components/admin/OperationsView";
import { requirePageAdmin } from "@/lib/access";
import { databaseBudget, poolUsage, queue, recentErrors, rulesetsInUse, signingKeyId } from "@/lib/operations";

export const dynamic = "force-dynamic";

/** Pool and connections against their budgets, the queue, the latest errors, the rulesets in use, the signing key's id. */
export default async function AdminOperations() {
  await requirePageAdmin();
  const [budget, jobs, errors, rulesets] = await Promise.all([
    databaseBudget(),
    queue(),
    recentErrors(),
    rulesetsInUse(),
  ]);
  return (
    <OperationsView
      pool={poolUsage()}
      budget={budget}
      queue={jobs}
      errors={errors}
      rulesets={rulesets}
      signing={signingKeyId()}
    />
  );
}
