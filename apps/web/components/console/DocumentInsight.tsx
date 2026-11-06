"use client";

import { Alert } from "@krizaka/ui/alert";
import { type DocumentInsight as Insight, TEXT_SOURCE, type TextSource } from "@verikora/core";

import { amountsOnce } from "@/lib/document-face";
import { useSay } from "@/lib/i18n-client";
import { keyedByLabel } from "@/lib/text-parts";

const date = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const money = (cents: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency: "CAD" }).format(cents / 100);

type Say = (key: string, vars?: Record<string, string | number>) => string;
type Row = [string, React.ReactNode];
type Understanding = Insight["understanding"];

/** What the text says of the document: issuer, dates, parties, references, amounts (one per kind), language, pages. */
function understandingRows(u: Understanding, say: Say, locale: string): Row[] {
  const rows: Row[] = [];
  if (u.issuer) rows.push([say("insight.issuer"), u.issuer]);
  for (const d of u.dates
    .filter((x) => x.kind !== "other")
    .concat(u.dates.filter((x) => x.kind === "other").slice(0, 3)))
    rows.push([say(`insight.dateKinds.${d.kind}`), date(d.value, locale)]);
  for (const p of u.parties) rows.push([say(`insight.roles.${p.role}`), p.name]);
  for (const r of u.references)
    rows.push([
      say(`insight.refKinds.${r.kind}`),
      <span key={r.kind} className="break-all tabular-nums">
        {r.value}
      </span>,
    ]);
  // One amount per kind (the review's D3): « Loyer » never twice.
  for (const a of amountsOnce(u.amounts).slice(0, 8))
    rows.push([say(`insight.amountKinds.${a.kind}`), money(a.cents, locale)]);
  if (u.language !== "unknown") rows.push([say("insight.language"), say(`insight.languages.${u.language}`)]);
  if (u.pages) rows.push([say("insight.pages"), String(u.pages)]);
  return rows;
}

/** How a photo's text was read, in words. */
function sourceHow(source: TextSource, say: Say): string {
  if (source.kind === TEXT_SOURCE.vision) return say("insight.sourcePhotoVision", { runId: source.runId });
  return say(source.photos > 1 ? "insight.sourcePhotoOcrPages" : "insight.sourcePhotoOcr", {
    confidence: Math.round(source.confidence),
    count: source.photos,
  });
}

/** A photo: how its text was read and where the photo comes from — reported, never a verdict. */
function sourceRows(source: TextSource, say: Say, locale: string): Row[] {
  const rows: Row[] = [
    [
      say("insight.source"),
      <span key="source" data-testid="text-source">
        {sourceHow(source, say)}
      </span>,
    ],
  ];
  const o = source.origin;
  if (o?.device) rows.push([say("insight.originDevice"), o.device]);
  if (o?.software) rows.push([say("insight.originSoftware"), o.software]);
  if (o?.takenAt) rows.push([say("insight.originTaken"), date(o.takenAt.slice(0, 10), locale)]);
  if (o?.modifiedAt) rows.push([say("insight.originModified"), date(o.modifiedAt.slice(0, 10), locale)]);
  return rows;
}

function NatureLine({ u, say, lang }: Readonly<{ u: Understanding; say: Say; lang: "fr" | "en" }>) {
  if (!u.nature) return <p className="text-fg-secondary">{say("insight.unknown")}</p>;
  return (
    <p>
      <strong>{u.nature.label[lang]}</strong>{" "}
      <span className="text-fg-secondary">({say(`insight.confidence.${u.nature.confidence}`)})</span>
      {u.alternative ? (
        <span className="block text-sm text-fg-secondary">
          {say("insight.alternative", { nature: u.alternative.label[lang] })}
        </span>
      ) : null}
    </p>
  );
}

function PiiNotice({
  insight,
  documentId,
  say,
  locale,
}: Readonly<{ insight: Insight; documentId: string; say: Say; locale: string }>) {
  if (insight.pii.total <= 0) return null;
  const pii = Object.entries(insight.pii.counts);
  return (
    <Alert tone="warning" title={say("insight.piiTitle")}>
      <p data-testid="pii-notice">
        {pii
          .map(([kind, n]) => {
            const name = say(`insight.piiKinds.${kind}`);
            return `${name} : ${n}`;
          })
          .join(" · ")}
      </p>
      <p className="mt-2 text-sm">{say("insight.piiRetention")}</p>
      <p className="mt-2">
        <a
          className="font-semibold underline"
          href={`/api/documents/${documentId}/redacted?lang=${locale}`}
          download
          data-testid="redacted-download"
        >
          {say("insight.piiRedacted")}
        </a>
      </p>
    </Alert>
  );
}

/**
 * « Ce document »: what it is and what it holds, read in-process from its text (no model, nothing sent). The nature carries its
 * confidence; when no legal check fits it says so plainly. Personal information is counted, never listed.
 */
export function DocumentInsight({
  insight,
  documentId,
  source,
}: Readonly<{ insight: Insight; documentId: string; source?: TextSource }>) {
  const { say, locale } = useSay();
  const u = insight.understanding;
  const lang = locale;
  const rows = [...understandingRows(u, say, locale), ...(source ? sourceRows(source, say, locale) : [])];
  const weak = source?.kind === TEXT_SOURCE.ocr && source.lowConfidence;
  return (
    <section aria-labelledby="insight-title" className="flex flex-col gap-3" data-testid="document-insight">
      <h2 id="insight-title" className="text-lg font-semibold">
        {say("insight.title")}
      </h2>
      <NatureLine u={u} say={say} lang={lang} />
      {weak ? <Alert tone="warning">{say("insight.sourceLow")}</Alert> : null}
      {source?.origin?.hadGps ? <p className="m-0 text-sm text-fg-secondary">{say("insight.originGps")}</p> : null}
      {!u.check ? <Alert tone="info">{say("insight.noCheck")}</Alert> : null}
      {rows.length ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {keyedByLabel(rows).map(({ key, label, value }) => (
            <div key={key} className="contents">
              <dt className="text-fg-secondary">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <PiiNotice insight={insight} documentId={documentId} say={say} locale={locale} />
      <p className="text-xs text-fg-secondary">{say("insight.informative")}</p>
    </section>
  );
}
