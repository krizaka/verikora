import { Badge } from "@krizaka/ui/badge";

import { severityOf } from "@/lib/document-face";
import { useSay } from "@/lib/i18n-client";
import type { LeaseBundle } from "@/lib/lease-bundle";

/**
 * A lease and its annexes read as one (verikora#499, API of #129): the documents of the submission, then every finding that needs a look,
 * with its document, its line, the passage quoted, the rule and the article. It says what the rules report and that a lawyer has not
 * reviewed them yet; it gives no advice and no verdict about the lease.
 */
export function LeaseBundleSection({ bundle }: Readonly<{ bundle: LeaseBundle }>) {
  const { say } = useSay();
  const lines = bundle.lines.filter((l) => l.verdict !== "PASS");
  const toReview = bundle.rulesets.some((r) => r.reviewStatus === "TO_REVIEW_BY_LAWYER");
  return (
    <section
      aria-label={say("bundle.title")}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border-default p-3"
      data-testid="lease-bundle"
    >
      <div>
        <h2 className="m-0 font-display text-lg font-bold text-fg">{say("bundle.title")}</h2>
        <p className="m-0 text-sm text-fg-secondary">{say("bundle.lead")}</p>
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {bundle.documents.map((d) => (
          <li key={d.id}>
            <Badge tone={d.checked ? "neutral" : "warning"}>
              {d.title} · {say(`bundle.roles.${d.role}`)}
              {d.checked ? "" : ` · ${say("bundle.notChecked")}`}
            </Badge>
          </li>
        ))}
      </ul>
      {lines.length ? (
        <ol className="m-0 flex list-none flex-col gap-2 p-0" data-testid="bundle-lines">
          {lines.map((l) => {
            const s = severityOf(l.severity);
            return (
              <li
                key={`${l.documentId}-${l.ruleId}`}
                className="flex min-w-0 flex-col gap-1 rounded-lg border border-border-default bg-surface-1 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2 text-fg-muted">
                  <span className="font-semibold text-fg">{l.documentTitle}</span>
                  <span>{l.line === null ? say("bundle.noLine") : say("bundle.line", { n: l.line })}</span>
                  <Badge tone={s.tone}>{say(`analysis.severities.${s.word}`)}</Badge>
                </div>
                {l.quote ? (
                  <p className="m-0 italic text-fg-secondary">« {l.quote} »</p>
                ) : (
                  <p className="m-0 text-fg-muted">{say("reportFace.noQuote")}</p>
                )}
                {l.article ? (
                  <span className="text-xs text-fg-muted" data-testid="bundle-article">
                    {l.article}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="m-0 text-sm text-fg-secondary">{say("bundle.none")}</p>
      )}
      {toReview ? (
        <p className="m-0 text-xs text-fg-muted" data-testid="bundle-review">
          {say("bundle.toReview")}
        </p>
      ) : null}
    </section>
  );
}
