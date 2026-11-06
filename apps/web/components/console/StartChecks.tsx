"use client";

import { localDay } from "@krizaka/intl";
import { krizakaFetch, useMutation, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { Card } from "@krizaka/ui/card";
import { Dialog } from "@krizaka/ui/dialog";
import { createKrizakaForm } from "@krizaka/ui/form";
import {
  type Audience,
  AUTHENTICITY_MAX_BYTES,
  type DocumentView,
  type Jurisdiction,
  JURISDICTIONS,
  queryKeys,
  type Studio,
} from "@verikora/core";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { Paywall } from "@/components/console/Paywall";
import { planCheck, rulesFor } from "@/lib/check-flow";
import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";
import { firstCheck } from "@/lib/perspective-defaults";
import { CHECK_KINDS, type CheckKind, isCheckKind, LAW_TIME_ZONE } from "@/lib/rulesets";

import { PhotoOriginSignals } from "./AuthenticitySignals";
import { complianceOptions, offeredKinds } from "./document-view-model";

const compliance = createKrizakaForm({
  schema: z.object({
    documentType: z.enum(CHECK_KINDS),
    jurisdiction: z.enum(JURISDICTIONS),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  defaultValues: {
    documentType: "lease" as CheckKind,
    jurisdiction: "QC" as (typeof JURISDICTIONS)[number],
    asOf: localDay(new Date(), LAW_TIME_ZONE),
  },
});
const authenticity = createKrizakaForm({
  schema: z.object({ expectedIssuer: z.string().trim().max(120) }),
  defaultValues: { expectedIssuer: "" },
});

/** The compliance form: the kinds offered (a lease always), the one preselected, and the request built by the kind's ruleset in force (`rulesFor`). */
function StartCompliance({
  documentId,
  disabled,
  jurisdictions,
  options,
  initialType,
}: Readonly<{
  documentId: string;
  disabled: boolean;
  initialType: CheckKind;
  jurisdictions: readonly (typeof JURISDICTIONS)[number][];
  options: readonly CheckKind[];
}>) {
  const { say, locale } = useSay();
  const client = useQueryClient();
  const [reused, setReused] = useState(false);
  // A check the task page tried to start on the drop and the engine refused arrives as `?refused=<code>`: said here, above the form.
  const refused = useSearchParams()?.get("refused") ?? null;
  const [problem, setProblem] = useState<string | null>(
    refused && refused !== "PAYWALL" && refused !== "FAIR_USE" ? say(`errors.${refused}`) : null,
  );
  const [paywall, setPaywall] = useState<"PAYWALL" | "FAIR_USE" | null>(
    refused === "PAYWALL" || refused === "FAIR_USE" ? refused : null,
  );
  const start = useMutation({
    // The request is the kind's ruleset in force on the check's date (lib/check-flow `rulesFor`): never a lease's rules for another kind.
    mutationFn: (body: { documentType: CheckKind; jurisdiction: string; asOf: string }) => {
      const request = rulesFor(body.documentType, body.jurisdiction as (typeof JURISDICTIONS)[number], body.asOf);
      if (!request) throw new Error("KIND_NOT_VERIFIED");
      return krizakaFetch(`/api/documents/${documentId}`, { method: "POST", json: request });
    },
    onSuccess: (data) => {
      setReused(Boolean((data as { reused?: boolean } | null)?.reused));
      return client.invalidateQueries({ queryKey: queryKeys.document(documentId) });
    },
  });
  const form = compliance.useForm({
    defaultValues: { documentType: initialType, jurisdiction: "QC", asOf: localDay(new Date(), LAW_TIME_ZONE) },
    i18n: { t: (key, vars) => say(key, vars as Record<string, string | number> | undefined), locale },
    onSubmit: async (values) => {
      setProblem(null);
      if (!rulesFor(values.documentType, values.jurisdiction, values.asOf))
        return setProblem(say("analysis.notVerified"));
      try {
        await start.mutateAsync(values);
      } catch (error) {
        const code = errorKey(error);
        if (code === "PAYWALL" || code === "FAIR_USE") setPaywall(code);
        else setProblem(say(`errors.${code}`));
      }
    },
  });
  return (
    <form.Form aria-label={say("analysis.complianceTitle")} className="flex flex-col gap-3">
      <p className="text-sm text-fg-secondary">{say("analysis.complianceText")}</p>
      {options.length > 1 ? (
        <form.Select
          name="documentType"
          label={say("analysis.documentType")}
          options={options.map((k) => ({ value: k, label: say(`analysis.documentTypes.${k}`) }))}
        />
      ) : null}
      {/* The rules derive from the kind chosen now (the review's C5): Québec's named rulesets for an invoice or a contract, said in one line; a lease keeps its jurisdiction menu. */}
      <form.Field name="documentType">
        {(field) =>
          field.value !== "lease" ? (
            <p className="m-0 text-sm text-fg-secondary" data-testid="rules-line">
              {say("analysis.rulesLine", { kind: say(`analysis.kindWords.${String(field.value)}`) })}
            </p>
          ) : (
            <form.Select
              name="jurisdiction"
              label={say("analysis.jurisdiction")}
              options={jurisdictions.map((j) => ({ value: j, label: say(`analysis.jurisdictions.${j}`) }))}
            />
          )
        }
      </form.Field>
      <form.DateField name="asOf" label={say("analysis.asOf")} />
      {paywall ? <Paywall reason={paywall} /> : null}
      {reused ? <Alert tone="info">{say("analysis.reused")}</Alert> : null}
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <form.Submit disabled={disabled}>{say("analysis.run")}</form.Submit>
    </form.Form>
  );
}

function StartAuthenticity({ documentId, disabled }: Readonly<{ documentId: string; disabled: boolean }>) {
  const { say, locale } = useSay();
  const client = useQueryClient();
  const [reused, setReused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<"PAYWALL" | "FAIR_USE" | null>(null);
  const start = useMutation({
    mutationFn: (body: { expectedIssuer: string }) =>
      krizakaFetch(`/api/documents/${documentId}`, {
        method: "POST",
        json: {
          studio: "document-authenticity",
          ...(body.expectedIssuer ? { expectedIssuer: body.expectedIssuer } : {}),
        },
      }),
    onSuccess: (data) => {
      setReused(Boolean((data as { reused?: boolean } | null)?.reused));
      return client.invalidateQueries({ queryKey: queryKeys.document(documentId) });
    },
  });
  const form = authenticity.useForm({
    i18n: { t: (key, vars) => say(key, vars as Record<string, string | number> | undefined), locale },
    onSubmit: async (values) => {
      setProblem(null);
      try {
        await start.mutateAsync(values);
      } catch (error) {
        const code = errorKey(error);
        if (code === "PAYWALL" || code === "FAIR_USE") setPaywall(code);
        else setProblem(say(`errors.${code}`));
      }
    },
  });
  return (
    <form.Form aria-label={say("analysis.authenticityTitle")} className="flex flex-col gap-3">
      <p className="text-sm text-fg-secondary">{say("analysis.authenticityText")}</p>
      <form.TextField
        name="expectedIssuer"
        label={say("analysis.expectedIssuer")}
        hint={say("analysis.expectedIssuerHint")}
      />
      {paywall ? <Paywall reason={paywall} /> : null}
      {reused ? <Alert tone="info">{say("analysis.reused")}</Alert> : null}
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <form.Submit variant="secondary" disabled={disabled}>
        {say("analysis.run")}
      </form.Submit>
    </form.Form>
  );
}

type StartProps = {
  doc: DocumentView;
  perspective: Audience | null;
  offer: { studios: readonly Studio[]; jurisdictions: readonly Jurisdiction[]; rulesets: readonly string[] };
  examinable: boolean;
  running: (studio: Studio) => boolean;
};

/** The Studios a document can start, in the order the person's perspective puts first, only those their flows offer. */
export function startableStudios(
  perspective: Audience | null,
  doc: Pick<DocumentView, "kind">,
  offered: readonly Studio[],
): Studio[] {
  const order: Studio[] =
    firstCheck(perspective, doc.kind) === "compliance-check"
      ? ["compliance-check", "document-authenticity"]
      : ["document-authenticity", "compliance-check"];
  return order.filter((s) => offered.includes(s));
}

function AuthenticityBody({ doc, examinable, running }: Readonly<Pick<StartProps, "doc" | "examinable" | "running">>) {
  const { say } = useSay();
  if (doc.textSource) return <PhotoOriginSignals source={doc.textSource} />;
  if (!examinable) return <Alert tone="info">{say("analysis.noPdf")}</Alert>;
  if (doc.sizeBytes > AUTHENTICITY_MAX_BYTES) return <Alert tone="info">{say("analysis.tooLarge")}</Alert>;
  return <StartAuthenticity documentId={doc.id} disabled={running("document-authenticity")} />;
}

function ComplianceBody({ doc, offer, running }: Readonly<Pick<StartProps, "doc" | "offer" | "running">>) {
  const { say } = useSay();
  const detectedKind = doc.insight?.understanding.check?.documentType ?? null;
  const compliancePlan = planCheck({
    declared: doc.kind,
    detected: detectedKind,
    asOf: localDay(new Date(), LAW_TIME_ZONE),
  });
  const options = complianceOptions(compliancePlan.mismatch, offeredKinds(offer.rulesets), doc.kind);
  if (doc.insight?.understanding.nature && !doc.insight.understanding.check)
    return <Alert tone="info">{say("insight.noCheck")}</Alert>;
  if (!doc.hasText) return <Alert tone="info">{say("document.noText")}</Alert>;
  if (compliancePlan.unsupported) return <Alert tone="info">{say("analysis.notVerified")}</Alert>;
  return (
    <>
      {compliancePlan.mismatch ? (
        <Alert tone="warning">
          {say("analysis.mismatch", {
            declared: say(`kinds.${compliancePlan.mismatch.declared}`),
            detected: say(`analysis.kindWords.${compliancePlan.mismatch.detected}`),
          })}
        </Alert>
      ) : null}
      <StartCompliance
        documentId={doc.id}
        initialType={isCheckKind(doc.kind) ? doc.kind : (detectedKind ?? "lease")}
        disabled={running("compliance-check")}
        jurisdictions={offer.jurisdictions}
        options={options}
      />
    </>
  );
}

/** What starting one check holds: the compliance form (the kind declared and the one Verikora read select the ruleset, ADR-089; a mismatch is shown and confirmed in the form) or the authenticity form — or why it cannot run. */
function StartBody({ studio, doc, offer, examinable, running }: StartProps & { studio: Studio }) {
  if (studio === "document-authenticity")
    return <AuthenticityBody doc={doc} examinable={examinable} running={running} />;
  return <ComplianceBody doc={doc} offer={offer} running={running} />;
}

const TITLE: Record<Studio, string> = {
  "compliance-check": "analysis.complianceTitle",
  "document-authenticity": "analysis.authenticityTitle",
};

/** The checks a document can start, each a card, for a document not checked yet: the checks are what the page is for. */
export function StartCards(props: Readonly<StartProps>) {
  const { say } = useSay();
  return (
    <>
      {startableStudios(props.perspective, props.doc, props.offer.studios).map((studio) => (
        <Card.Root key={studio} className="p-4">
          <h3 className="mb-2 font-display text-base font-bold text-fg">{say(TITLE[studio])}</h3>
          <StartBody {...props} studio={studio} />
        </Card.Root>
      ))}
    </>
  );
}

/**
 * Once a report exists, the other checks are actions of the aside (design § 5.3): « Revérifier à une autre date » and « Examiner
 * le fichier (authenticité) », each opening its form in a dialog — the report no longer ends in forms. A check the task page could
 * not start (`?refused=`) opens its dialog at once, so the refusal is read where it is answered.
 */
export function StartCheckActions({ done, ...props }: StartProps & { done: readonly Studio[] }) {
  const { say } = useSay();
  const refused = useSearchParams()?.get("refused") ?? null;
  const label = (studio: Studio) => {
    if (studio === "document-authenticity") return say("reportFace.examine");
    return done.includes(studio) ? say("reportFace.recheck") : say("reportFace.checkLaw");
  };
  return (
    <section aria-labelledby="other-checks-title" className="flex flex-col gap-2" data-testid="other-checks">
      <h2 id="other-checks-title" className="m-0 text-base font-bold text-fg">
        {say("reportFace.otherChecks")}
      </h2>
      {startableStudios(props.perspective, props.doc, props.offer.studios).map((studio) => (
        <Dialog.Root key={studio} defaultOpen={studio === "compliance-check" && !!refused}>
          <Dialog.Trigger asChild>
            <Button variant="secondary" className="justify-start">
              {label(studio)}
            </Button>
          </Dialog.Trigger>
          <Dialog.Content closeLabel={say("reportFace.close")}>
            <Dialog.Header>
              <Dialog.Title>{label(studio)}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <StartBody {...props} studio={studio} />
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Root>
      ))}
    </section>
  );
}
