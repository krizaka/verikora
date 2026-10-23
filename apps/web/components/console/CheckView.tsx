"use client";

import { AiIcon, BillingIcon, EditIcon, HomeIcon, MoreIcon } from "@krizaka/icons";
import { ChoiceGrid } from "@krizaka/ui/choice-grid";
import { PageHeader } from "@krizaka/ui/page-header";
import { type DocumentKind, type Jurisdiction } from "@yomizaka/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useAppConfig } from "@/lib/app-config-client";
import { checksTabHref, CONSOLE_ROUTES } from "@/lib/console-nav";
import { useSay } from "@/lib/i18n-client";
import { CHECK_KINDS, type CheckKind, ROUTE_STATES } from "@/lib/route-state";
import { useRouteState } from "@/lib/use-route-state";

import { DocumentUploader } from "./DocumentUploader";
import { startIfSure } from "./start-check";

const ICONS: Record<CheckKind, typeof AiIcon> = { auto: AiIcon, lease: HomeIcon, contract: EditIcon, invoice: BillingIcon, other: MoreIcon };

/**
 * « Vérifier un document », the task page the header's action opens (the UX review's Y4): the drop zone first and large, the
 * kind under it as a choice (« Quel document ? », Automatique preselected, the URL is the state), the options folded once
 * files are known. A file that landed opens on its report: the check starts at once when the kind is sure, otherwise the
 * report tab asks to confirm (`lib/check-flow.ts`).
 */
export function CheckView({ jurisdictions = ["QC"] }: { jurisdictions?: readonly Jurisdiction[] }) {
  const { say, locale } = useSay();
  const router = useRouter();
  const [kind] = useRouteState(ROUTE_STATES.checkKind.state);
  const app = useAppConfig();
  const kindRef = useRef<DocumentKind | "auto">(kind);
  useEffect(() => {
    kindRef.current = kind;
  }, [kind]);
  const open = async (id: string, requested: DocumentKind | "auto") => {
    const outcome = await startIfSure(id, requested, jurisdictions);
    // A refusal (an entitlement, a rule) travels to the report tab, which says it above its own form.
    router.push(`/${locale}/app/documents/${id}/verifications${outcome.refused ? `?refused=${encodeURIComponent(outcome.refused)}` : ""}`);
  };
  return (
    <section className="flex max-w-3xl flex-col gap-5" aria-label={say("library.dropTitle")}>
      <PageHeader
        breadcrumb={
          <Link href={`/${locale}${CONSOLE_ROUTES.library}`} className="text-sm text-fg-muted hover:text-fg">
            ← {say("shell.library")}
          </Link>
        }
        title={say("shell.titles.check")}
        description={say("library.checkLead")}
      />
      <DocumentUploader kindRef={kindRef} onUploaded={(d, requested) => void open(d.id, requested)} />
      <ChoiceGrid
        label={say("library.kindPick")}
        prompt={say("library.kindPick")}
        routeKey={ROUTE_STATES.checkKind.state.key}
        routeValues={CHECK_KINDS}
        defaultValue={ROUTE_STATES.checkKind.state.fallback}
        columns={5}
        animated={false}
        items={CHECK_KINDS.map((k) => {
          const Icon = ICONS[k];
          return { id: k, visual: <Icon size={24} />, name: say(`kinds.${k}`), meta: say(`library.kindHints.${k}`) };
        })}
        data-testid="kind-choice"
      />
      {app?.features.batches ? (
        <p className="m-0 text-sm text-fg-secondary">
          {say("batch.fromCheck")}{" "}
          <Link className="font-semibold text-fg-accent underline-offset-2 hover:underline" href={checksTabHref(locale, "lots")}>
            {say("batch.fromCheckLink")}
          </Link>
        </p>
      ) : null}
      <p className="m-0 text-xs text-fg-muted">{say("library.informative")}</p>
    </section>
  );
}
