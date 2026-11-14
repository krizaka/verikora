"use client";

import { krizakaFetch, useMutation } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Card } from "@krizaka/ui/card";
import { Checkbox } from "@krizaka/ui/checkbox";
import { createKrizakaForm } from "@krizaka/ui/form";
import { AUDIENCES, JURISDICTIONS } from "@verikora/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import { definitionFromForm, emptyForm, type FlowFormValues } from "@/lib/flow-form";
import type { AdminFlow } from "@/lib/flows";
import { useSay } from "@/lib/i18n-client";

import { formatDate } from "../console/format";

const VERSION_TONE: Record<string, "success" | "warning" | "neutral"> = { published: "success", draft: "warning" };

const schema = z.object({
  key: z.string().trim().max(60),
  titleEn: z.string().trim().min(1).max(300),
  titleFr: z.string().trim().min(1).max(300),
  leadEn: z.string().trim().min(1).max(300),
  leadFr: z.string().trim().min(1).max(300),
  status: z.enum(["available", "soon"]),
  tenant: z.boolean(),
  landlord: z.boolean(),
  freelancer: z.boolean(),
  business: z.boolean(),
  compliance: z.boolean(),
  authenticity: z.boolean(),
  jQC: z.boolean(),
  jFR: z.boolean(),
  jBE: z.boolean(),
  rQC: z.string().trim().max(80),
  rFR: z.string().trim().max(80),
  rBE: z.string().trim().max(80),
  consents: z.string().trim().max(300),
  providers: z.string().trim().max(300),
  pricingModel: z.enum(["free", "per-run", "subscription"]),
  amount: z.string().trim().max(12),
});

const form = createKrizakaForm({
  schema,
  defaultValues: {
    key: "",
    titleEn: "",
    titleFr: "",
    leadEn: "",
    leadFr: "",
    status: "available" as "available" | "soon",
    tenant: false,
    landlord: false,
    freelancer: false,
    business: false,
    compliance: true,
    authenticity: false,
    jQC: true,
    jFR: false,
    jBE: false,
    rQC: "qc-residential-lease",
    rFR: "fr-residential-lease",
    rBE: "be-residential-lease",
    consents: "",
    providers: "",
    pricingModel: "free" as "free" | "per-run" | "subscription",
    amount: "",
  },
});
type Values = z.infer<typeof schema>;

const toFlat = (v: Values): FlowFormValues => ({
  titleEn: v.titleEn,
  titleFr: v.titleFr,
  leadEn: v.leadEn,
  leadFr: v.leadFr,
  status: v.status,
  aud: { tenant: v.tenant, landlord: v.landlord, freelancer: v.freelancer, business: v.business },
  compliance: v.compliance,
  authenticity: v.authenticity,
  jur: { QC: v.jQC, FR: v.jFR, "BE-WAL": v.jBE },
  rulesets: { QC: v.rQC, FR: v.rFR, "BE-WAL": v.rBE },
  consents: v.consents,
  providers: v.providers,
  pricingModel: v.pricingModel,
  amount: v.amount,
});

