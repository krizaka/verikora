"use client";

import { Alert } from "@krizaka/ui/alert";
import { DescriptionList } from "@krizaka/ui/description-list";
import { DocumentViewer, type Located } from "@krizaka/ui/document-viewer";
import { type ComplianceReport, type DocumentView, passages } from "@verikora/core";
import Link from "next/link";
import { type ComponentProps, memo, type RefObject, useMemo } from "react";

import { DocumentInsight } from "@/components/console/DocumentInsight";
import { useSay } from "@/lib/i18n-client";
import { atOffsets } from "@/lib/text-parts";

import { placeOf } from "./document-view-model";
import { formatBytes, formatDate } from "./format";
import { StorageNotice } from "./StorageNotice";

/** pdf.js is loaded on this page only, and its worker is served from this origin (CSP: 'self'). */
const loadPdfjs = () =>
  import("pdfjs-dist") as unknown as ReturnType<ComponentProps<typeof DocumentViewer>["loadPdfjs"]>;
const WORKER_SRC = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

/** The document's text, the passages a compliance report quotes marked where they sit. */
function DocumentText({ text, report }: Readonly<{ text: string; report: ComplianceReport | null }>) {
  const { say } = useSay();
  const parts = useMemo(
    () =>
      passages(
        text,
        (report?.findings ?? [])
          .filter((f) => f.evidenceSpan?.quote)
          .map((f) => ({ id: f.ruleId, quote: f.evidenceSpan!.quote, start: f.evidenceSpan!.start ?? undefined })),
      ),
    [text, report],
  );
  return (
    <div
      className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border-default bg-surface-1 p-4 text-sm leading-relaxed text-fg-secondary"
      data-testid="document-text"
    >
      {atOffsets(parts).map((p) =>
        p.mark ? (
          <mark
            key={p.at}
            id={`passage-${p.mark}`}
            className="ym-passage text-fg"
            title={say("document.passageOf", { rule: p.mark })}
          >
            {p.text}
          </mark>
        ) : (
          <span key={p.at}>{p.text}</span>
        ),
      )}
    </div>
  );
}

type ViewerProps = {
  fileUrl: string;
  highlights: ComponentProps<typeof DocumentViewer>["highlights"];
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
  onLocate: (found: Record<string, Located | null>) => void;
};

/** The PDF with the findings' passages lit; memoised, so the page's other state (a deletion, a run asked again) never redraws it (verikora#110). */
const PdfViewer = memo(function PdfViewer({ fileUrl, highlights, activeId, onActiveChange, onLocate }: ViewerProps) {
  const { say } = useSay();
  return (
    <DocumentViewer
      src={fileUrl}
      loadPdfjs={loadPdfjs}
      workerSrc={WORKER_SRC}
      highlights={highlights}
      activeId={activeId}
      onActiveChange={onActiveChange}
      onLocate={onLocate}
      className="[--kz-document-viewer-height:72vh]"
      labels={{
        region: say("document.viewerRegion"),
        loading: say("document.loadingPdf"),
        failed: say("document.pdfFailed"),
        page: say("document.pageLabel"),
        onPage: say("document.onPage"),
        notFound: say("document.notFound"),
      }}
    />
  );
});

/**
 * The document tab: the lit finding and where it sits (« Retour au rapport »), the file (the PDF viewer, or its text), what
 * Verikora read in it, where it lives (with « Supprimer maintenant »), and the file's facts.
 */
/** The file's identifiers, folded: its fingerprint, in the mono — the only place a code is drawn on this tab (design § 3.4). */
function FileTechnicalDetails({ sha256 }: Readonly<{ sha256: string }>) {
  const { say } = useSay();
  return (
    <details className="rounded-lg border border-border-default p-3" data-testid="file-technical-details">
      <summary className="cursor-pointer text-sm font-semibold text-fg">{say("document.technical")}</summary>
      <div className="mt-3">
        <DescriptionList
          items={[
            {
              term: say("document.fingerprint"),
              details: <code className="break-all font-mono text-xs">{sha256}</code>,
            },
          ]}
        />
      </div>
    </details>
  );
}

function FindingPlace({ title, place, path }: Readonly<{ title: string; place: string | null; path: string }>) {
  const { say } = useSay();
  return (
    <Alert tone="info" data-testid="finding-place">
      <span className="font-semibold">{title}</span>
      {place ? ` — ${place}` : null}
      {" · "}
      <Link href={`${path}/rapport`} scroll={false} className="underline">
        {say("reportFace.backToReport")}
      </Link>
    </Alert>
  );
}

/** The file itself: the PDF viewer, or why it is not there, or its text. */
function FileContent({
  doc,
  isPdf,
  report,
  viewer,
  viewerRef,
}: Readonly<{
  doc: DocumentView;
  isPdf: boolean;
  report: ComplianceReport | null;
  viewer: ViewerProps;
  viewerRef: RefObject<HTMLDivElement | null>;
}>) {
  const { say } = useSay();
  if (doc.purged) return <Alert tone="info">{say("document.where.notKeptText")}</Alert>;
  if (isPdf) {
    return (
      <div ref={viewerRef} className="min-w-0">
        <PdfViewer {...viewer} />
      </div>
    );
  }
  if (doc.hasText) return <DocumentText text={doc.text} report={report} />;
  return <Alert tone="info">{say("document.noText")}</Alert>;
}

export function DocumentFileTab({
  doc,
  path,
  isPdf,
  report,
  viewer,
  viewerRef,
  found,
  onDelete,
  deleting,
}: Readonly<{
  doc: DocumentView;
  path: string;
  isPdf: boolean;
  report: ComplianceReport | null;
  viewer: ViewerProps;
  viewerRef: RefObject<HTMLDivElement | null>;
  found: Record<string, Located | null>;
  onDelete: () => void;
  deleting: boolean;
}>) {
  const { say, locale } = useSay();
  const activeFinding = viewer.activeId ? (report?.findings.find((f) => f.ruleId === viewer.activeId) ?? null) : null;
  const place = viewer.activeId ? placeOf(found[viewer.activeId], say) : null;
  return (
    <section
      aria-label={say("document.tabs.document")}
      className="flex min-w-0 flex-col gap-6"
      data-testid="tab-document"
    >
      {activeFinding ? (
        <FindingPlace title={activeFinding.title ?? activeFinding.ruleId} place={place} path={path} />
      ) : null}
      <FileContent doc={doc} isPdf={isPdf} report={report} viewer={viewer} viewerRef={viewerRef} />
      {/* A photo becomes an image-only PDF: its text (OCR or vision) is shown under the viewer, where a finding can be found. */}
      {isPdf && !doc.purged && doc.textSource && doc.hasText ? <DocumentText text={doc.text} report={report} /> : null}
      {doc.insight ? <DocumentInsight insight={doc.insight} documentId={doc.id} source={doc.textSource} /> : null}
      <StorageNotice
        storage={doc.storage}
        retainUntil={doc.retainUntil}
        purged={doc.purged}
        onDelete={onDelete}
        deleting={deleting}
      />
      <DescriptionList
        items={[
          { term: say("document.file"), details: doc.filename },
          ...(doc.pages ? [{ term: say("document.pages"), details: String(doc.pages) }] : []),
          { term: say("document.size"), details: formatBytes(doc.sizeBytes, locale) },
          { term: say("document.added"), details: formatDate(doc.createdAt, locale, true) },
        ]}
      />
      <FileTechnicalDetails sha256={doc.sha256} />
    </section>
  );
}
