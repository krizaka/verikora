"use client";

import { krizakaFetch, useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Card } from "@krizaka/ui/card";
import { Checkbox } from "@krizaka/ui/checkbox";
import { createKrizakaForm } from "@krizaka/ui/form";
import { useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import type { LandlordView } from "@/lib/screening";

import { type ResultWords, ScreeningResultCard } from "./ScreeningResultCard";

/** A check type this owner may ask, labelled in the page's language (the labels are data, yomizaka#132). */
export interface OfferedCheck {
  key: string;
  label: string;
}

export interface LandlordWords {
  title: string;
  lead: string;
  undertakingTitle: string;
  undertaking: string;
  accept: string;
  lawfulTitle: string;
  lawful: string;
  name: string;
  email: string;
  scope: string;
  noneOffered: string;
  payer: { label: string; firm: string; owner: string; applicant: string };
  request: string;
  created: string;
  copy: string;
  listTitle: string;
  none: string;
  status: Record<string, string>;
  hidden: string;
  demo: string;
  result: ResultWords;
  error: string;
}

const form = createKrizakaForm({
  schema: z.object({ tenantName: z.string().trim().min(1).max(120), tenantEmail: z.string().trim().min(3).email().max(254), payer: z.enum(["firm", "owner", "applicant"]) }),
  defaultValues: { tenantName: "", tenantEmail: "", payer: "owner" as "firm" | "owner" | "applicant" },
});

const TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = { requested: "neutral", consented: "warning", shared: "success", declined: "neutral", contested: "danger", expired: "neutral" };

/**
 * The landlord's side: accept the undertaking once (a consent the flow requires), ask an applicant's consent, hand them the
 * link, follow the answers. The result appears only once the applicant has passed it on; « contested » shows no result.
 */
export function LandlordScreening({ initial, offered, undertakingGiven, words, locale }: Readonly<{ initial: LandlordView[]; offered: OfferedCheck[]; undertakingGiven: boolean; words: LandlordWords; locale: string }>) {
  const client = useQueryClient();
  const [given, setGiven] = useState(undertakingGiven);
  const [link, setLink] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>(() => offered.slice(0, 1).map((o) => o.key));
  const [problem, setProblem] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["screenings"], queryFn: () => krizakaFetch("/api/screenings").then((r) => (r as { screenings: LandlordView[] }).screenings), initialData: initial, enabled: given });
  const accept = useMutation({ mutationFn: () => krizakaFetch("/api/consents", { method: "POST", json: { key: "screening-landlord-undertaking" } }), onSuccess: () => setGiven(true) });
  const ask = useMutation({
    mutationFn: (body: { tenantName: string; tenantEmail: string; scope: string[]; payer: string }) => krizakaFetch("/api/screenings", { method: "POST", json: body }) as Promise<{ token: string }>,
    onSuccess: (r) => {
      setLink(`${globalThis.location.origin}/${locale}/screening/${r.token}`);
      void client.invalidateQueries({ queryKey: ["screenings"] });
    },
  });
  const f = form.useForm({
    i18n: { t: () => words.error, locale: locale as "en" | "fr" },
    onSubmit: async (v) => {
      setProblem(null);
      try {
        await ask.mutateAsync({ tenantName: v.tenantName, tenantEmail: v.tenantEmail, scope: chosen, payer: v.payer });
      } catch (error) {
        setProblem(`${words.error} (${errorKey(error)})`);
      }
    },
  });
  return (
    <div className="flex max-w-3xl flex-col gap-6" data-testid="landlord-screening">
      <div>
        <h1 className="m-0 font-display text-xl font-bold text-fg">{words.title}</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-fg-secondary">{words.lead}</p>
      </div>
      <Card.Root className="flex flex-col gap-2 p-4">
        <h2 className="m-0 font-display text-base font-bold text-fg">{words.lawfulTitle}</h2>
        <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">{words.lawful}</p>
      </Card.Root>
      {given ? (
        <>
          <f.Form aria-label={words.request} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <f.TextField name="tenantName" label={words.name} />
              <f.TextField name="tenantEmail" label={words.email} type="email" autoComplete="off" />
            </div>
            <f.Select name="payer" label={words.payer.label} options={(["firm", "owner", "applicant"] as const).map((p) => ({ value: p, label: words.payer[p] }))} />
            <fieldset className="flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-semibold text-fg">{words.scope}</legend>
              {offered.length === 0 ? <p className="m-0 text-sm text-fg-muted">{words.noneOffered}</p> : null}
              {offered.map((o) => (
                <Checkbox key={o.key} checked={chosen.includes(o.key)} onCheckedChange={(on) => setChosen((c) => (on === true ? [...new Set([...c, o.key])] : c.filter((k) => k !== o.key)))} data-testid={`check-${o.key}`}>
                  {o.label}
                </Checkbox>
              ))}
            </fieldset>
            {problem ? <Alert tone="danger">{problem}</Alert> : null}
            <f.Submit>{words.request}</f.Submit>
          </f.Form>
          {link ? (
            <Alert tone="info" title={words.created}>
              <code className="break-all font-mono text-xs" data-testid="screening-link">
                {link}
              </code>
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(link)}>
                  {words.copy}
                </Button>
              </div>
            </Alert>
          ) : null}
          <section className="flex flex-col gap-3" aria-label={words.listTitle}>
            <h2 className="m-0 font-display text-base font-bold text-fg">{words.listTitle}</h2>
            {(list.data ?? []).length === 0 ? <p className="m-0 text-sm text-fg-muted">{words.none}</p> : null}
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {(list.data ?? []).map((s) => (
                <li key={s.id} className="flex flex-col gap-2 rounded-xl border border-border-default bg-surface-1 p-3" data-testid="screening-row">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 break-all">
                      <b className="text-fg">{s.tenantName}</b> · <span className="text-fg-secondary">{s.tenantEmail}</span>
                    </span>
                    <Badge tone={TONE[s.status] ?? "neutral"}>{words.status[s.status]}</Badge>
                  </div>
                  {s.result ? <ScreeningResultCard result={s.result} words={words.result} demo={s.demo ? words.demo : null} /> : null}
                  {!s.result && s.status === "consented" ? <p className="m-0 text-xs text-fg-muted">{words.hidden}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <Card.Root className="flex flex-col gap-3 p-4">
          <h2 className="m-0 font-display text-base font-bold text-fg">{words.undertakingTitle}</h2>
          <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">{words.undertaking}</p>
          <Button loading={accept.isPending} onClick={() => accept.mutate()} data-testid="accept-undertaking">
            {words.accept}
          </Button>
        </Card.Root>
      )}
    </div>
  );
}
