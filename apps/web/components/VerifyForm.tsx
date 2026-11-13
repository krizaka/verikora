"use client";

import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Card } from "@krizaka/ui/card";
import { DescriptionList } from "@krizaka/ui/description-list";
import { createKrizakaForm } from "@krizaka/ui/form";
import { useState } from "react";
import { z } from "zod";

import { ClosingNoteView } from "@/components/ClosingNoteView";
import type { DeletionReceiptView } from "@/lib/deletion-receipt";
import type { Locale } from "@/lib/i18n";
import type { Verification } from "@/lib/report";
import type { OwnerVerificationView } from "@/lib/verify-dispatch";

/** The words of the verify page, passed from the server (members only: the page redirects a signed-out visitor to sign-in). */
export interface VerifyLabels {
  reportFile: string;
  reportPaste: string;
  documentFile: string;
  documentHint: string;
  submit: string;
  empty: string;
  tooLarge: string;
  okTitle: string;
  failTitle: string;
  reasons: Record<string, string>;
  facts: Record<
    | "fileSha"
    | "keyId"
    | "documentSha"
    | "runId"
    | "ruleset"
    | "checked"
    | "findings"
    | "jurisdiction"
    | "issued"
    | "expires",
    string
  >;
  documentMatch: Record<"yes" | "no" | "none", string>;
  receipt: {
    okTitle: string;
    deletedAt: string;
    rule: string;
    objects: string;
    none: string;
    kinds: Record<"file" | "text", string>;
    results: Record<"deleted" | "cleared", string>;
    rules: Record<string, string>;
  };
  noAccess: { title: string; text: string; request: string; requested: string };
  drop: { reportTitle: string; documentTitle: string; browse: string; remove: string; hint: string };
}

const form = createKrizakaForm({
  schema: z.object({
    reportFiles: z.array(z.instanceof(File)).max(1),
    reportText: z.string().max(2_000_000),
    documentFiles: z.array(z.instanceof(File)).max(1),
  }),
  defaultValues: { reportFiles: [] as File[], reportText: "", documentFiles: [] as File[] },
});

/** A signed-in member checks a report they own or were given access to; without a grant the answer offers « Request access ». */
export function VerifyForm({ labels, locale }: Readonly<{ labels: VerifyLabels; locale: Locale }>) {
  const [problem, setProblem] = useState<string | null>(null);
  const [denied, setDenied] = useState<{ runId: string; documentSha256: string } | null>(null);
  const [asked, setAsked] = useState(false);
  const [result, setResult] = useState<Verification | OwnerVerificationView | DeletionReceiptView | null>(null);
  const f = form.useForm({
    i18n: { t: () => labels.empty, locale },
    onSubmit: async (values) => {
      setProblem(null);
      setResult(null);
      setDenied(null);
      setAsked(false);
      if (values.reportFiles.length === 0 && !values.reportText.trim()) {
        return setProblem(labels.empty);
      }
      const body = new FormData();
      if (values.reportFiles[0]) {
        body.set("report", values.reportFiles[0]);
      } else {
        body.set("reportText", values.reportText);
      }
      if (values.documentFiles[0]) {
        body.set("document", values.documentFiles[0]);
      }
      try {
        const res = await fetch("/api/verify", { method: "POST", body });
        if (res.status === 403) {
          const refusal = (await res.json().catch(() => null)) as {
            code?: string;
            runId?: string;
            documentSha256?: string;
          } | null;
          if (refusal?.code === "NO_ACCESS" && refusal.runId && refusal.documentSha256) {
            return setDenied({ runId: refusal.runId, documentSha256: refusal.documentSha256 });
          }
        }
        if (!res.ok) {
          return setProblem(res.status === 413 ? labels.tooLarge : labels.empty);
        }
        setResult(
          ((await res.json()) as { result: Verification | OwnerVerificationView | DeletionReceiptView }).result,
        );
      } catch {
        setProblem(labels.empty);
      }
    },
  });
  return (
    <div className="flex flex-col gap-6">
      <f.Form aria-label={labels.submit} className="flex flex-col gap-4">
        <f.FileUpload
          name="reportFiles"
          label={labels.reportFile}
          title={labels.drop.reportTitle}
          browseLabel={labels.drop.browse}
          hint={labels.drop.hint}
          accept=".html,.pdf,text/html,application/pdf"
          maxSize={2 * 1024 * 1024}
          removeLabel={(name) => labels.drop.remove.replace("{name}", name)}
          refusalLabel={() => labels.tooLarge}
        />
        <f.TextArea name="reportText" label={labels.reportPaste} rows={4} />
        <f.FileUpload
          name="documentFiles"
          label={labels.documentFile}
          title={labels.drop.documentTitle}
          browseLabel={labels.drop.browse}
          hint={labels.documentHint}
          maxSize={10 * 1024 * 1024}
          removeLabel={(name) => labels.drop.remove.replace("{name}", name)}
          refusalLabel={() => labels.tooLarge}
        />
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        <f.Submit>{labels.submit}</f.Submit>
      </f.Form>
      {denied ? (
        <Alert tone="warning" title={labels.noAccess.title} data-testid="verify-no-access">
          <p>{labels.noAccess.text}</p>
          {asked ? (
            <p className="mt-2 text-sm font-semibold">{labels.noAccess.requested}</p>
          ) : (
            <Button
              className="mt-3"
              size="sm"
              onClick={async () => {
                await fetch("/api/verify/request-access", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(denied),
                }).catch(() => undefined);
                setAsked(true);
              }}
            >
              {labels.noAccess.request}
            </Button>
          )}
        </Alert>
      ) : null}
      {result ? <VerifyResult result={result} labels={labels} /> : null}
    </div>
  );
}

