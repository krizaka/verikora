import { Badge } from "@krizaka/ui/badge";
import { Card } from "@krizaka/ui/card";
import { DescriptionList } from "@krizaka/ui/description-list";

import { formatDate } from "@/components/console/format";
import { overview } from "@/lib/admin";
import { query } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { asLocale, getDictionary } from "@/lib/i18n";
import { APP_VERSION } from "@/lib/site";

async function reachable(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch {
    return false;
  }
}

/** Health and version, then the counts — read on the server at each visit. */
export default async function AdminOverview({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const t = getDictionary(locale).console.adminConsole.overview;
  const [o, db, edge] = await Promise.all([
    overview(),
    reachable(() => query("SELECT 1")),
    reachable(async () => {
      const res = await fetch(`${readEnv().AI_API_URL}/actuator/health`, {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
    }),
  ]);
  const up = (ok: boolean) => <Badge tone={ok ? "success" : "danger"}>{ok ? t.up : t.down}</Badge>;
  const runs = Object.entries(o.runs);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card.Root className="p-4">
        <h2 className="mb-3 font-display text-base font-bold text-fg">{t.health}</h2>
        <DescriptionList
          items={[
            {
              term: t.version,
              details: (
                <code className="font-mono text-xs" data-testid="app-version">
                  {APP_VERSION}
                </code>
              ),
            },
            { term: t.database, details: up(db) },
            { term: t.sovkora, details: up(edge) },
          ]}
        />
      </Card.Root>
      <Card.Root className="p-4">
        <h2 className="mb-3 font-display text-base font-bold text-fg">{t.accounts}</h2>
        <DescriptionList
          items={[
            { term: t.accounts, details: `${o.accounts} · ${o.admins} ${t.admins} · ${o.suspended} ${t.suspended}` },
            { term: t.documents, details: `${o.documents} · ${(o.bytes / 1e6).toFixed(1)} MB ${t.stored}` },
            { term: t.runs, details: runs.length ? runs.map(([s, n]) => `${s} ${n}`).join(" · ") : t.none },
            { term: t.lastRun, details: o.lastRunAt ? formatDate(o.lastRunAt, locale, true) : t.none },
          ]}
        />
      </Card.Root>
    </div>
  );
}
