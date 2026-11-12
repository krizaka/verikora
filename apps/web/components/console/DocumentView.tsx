"use client";

import { krizakaFetch, useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { DescriptionList } from "@krizaka/ui/description-list";
import { DetailLayout } from "@krizaka/ui/detail-layout";
import type { Located } from "@krizaka/ui/document-viewer";
import { Tabs } from "@krizaka/ui/tabs";
import {
  ANALYSIS_STATUS,
  type Audience,
  type DocumentView as DocumentViewData,
  documentView,
  isExtracting,
  type Jurisdiction,
  queryKeys,
  type Studio,
} from "@verikora/core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { z } from "zod";

import { type DocumentTab } from "@/lib/console-nav";
import { displayTitle } from "@/lib/document-face";
import { useSay } from "@/lib/i18n-client";
import type { LeaseBundle } from "@/lib/lease-bundle";
import { collectionLabel } from "@/lib/organisation/display";
import { libraryPath } from "@/lib/organisation/rules";
import type { RegistryReport } from "@/lib/registries/report";
import type { Answer } from "@/lib/signal-answers";

import { documentFacts, highlightsOf } from "./document-view-model";
import { DocumentActions } from "./DocumentActions";
import { DocumentFileTab } from "./DocumentFileTab";
import { DocumentHistoryTab } from "./DocumentHistoryTab";
import { DocumentReportTab } from "./DocumentReportTab";
import { STATUS_TONE } from "./DocumentTable";
import { formatBytes, formatDate } from "./format";
import { LiveAnalysis } from "./LiveAnalysis";
import type { FindingSelection } from "./ReportFace";
import { ReportShare } from "./ReportShare";
import { StartCards, StartCheckActions } from "./StartChecks";

/**
 * The document on `DetailLayout` (the UX review's Y5): the title the insight knows, the status, the one primary action by state,
 * the rest in a menu; three tabs as routes — the report first (the verdict, the findings with what failed first, the engine's
 * facts folded), the document (the file or its text, what Verikora read in it, where it lives), the history of its runs —; the
 * sharing in the side panel. The way back leads to the document's collection; once a report is shown, the aside holds the facts
 * (collection, file, retention), the other checks as actions (each a dialog) and the sharing (design § 5.3). Every analysis is an Sovkora run, shown as it came back. This component holds what the tabs share
 * (the document, the lit finding, the deletion); each tab and the actions are their own component (verikora#320, #110).
 */
/** Where the document sits: its collection (the way back), or null when the page could not say. */
export interface DocumentPlace {
  libraryId: string;
  collectionId: string;
  name: string;
  isDefault: boolean;
}

type Say = ReturnType<typeof useSay>["say"];
type Facts = ReturnType<typeof documentFacts>;
type StartProps = Parameters<typeof StartCheckActions>[0];

function retentionText(doc: DocumentViewData, say: Say, locale: Parameters<typeof formatDate>[1]): string {
  if (doc.purged) {
    return say("document.where.retentionNotKept");
  }
  if (doc.retainUntil) {
    return say("document.where.retentionUntil", { date: formatDate(doc.retainUntil, locale) });
  }
  return say("document.where.retentionNone");
}

/** « Voir dans le fichier »: on a narrow screen the file sits above the findings, bring it into view; the viewer scrolls to the passage itself. */
function bringIntoView(id: string, viewer: HTMLElement | null, textShown: boolean) {
  if (globalThis.matchMedia?.("(max-width: 1279px)").matches) {
    viewer?.scrollIntoView({
      block: "start",
      behavior: globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }
  if (textShown) {
    document.getElementById(`passage-${id}`)?.scrollIntoView({ block: "center" });
  }
}

/** The aside of a reported document: its facts, the other checks as actions and the sharing (design § 5.3). */
function ReportAside({
  doc,
  facts,
  placeName,
  retention,
  startProps,
}: Readonly<{
  doc: DocumentViewData;
  facts: Facts;
  placeName: string | null;
  retention: string;
  startProps: Omit<StartProps, "done">;
}>) {
  const { say } = useSay();
  const { latestCompliance, certifiable } = facts;
  return (
    <div className="flex flex-col gap-6" data-testid="report-aside-column">
      <section aria-labelledby="document-facts-title" className="flex flex-col gap-2" data-testid="document-facts">
        <h2 id="document-facts-title" className="m-0 text-base font-bold text-fg">
          {say("document.facts.title")}
        </h2>
        <DescriptionList
          items={[
            ...(placeName ? [{ term: say("document.facts.collection"), details: placeName }] : []),
            { term: say("document.file"), details: <span className="break-all">{doc.filename}</span> },
            { term: say("document.where.title"), details: retention },
          ]}
        />
      </section>
      <StartCheckActions {...startProps} done={facts.done} />
      {certifiable && latestCompliance ? (
        <section aria-label={say("reportFace.whoSees")} className="flex flex-col gap-2" data-testid="report-aside">
          <h2 className="m-0 text-base font-bold text-fg">{say("reportFace.whoSees")}</h2>
          <p className="m-0 text-sm text-fg-secondary">{say("reportFace.onlyYou")}</p>
          <ReportShare documentId={doc.id} analysisId={latestCompliance.id} />
          <p className="m-0 text-xs text-fg-muted">{say("analysis.language")}</p>
        </section>
      ) : null}
    </div>
  );
}

export function DocumentView({
  initial,
  tab,
  place = null,
  perspective = null,
  bundle = null,
  registry = null,
  answers,
  offer,
}: Readonly<{
  initial: DocumentViewData;
  tab: DocumentTab;
  place?: DocumentPlace | null;
  perspective?: Audience | null;
  bundle?: LeaseBundle | null;
  registry?: RegistryReport | null;
  answers?: Record<string, Answer>;
  offer: { studios: readonly Studio[]; jurisdictions: readonly Jurisdiction[]; rulesets: readonly string[] };
}>) {
  const { say, locale } = useSay();
  const router = useRouter();
  const client = useQueryClient();
  const params = useSearchParams();
  const doc = useQuery({
    queryKey: queryKeys.document(initial.id),
    queryFn: () =>
      krizakaFetch(`/api/documents/${initial.id}`, { schema: z.object({ document: documentView }) }).then(
        (r) => r.document,
      ),
    initialData: initial,
    // The text is read after the upload answered (202 Accepted): look again until it is.
    refetchInterval: (query) => (isExtracting(query.state.data?.extraction) ? 1500 : false),
  }).data;
  const remove = useMutation({
    mutationFn: () => krizakaFetch(`/api/documents/${initial.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.documents() });
      router.replace(`/${locale}/app`);
    },
  });
  const path = `/${locale}/app/documents/${initial.id}`;
  // The tab is the route (/documents/[id]/rapport|document|historique): back, forward, refresh and sharing all work.
  const go = (next: DocumentTab, query = "") => router.push(`${path}/${next}${query}`, { scroll: false });
  // The lit finding is in the address (`?finding=`): « Voir dans le fichier » opens the document tab on it; back returns to the report.
  const [activeId, setActiveId] = useState<string | null>(params.get("finding"));
  const [found, setFound] = useState<Record<string, Located | null>>({});
  const viewerRef = useRef<HTMLDivElement>(null);
  const fileUrl = `/api/documents/${doc.id}/file`;
  // The history can open an earlier run's report (`?run=`): its findings, its download and its sharing follow it.
  const facts = documentFacts(doc, { run: params.get("run"), locale });
  const { latestCompliance, latestReport, certifiable, reportHref, isPdf } = facts;
  const lang = locale;
  // The title says what was filed and when (« Bail déposé le … »); a document of no known kind keeps what the insight reads in it.
  const title =
    doc.kind === "lease" || doc.kind === "contract" || doc.kind === "invoice"
      ? say(`document.uploadedTitle.${doc.kind}`, { date: formatDate(doc.createdAt, locale) })
      : displayTitle(doc, lang);
  const highlights = highlightsOf(latestReport);
  const selection: FindingSelection = {
    activeId,
    onSelect: (id) => {
      setActiveId(id);
      if (!id) {
        return;
      }
      go("document", `?finding=${encodeURIComponent(id)}`);
      bringIntoView(id, viewerRef.current, !isPdf || Boolean(doc.textSource));
    },
  };
  const startProps = { doc, perspective, offer, examinable: facts.examinable, running: facts.running };
  const startCards = <StartCards {...startProps} />;
  const placeName = place ? collectionLabel(place.name, place.isDefault, say("organisation.defaultName")) : null;
  const retention = retentionText(doc, say, locale);
  const kindName = say(`kinds.${doc.kind}`);

  return (
    <DetailLayout
      back={
        place ? (
          <Link
            className="inline-flex min-h-11 items-center"
            href={libraryPath(locale, place.libraryId, place.collectionId)}
          >
            {placeName}
          </Link>
        ) : (
          <Link className="inline-flex min-h-11 items-center" href={`/${locale}/app`}>
            {say("document.back")}
          </Link>
        )
      }
      eyebrow={`${kindName} · ${doc.filename}`}
      title={title}
      status={<Badge tone={STATUS_TONE[doc.status]}>{say(`statuses.${doc.status}`)}</Badge>}
      meta={[
        doc.pages ? say("library.pages", { count: doc.pages }) : null,
        formatBytes(doc.sizeBytes, locale),
        doc.retainUntil ? say("document.where.retentionUntil", { date: formatDate(doc.retainUntil, locale) }) : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      actions={
        <DocumentActions
          fileUrl={fileUrl}
          reportHref={certifiable ? reportHref : null}
          shareProps={certifiable && latestCompliance ? { documentId: doc.id, analysisId: latestCompliance.id } : null}
          onDelete={() => remove.mutate()}
          deleting={remove.isPending}
        />
      }
      tabs={
        <Tabs.Nav label={say("document.viewer")} current={`${path}/${tab}`}>
          {facts.tabs.map((t) => (
            <Tabs.NavLink key={t} href={`${path}/${t}`} exact asChild className="min-h-11">
              <Link href={`${path}/${t}`} scroll={false}>
                {say(`document.tabs.${t}`)}
              </Link>
            </Tabs.NavLink>
          ))}
        </Tabs.Nav>
      }
      aside={
        facts.reported ? (
          <ReportAside doc={doc} facts={facts} placeName={placeName} retention={retention} startProps={startProps} />
        ) : undefined
      }
    >
      {isExtracting(doc.extraction) ? <Alert tone="info">{say("document.reading")}</Alert> : null}
      {doc.extraction === "failed" ? (
        <Alert tone="danger">{say(`errors.${doc.extractionError ?? "UNREADABLE_FILE"}`)}</Alert>
      ) : null}
      {doc.analyses
        .filter((a) => a.status === ANALYSIS_STATUS.running)
        .map((a) => (
          <LiveAnalysis key={a.id} documentId={doc.id} analysis={a} />
        ))}
      {tab === "rapport" ? (
        <DocumentReportTab
          doc={doc}
          facts={facts}
          selection={selection}
          perspective={perspective}
          bundle={bundle}
          registry={registry}
          answers={answers}
          startCards={startCards}
        />
      ) : null}
      {tab === "document" ? (
        <DocumentFileTab
          doc={doc}
          path={path}
          isPdf={isPdf}
          report={latestReport}
          viewer={{ fileUrl, highlights, activeId, onActiveChange: setActiveId, onLocate: setFound }}
          viewerRef={viewerRef}
          found={found}
          onDelete={() => remove.mutate()}
          deleting={remove.isPending}
        />
      ) : null}
      {tab === "historique" ? <DocumentHistoryTab doc={doc} path={path} latestCompliance={latestCompliance} /> : null}
    </DetailLayout>
  );
}
