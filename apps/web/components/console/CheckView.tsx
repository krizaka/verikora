"use client";

import { BillingIcon, EditIcon, HomeIcon, MoreIcon } from "@krizaka/icons";
import { ChoiceCards } from "@krizaka/ui/account-settings";
import { List } from "@krizaka/ui/list";
import { PageHeader } from "@krizaka/ui/page-header";
import { Stepper, type StepStatus } from "@krizaka/ui/stepper";
import { DOCUMENT_KINDS, type DocumentKind, type Jurisdiction } from "@verikora/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef } from "react";

import { useAppConfig } from "@/lib/app-config-client";
import { type CatalogueItem, checkHref } from "@/lib/check-catalogue";
import { type CheckRow, checkRows, FLOW_STEPS, flowStep, opensAtOnce, reportHref } from "@/lib/check-queue";
import { checksTabHref, CONSOLE_ROUTES } from "@/lib/console-nav";
import type { CreditsFigure } from "@/lib/home-b2";
import { useSay } from "@/lib/i18n-client";
import { ROUTE_STATES } from "@/lib/route-state";
import { useRouteState } from "@/lib/use-route-state";

import { CheckCatalogue, CheckPlanStrip } from "./CheckCatalogue";
import { DocumentUploader } from "./DocumentUploader";
import { startIfSure } from "./start-check";

const ICONS: Record<DocumentKind, typeof HomeIcon> = {
  lease: HomeIcon,
  contract: EditIcon,
  invoice: BillingIcon,
  other: MoreIcon,
};

/**
 * « Quel document ? » for one file whose kind Verikora did not recognise for sure (verikora#318, § 5.4 of the design
 * direction): the kinds as `ChoiceCards`, each with its title and its hint. Picking one starts the check of that file.
 */
export function KindQuestion({
  filename,
  onPick,
  disabled = false,
}: Readonly<{ filename: string; onPick: (kind: DocumentKind) => void; disabled?: boolean }>) {
  const { say } = useSay();
  return (
    <ChoiceCards
      showLabel
      label={say("library.kindPick")}
      description={say("library.kindUnsure", { name: filename })}
      options={DOCUMENT_KINDS.map((kind) => {
        const Icon = ICONS[kind];
        return {
          id: kind,
          icon: <Icon size={20} />,
          title: say(`kinds.${kind}`),
          description: say(`library.kindHints.${kind}`),
          disabled,
        };
      })}
      onValueChange={(id) => onPick(id as DocumentKind)}
      data-testid="kind-choice"
    />
  );
}

/** One row per file that landed, its stage in words (verikora#326): « Quel document ? » under each uncertain one; a row under way links to its report. */
export function CheckQueue({
  rows,
  onPick,
  questions = true,
}: Readonly<{
  rows: readonly CheckRow[];
  onPick: (row: CheckRow, kind: DocumentKind) => void;
  /** False when the page asks « Which document? » itself, above the drop, in view (krizaka-internal#1899). */
  questions?: boolean;
}>) {
  const { say, locale } = useSay();
  if (!rows.length) return null;
  const linked = (r: CheckRow) => r.stage === "started" || r.stage === "refused";
  return (
    <div className="flex flex-col gap-4" data-testid="check-queue">
      <List
        aria-label={say("check.queueLabel")}
        items={rows}
        getId={(r) => r.id}
        chevrons
        row={(r) => ({
          title: r.filename,
          description: say(`check.stages.${r.stage}`, r.refused ? { reason: say(`errors.${r.refused}`) } : undefined),
          ...(linked(r) ? { href: reportHref(locale, r) } : {}),
        })}
      />
      {(questions ? rows : [])
        .filter((r) => r.stage === "asking")
        .map((r) => (
          <KindQuestion key={r.id} filename={r.filename} onPick={(kind) => onPick(r, kind)} />
        ))}
    </div>
  );
}

/** The flow in four steps (krizaka-internal#1899): the person always sees where they are and what comes next. */
export function FlowSteps({ rows }: Readonly<{ rows: readonly CheckRow[] }>) {
  const { say } = useSay();
  const current = FLOW_STEPS.indexOf(flowStep(rows));
  const statusOf = (index: number): StepStatus => {
    if (index < current) {
      return "done";
    }
    return index === current ? "current" : "upcoming";
  };
  return (
    <Stepper
      aria-label={say("check.flow.label")}
      data-testid="check-flow"
      labels={{
        done: say("steps.state.done"),
        current: say("steps.state.current"),
        upcoming: say("steps.state.upcoming"),
        error: say("steps.state.error"),
      }}
      steps={FLOW_STEPS.map((id, index) => ({ title: say(`check.flow.${id}`), status: statusOf(index) }))}
    />
  );
}