/** Creates a flow, or edits its draft; publishes it; enables it per environment. A published version is never edited. */
export function FlowEditor({ flow, initial }: Readonly<{ flow: AdminFlow | null; initial: FlowFormValues | null }>) {
  const { say, locale } = useSay();
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const draft = flow?.versions.find((v) => v.status === "draft") ?? null;
  const start = initial ?? emptyForm();
  const save = useMutation({
    mutationFn: (input: { key: string; flat: FlowFormValues }) =>
      flow
        ? krizakaFetch(`/api/admin/flows/${flow.id}/draft`, {
            method: "PUT",
            json: { definition: definitionFromForm(input.flat) },
          })
        : krizakaFetch("/api/admin/flows", {
            method: "POST",
            json: { key: input.key, definition: definitionFromForm(input.flat) },
          }),
  });
  const publish = useMutation({
    mutationFn: (versionId: string) =>
      krizakaFetch(`/api/admin/flows/${flow!.id}/publish`, { method: "POST", json: { versionId } }),
  });
  const env = useMutation({
    mutationFn: (b: { environment: "dev" | "prod"; enabled: boolean }) =>
      krizakaFetch(`/api/admin/flows/${flow!.id}/environments`, { method: "PUT", json: b }),
  });
  const f = form.useForm({
    i18n: { t: (k, vars) => say(k, vars as Record<string, string | number> | undefined), locale },
    defaultValues: {
      key: flow?.key ?? "",
      titleEn: start.titleEn,
      titleFr: start.titleFr,
      leadEn: start.leadEn,
      leadFr: start.leadFr,
      status: start.status,
      tenant: start.aud.tenant,
      landlord: start.aud.landlord,
      freelancer: start.aud.freelancer,
      business: start.aud.business,
      compliance: start.compliance,
      authenticity: start.authenticity,
      jQC: start.jur.QC,
      jFR: start.jur.FR,
      jBE: start.jur["BE-WAL"],
      rQC: start.rulesets.QC,
      rFR: start.rulesets.FR,
      rBE: start.rulesets["BE-WAL"],
      consents: start.consents,
      providers: start.providers,
      pricingModel: start.pricingModel,
      amount: start.amount,
    },
    onSubmit: async (values) => {
      setProblem(null);
      setNotice(null);
      try {
        const done = await save.mutateAsync({ key: values.key, flat: toFlat(values) });
        setNotice(say("adminConsole.flows.editor.saved"));
        if (!flow) router.replace(`/${locale}/flows/${(done as { id: string }).id}`);
        else router.refresh();
      } catch (error) {
        setProblem(say(`errors.${errorKey(error)}`));
      }
    },
  });
  const t = (k: string) => say(`adminConsole.flows.editor.${k}`);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <f.Form aria-label={flow ? flow.key : t("create")} className="flex flex-col gap-4">
        {flow ? null : <f.TextField name="key" label={t("key")} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <f.TextField name="titleEn" label={t("titleEn")} />
          <f.TextField name="titleFr" label={t("titleFr")} />
          <f.TextField name="leadEn" label={t("leadEn")} />
          <f.TextField name="leadFr" label={t("leadFr")} />
        </div>
        <f.Select
          name="status"
          label={t("status")}
          options={[
            { value: "available", label: say("adminConsole.flows.status.available") },
            { value: "soon", label: say("adminConsole.flows.status.soon") },
          ]}
        />
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold text-fg">{t("audiences")}</legend>
          {AUDIENCES.map((a) => (
            <f.Checkbox key={a} name={a} label={t(a)} />
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold text-fg">{t("studios")}</legend>
          <f.Checkbox name="compliance" label={t("compliance")} />
          <f.Checkbox name="authenticity" label={t("authenticity")} />
        </fieldset>
        <fieldset className="grid gap-2 border-0 p-0 sm:grid-cols-3">
          <legend className="mb-1 text-sm font-semibold text-fg">{t("jurisdictions")}</legend>
          {JURISDICTIONS.map((j) => {
            const k = j === "BE-WAL" ? "BE" : j;
            return (
              <div key={j} className="flex flex-col gap-1">
                <f.Checkbox name={`j${k}` as "jQC"} label={j} />
                <f.TextField name={`r${k}` as "rQC"} label={`${j} · rulesets (comma-separated)`} />
              </div>
            );
          })}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <f.TextField name="consents" label={t("consents")} />
          <f.TextField name="providers" label={t("providers")} />
          <f.Select
            name="pricingModel"
            label={t("pricingModel")}
            options={[
              { value: "free", label: say("adminConsole.flows.models.free") },
              { value: "per-run", label: say("adminConsole.flows.models.perRun") },
              { value: "subscription", label: say("adminConsole.flows.models.subscription") },
            ]}
          />
          <f.TextField name="amount" label={t("amount")} />
        </div>
        <p className="m-0 text-xs text-fg-muted">{t("draftHint")}</p>
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        <f.Submit>{flow ? t("save") : t("create")}</f.Submit>
      </f.Form>

      {flow ? (
        <>
          <Card.Root className="flex flex-col gap-3 p-4">
            <h2 className="font-display text-base font-bold text-fg">{t("environments")}</h2>
            {(["dev", "prod"] as const).map((e) => (
              <Checkbox
                key={e}
                className="min-h-11"
                checked={flow.environments[e]}
                onCheckedChange={(on) =>
                  env.mutate({ environment: e, enabled: on === true }, { onSuccess: () => router.refresh() })
                }
                data-testid={`env-${e}`}
              >
                {say("adminConsole.flows.editor.enabledIn").replace("{env}", e)}
              </Checkbox>
            ))}
          </Card.Root>
          <Card.Root className="flex flex-col gap-3 p-4">
            <h2 className="font-display text-base font-bold text-fg">{t("versions")}</h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {flow.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-secondary">
                  <span className="flex items-center gap-2">
                    <b className="text-fg">v{v.version}</b>
                    <Badge tone={VERSION_TONE[v.status] ?? "neutral"}>
                      {say(`adminConsole.flows.versionStatus.${v.status}`)}
                    </Badge>
                    {v.publishedAt ? formatDate(v.publishedAt, locale, true) : null}
                  </span>
                  {v.status === "draft" ? (
                    <Button
                      size="sm"
                      loading={publish.isPending}
                      onClick={() =>
                        publish.mutate(v.id, {
                          onSuccess: () => {
                            setNotice(t("published"));
                            router.refresh();
                          },
                        })
                      }
                    >
                      {t("publish")}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {draft ? null : <p className="m-0 text-xs text-fg-muted">{t("noDraft")}</p>}
          </Card.Root>
        </>
      ) : null}
    </div>
  );
}
