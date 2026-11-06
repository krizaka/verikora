import { PageHeader } from "@krizaka/ui/page-header";
import type { Metadata } from "next";

import { VerifyForm, type VerifyLabels } from "@/components/VerifyForm";
import { asLocale, getDictionary } from "@/lib/i18n";
import { publicKeyBase64 } from "@/lib/report-key";
import { signingKey } from "@/lib/report-signer";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return { title: getDictionary(asLocale((await params).locale)).verify.title };
}

/**
 * Members only (ADR-0002), inside the signed-in space (`/app/verifications/report`, the old `/verify`, verikora#389): a
 * member checks a report they own or were given access to — what a green result guarantees, what it does not, and the
 * public key. The space's layout holds the session: no session, no page.
 */
export default async function Verify({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const t = getDictionary(locale);
  const v = t.verify;
  const key = signingKey();
  const labels: VerifyLabels = {
    reportFile: v.reportFile,
    reportPaste: v.reportPaste,
    documentFile: v.documentFile,
    documentHint: v.documentHint,
    submit: v.submit,
    empty: v.empty,
    tooLarge: v.tooLarge,
    okTitle: v.okTitle,
    failTitle: v.failTitle,
    reasons: v.reasons,
    facts: v.facts,
    documentMatch: v.documentMatch,
    noAccess: v.noAccess,
    drop: v.drop,
  };
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={v.title} description={v.lead} />
      <div className="max-w-3xl">
        <VerifyForm labels={labels} locale={locale} />
      </div>
      <div className="grid gap-8 border-t border-border-default pt-8 md:grid-cols-2">
        <section>
          <h2 className="text-lg font-semibold">{v.guaranteesTitle}</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-fg-secondary">
            {Object.values(v.guarantees).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="text-lg font-semibold">{v.limitsTitle}</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-fg-secondary">
            {Object.values(v.limits).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </div>
      <section className="border-t border-border-default pt-8">
        <h2 className="text-lg font-semibold">{v.keyTitle}</h2>
        <p className="mt-1 max-w-3xl text-sm text-fg-secondary">{v.keyLead}</p>
        <p className="mt-3 text-xs text-fg-secondary" data-testid="key-id">
          <code className="font-mono">{key.keyId}</code>
        </p>
        <pre
          className="mt-2 max-w-3xl overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border-default bg-surface-1 p-3 font-mono text-xs text-fg-secondary"
          data-testid="public-key"
        >
          {publicKeyBase64(key)}
        </pre>
        {key.keyId.startsWith("dev:") ? <p className="mt-2 text-sm text-fg-secondary">{v.devKey}</p> : null}
      </section>
    </div>
  );
}