/**
 * « Vérifier un document », the task page the header's action opens (the UX review's Y4, § 5.4 of the design direction):
 * the defaults said before the drop with « Modifier » (Errata 6), the drop zone, then one row per file in words. The kind is
 * never asked before the drop (`?type=` may still name it): a file whose kind is sure starts at once, an uncertain one is
 * asked « Quel document ? » for that file only. A single file opens its report as soon as it is under way; with several,
 * each row links to its own (verikora#318, #326).
 */
/** The question arrives under the title and the steps: on a phone it is brought on screen, never left below the fold. */
function showQuestion(el: HTMLDivElement | null) {
  el?.scrollIntoView({ block: "nearest" });
}

export function CheckView({
  jurisdictions = ["QC"],
  catalogue = [],
  credits = null,
}: Readonly<{
  jurisdictions?: readonly Jurisdiction[];
  catalogue?: readonly CatalogueItem[];
  credits?: CreditsFigure | null;
}>) {
  const { say, locale } = useSay();
  const router = useRouter();
  const [kind] = useRouteState(ROUTE_STATES.checkKind.state);
  const app = useAppConfig();
  const kindRef = useRef<DocumentKind | "auto">(kind);
  useEffect(() => {
    kindRef.current = kind;
  }, [kind]);
  const [rows, dispatch] = useReducer(checkRows, []);
  const dropped = useRef(0);
  const follow = async (id: string, requested: DocumentKind | "auto") => {
    const outcome = await startIfSure(id, requested, jurisdictions, new Date());
    dispatch({ type: "outcome", id, outcome, requested });
    // A refusal (an entitlement, a rule) travels to the report tab, which says it above its own form.
    if (opensAtOnce(dropped.current) && (outcome.started || outcome.refused || requested !== "auto"))
      router.push(reportHref(locale, { id, refused: outcome.refused }));
  };
  const landed = (document: { id: string; filename: string }, requested: DocumentKind | "auto") => {
    dispatch({ type: "landed", document });
    void follow(document.id, requested);
  };
  const asking = rows.filter((r) => r.stage === "asking");
  const pick = (row: CheckRow, chosen: DocumentKind) => {
    dispatch({ type: "picked", id: row.id });
    // Named by the person, the kind is sure; a mismatch with what Verikora read is still confirmed on the report tab.
    void follow(row.id, chosen);
  };
  return (
    <section className="flex max-w-5xl flex-col gap-5" aria-label={say("library.dropTitle")}>
      <PageHeader
        breadcrumb={
          <Link href={`/${locale}${CONSOLE_ROUTES.library}`} className="text-sm text-fg-muted hover:text-fg">
            ← {say("shell.library")}
          </Link>
        }
        title={say("shell.titles.check")}
        description={say("library.checkLead")}
      />
      <div
        className={
          catalogue.length
            ? "grid grid-cols-1 gap-8 min-[1440px]:grid-cols-[7fr_5fr] min-[1440px]:items-start"
            : "flex max-w-3xl flex-col gap-5"
        }
      >
        <div id="depot" className="flex min-w-0 scroll-mt-24 flex-col gap-5" data-testid="check-drop">
          <h2 className="m-0 font-display text-lg font-bold text-fg">{say("check.dropTitle")}</h2>
          {kind !== "auto" ? (
            <p className="m-0 text-sm text-fg-secondary" data-testid="check-chosen">
              {say("check.catalogue.chosen", { kind: say(`kinds.${kind}`) })} ·{" "}
              <Link
                className="font-semibold text-fg-accent underline-offset-2 hover:underline"
                href={checkHref(locale, "auto").replace(/#depot$/, "")}
              >
                {say("check.catalogue.change")}
              </Link>
            </p>
          ) : null}
          <DocumentUploader
            defaultsFirst
            kindRef={kindRef}
            onDrop={(files) => (dropped.current += files.length)}
            onUploaded={landed}
          />
          <div className="hidden lg:block">
            <FlowSteps rows={rows} />
          </div>
          {asking.map((r) => (
            <div key={r.id} data-testid="check-kind-question" ref={showQuestion}>
              <KindQuestion filename={r.filename} onPick={(kind) => pick(r, kind)} />
            </div>
          ))}
          <CheckQueue rows={rows} onPick={pick} questions={false} />
        </div>
        {catalogue.length ? <CheckCatalogue items={catalogue} /> : null}
      </div>
      {credits ? <CheckPlanStrip credits={credits} /> : null}
      {app?.features.batches ? (
        <p className="m-0 text-sm text-fg-secondary">
          {say("batch.fromCheck")}{" "}
          <Link
            className="font-semibold text-fg-accent underline-offset-2 hover:underline"
            href={checksTabHref(locale, "lots")}
          >
            {say("batch.fromCheckLink")}
          </Link>
        </p>
      ) : null}
      <p className="m-0 text-xs text-fg-muted">{say("library.informative")}</p>
    </section>
  );
}