function VerifyResult({
  result,
  labels,
}: Readonly<{ result: Verification | OwnerVerificationView | DeletionReceiptView; labels: VerifyLabels }>) {
  if (result.ok && "kind" in result && result.kind === "deletion-receipt") {
    return <ReceiptResult result={result} labels={labels} />;
  }
  if (result.ok && "kind" in result) {
    return <OwnerResult result={result} labels={labels} />;
  }
  if (!result.ok) {
    return (
      <Alert tone="danger" title={labels.failTitle} data-testid="verify-failed">
        <p>{labels.reasons[result.reason] ?? result.reason}</p>
        <p className="mt-2 text-xs">
          {labels.facts.fileSha}: <code className="break-all font-mono">{result.fileSha256}</code>
        </p>
      </Alert>
    );
  }
  const { payload } = result;
  const match = result.documentMatch;
  let matchWords = labels.documentMatch.no;
  if (match === null) {
    matchWords = labels.documentMatch.none;
  } else if (match) {
    matchWords = labels.documentMatch.yes;
  }
  return (
    <Card.Root className="flex flex-col gap-4 p-4" data-testid="verify-ok">
      <Alert tone="success" title={labels.okTitle}>
        {matchWords}
      </Alert>
      {result.documentMatch === false ? <Alert tone="danger">{labels.documentMatch.no}</Alert> : null}
      <DescriptionList
        items={[
          {
            term: labels.facts.fileSha,
            details: <code className="break-all font-mono text-xs">{result.fileSha256}</code>,
          },
          { term: labels.facts.keyId, details: <code className="font-mono text-xs">{result.keyId}</code> },
          {
            term: labels.facts.documentSha,
            details: <code className="break-all font-mono text-xs">{payload.document.sha256}</code>,
          },
          {
            term: labels.facts.runId,
            details: <code className="break-all font-mono text-xs">{payload.check.runId}</code>,
          },
          { term: labels.facts.jurisdiction, details: `${payload.check.jurisdiction} · ${payload.check.asOf}` },
          { term: labels.facts.ruleset, details: `${payload.check.rulesetId} · ${payload.check.rulesetVersion}` },
          { term: labels.facts.checked, details: payload.check.finishedAt },
          { term: labels.facts.findings, details: <Badge tone="neutral">{payload.findings.length}</Badge> },
        ]}
      />
      {payload.note ? <ClosingNoteView note={payload.note} /> : null}
    </Card.Root>
  );
}

function OwnerResult({
  result,
  labels,
}: Readonly<{ result: Extract<OwnerVerificationView, { ok: true }>; labels: VerifyLabels }>) {
  const findings =
    Object.entries(result.summary.findings)
      .map(([verdict, n]) => `${verdict}: ${n}`)
      .join(" · ") || "0";
  return (
    <Card.Root className="flex flex-col gap-4 p-4" data-testid="verify-ok">
      <Alert tone="success" title={labels.okTitle} />
      <DescriptionList
        items={[
          {
            term: labels.facts.fileSha,
            details: <code className="break-all font-mono text-xs">{result.fileSha256}</code>,
          },
          { term: labels.facts.keyId, details: <code className="font-mono text-xs">{result.keyId}</code> },
          { term: labels.facts.issued, details: result.issuedAt },
          { term: labels.facts.expires, details: result.expiresAt },
          { term: labels.facts.findings, details: findings },
        ]}
      />
    </Card.Root>
  );
}

function ReceiptResult({
  result,
  labels,
}: Readonly<{ result: Extract<DeletionReceiptView, { ok: true }>; labels: VerifyLabels }>) {
  const r = labels.receipt;
  return (
    <Card.Root className="flex flex-col gap-4 p-4" data-testid="verify-ok">
      <Alert tone="success" title={r.okTitle} />
      <DescriptionList
        items={[
          {
            term: labels.facts.fileSha,
            details: <code className="break-all font-mono text-xs">{result.fileSha256}</code>,
          },
          { term: labels.facts.keyId, details: <code className="font-mono text-xs">{result.keyId}</code> },
          { term: r.deletedAt, details: result.deletedAt },
          { term: r.rule, details: r.rules[result.rule] ?? result.rule },
          {
            term: r.objects,
            details: result.objects.length ? (
              <ul className="m-0 list-none space-y-1 p-0">
                {result.objects.map((o) => (
                  <li key={`${o.kind}-${o.sha256}`} className="text-xs">
                    {`${r.kinds[o.kind]} · ${r.results[o.result]} · `}
                    <code className="break-all font-mono">{o.sha256}</code>
                  </li>
                ))}
              </ul>
            ) : (
              r.none
            ),
          },
        ]}
      />
    </Card.Root>
  );
}
