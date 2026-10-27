"use client";

import { krizakaFetch, useMutation, useQuery } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { Dialog } from "@krizaka/ui/dialog";
import { createKrizakaForm } from "@krizaka/ui/form";
import { SettingsRow, SettingsSection } from "@krizaka/ui/settings-layout";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import { formI18n } from "@/lib/form-i18n";
import { useSay } from "@/lib/i18n-client";
import { DEFAULT_SUBSCRIPTION, SOLD, type SoldKind } from "@/lib/pricing";

type Say = (key: string, vars?: Record<string, string | number>) => string;

function useCall<T>(run: (input: T) => Promise<unknown>) {
  const { say } = useSay();
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const m = useMutation({ mutationFn: run });
  return {
    problem,
    done,
    pending: m.isPending,
    go: async (input: T, then?: () => void) => {
      setProblem(null);
      setDone(false);
      try {
        await m.mutateAsync(input);
        setDone(true);
        if (then) then();
        else router.refresh();
      } catch (error) {
        setProblem(say(`errors.${errorKey(error)}`));
      }
    },
  };
}

// ── security ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const emailForm = createKrizakaForm({ schema: z.object({ newEmail: z.string().trim().min(1).email(), password: z.string().min(1) }), defaultValues: { newEmail: "", password: "" } });
const passwordForm = createKrizakaForm({ schema: z.object({ current: z.string().min(1), next: z.string().min(12).max(256) }), defaultValues: { current: "", next: "" } });

/** The address (changed by a link mailed to the new one) and the password: two sections, each with its own save. */
export function SecuritySection({ email, pendingEmail, notice }: { email: string; pendingEmail: string | null; notice: "changed" | "invalid" | null }) {
  const { say, locale } = useSay();
  const mail = useCall<{ newEmail: string; password: string }>((body) => krizakaFetch("/api/me/email", { method: "POST", json: body }));
  const pass = useCall<{ current: string; next: string }>((body) => krizakaFetch("/api/me/password", { method: "PUT", json: body }));
  const emailF = emailForm.useForm({ ...formI18n(say, locale), onSubmit: (v) => mail.go(v) });
  const passF = passwordForm.useForm({ ...formI18n(say, locale), onSubmit: (v) => pass.go(v) });
  return (
    <div className="flex flex-col gap-10" data-testid="settings-securite">
      {notice ? <Alert tone={notice === "changed" ? "success" : "danger"}>{say(notice === "changed" ? "settings.security.emailChanged" : "settings.security.emailInvalid")}</Alert> : null}
      <SettingsSection variant="flat" title={say("settings.security.emailTitle")} description={say("settings.security.emailCurrent", { email })}>
        {pendingEmail ? <Alert tone="info">{say("settings.security.emailPending", { email: pendingEmail })}</Alert> : null}
        <emailF.Form aria-label={say("settings.security.emailTitle")} className="flex flex-col gap-3">
          <emailF.TextField name="newEmail" label={say("settings.security.newEmail")} type="email" autoComplete="email" />
          <emailF.TextField name="password" label={say("settings.security.password")} type="password" autoComplete="current-password" />
          {mail.problem ? <Alert tone="danger">{mail.problem}</Alert> : null}
          {mail.done ? <Alert tone="success">{say("settings.security.emailSent")}</Alert> : null}
          <div>
            <emailF.Submit size="md">{say("settings.security.emailSend")}</emailF.Submit>
          </div>
        </emailF.Form>
      </SettingsSection>
      <SettingsSection variant="flat" title={say("settings.security.passwordTitle")}>
        <passF.Form aria-label={say("settings.security.passwordTitle")} className="flex flex-col gap-3">
          <passF.TextField name="current" label={say("settings.security.current")} type="password" autoComplete="current-password" />
          <passF.TextField name="next" label={say("settings.security.next")} type="password" autoComplete="new-password" />
          {pass.problem ? <Alert tone="danger">{pass.problem}</Alert> : null}
          {pass.done ? <Alert tone="success">{say("settings.security.passwordChanged")}</Alert> : null}
          <div>
            <passF.Submit size="md">{say("settings.security.passwordSave")}</passF.Submit>
          </div>
        </passF.Form>
      </SettingsSection>
    </div>
  );
}

// ── billing ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const billing = z.object({
  entitlement: z.object({ credits: z.number(), pro: z.boolean(), proUntil: z.string().nullable(), freeAuditUsed: z.boolean(), selfServe: z.boolean(), hasCustomer: z.boolean(), planKey: z.string().nullable() }),
  paymentsOn: z.boolean(),
  paymentsDisplay: z.string().optional(),
});
const redirect = z.object({ url: z.string().url() });
export type Entitlement = z.infer<typeof billing>["entitlement"];

/** The subscription's plan, named by its catalogue entry (one sold before the catalogue is on the default plan). */
const planOf = (e: Entitlement) => (e.planKey === SOLD.firm.key ? "firm" : DEFAULT_SUBSCRIPTION);

/** The plan as flat rows (the review's E3): the plan, the free audit, the paid audits left, the renewal — each a label and a value. */
export function billingRows(e: Entitlement, say: Say, date: (iso: string) => string): { id: string; label: string; value: string }[] {
  return [
    { id: "plan", label: say("settings.billing.plan"), value: say(e.pro ? `settings.billing.plans.${planOf(e)}` : "settings.billing.planFree") },
    ...(e.selfServe ? [{ id: "free", label: say("settings.billing.freeAudit"), value: say(e.freeAuditUsed ? "settings.billing.freeUsed" : "settings.billing.freeAvailable") }] : []),
    { id: "credits", label: say("settings.billing.creditsLabel"), value: String(e.credits) },
    ...(e.pro && e.proUntil ? [{ id: "until", label: say("settings.billing.renewal"), value: date(e.proUntil) }] : []),
  ];
}

type Call<T> = { pending: boolean; go: (input: T, then?: () => void) => void | Promise<void> };

/** The billing section's buttons (behaviour unchanged): the offers while the plan is free, then the portal once a customer exists. */
export function BillingActions({ entitlement: e, buy, portal, say }: Readonly<{ entitlement: Entitlement | undefined; buy: Call<SoldKind>; portal: Call<null>; say: Say }>) {
  const free = !!e && !e.pro;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {free ? (
        <>
          <Button size="md" variant="primary" shape="cut" loading={buy.pending} onClick={() => buy.go("agency", () => undefined)}>
            {say("paywall.agency")}
          </Button>
          <Button size="md" variant="secondary" loading={buy.pending} onClick={() => buy.go("firm", () => undefined)}>
            {say("paywall.firm")}
          </Button>
          <Button size="md" variant="secondary" loading={buy.pending} onClick={() => buy.go("document", () => undefined)}>
            {say("paywall.payOne")}
          </Button>
        </>
      ) : null}
      {e?.hasCustomer ? (
        <Button size="md" variant="ghost" loading={portal.pending} onClick={() => portal.go(null, () => undefined)}>
          {say("settings.billing.portal")}
        </Button>
      ) : null}
    </div>
  );
}

/** The plan and its billing: the rows, then one primary (« Passer à Pro »), the audit, and the portal (subscription, payment method, invoices). */
export function BillingSection() {
  const { say, locale } = useSay();
  const info = useQuery({ queryKey: ["billing-settings"], queryFn: () => krizakaFetch("/api/billing", { schema: billing }) });
  const portal = useCall<null>(async () => globalThis.location.assign((await krizakaFetch("/api/billing/portal", { method: "POST", schema: redirect })).url));
  const buy = useCall<SoldKind>(async (kind) => globalThis.location.assign((await krizakaFetch("/api/billing/checkout", { method: "POST", json: { kind }, schema: redirect })).url));
  const e = info.data?.entitlement;
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(iso));
  return (
    <SettingsSection
      variant="flat"
      title={say("settings.billing.title")}
      description={say("settings.billing.portalHint")}
      data-testid="settings-facturation"
      footer={info.data?.paymentsOn ? <BillingActions entitlement={e} buy={buy} portal={portal} say={say} /> : null}
    >
      {e
        ? billingRows(e, say, date).map((row) => (
            <SettingsRow key={row.id} label={row.label}>
              <span className="text-sm font-semibold text-fg" data-testid={row.id === "plan" ? "plan-name" : undefined}>
                {row.value}
              </span>
            </SettingsRow>
          ))
        : null}
      {info.data && !info.data.paymentsOn ? <Alert tone="info">{say("settings.billing.off")}</Alert> : null}
      {info.data?.paymentsOn && info.data.paymentsDisplay === "test" ? <Alert tone="warning">{say("settings.billing.testMode")}</Alert> : null}
      {portal.problem || buy.problem ? <Alert tone="danger">{portal.problem ?? buy.problem}</Alert> : null}
    </SettingsSection>
  );
}

// ── my data ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const deleteForm = createKrizakaForm({ schema: z.object({ email: z.string().trim().min(1), password: z.string().min(1) }), defaultValues: { email: "", password: "" } });

/** Loi 25: access (export) and erasure, two rows with their action. The erasure asks for the e-mail address and the password. */
export function DataSection() {
  const { say, locale } = useSay();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const erase = useCall<{ email: string; password: string }>((body) => krizakaFetch("/api/me/delete", { method: "POST", json: body }));
  const form = deleteForm.useForm({ ...formI18n(say, locale), onSubmit: (v) => erase.go(v, () => router.replace(`/${locale}`)) });
  return (
    <SettingsSection variant="flat" title={say("settings.tabs.donnees")} data-testid="settings-donnees">
      <SettingsRow label={say("settings.data.exportTitle")} description={say("settings.data.exportText")}>
        <Button asChild size="md" variant="secondary">
          <a href="/api/me/export" download data-testid="export-link">
            {say("settings.data.exportButton")}
          </a>
        </Button>
      </SettingsRow>
      <SettingsRow label={say("settings.data.deleteTitle")} description={say("settings.data.deleteText")}>
        <Button size="md" variant="danger" onClick={() => setOpen(true)}>
          {say("settings.data.deleteOpen")}
        </Button>
      </SettingsRow>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Content closeLabel={say("organisation.cancel")}>
          <Dialog.Header>
            <Dialog.Title>{say("settings.data.deleteTitle")}</Dialog.Title>
            <Dialog.Description>{say("settings.data.deleteText")}</Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            <form.Form aria-label={say("settings.data.deleteTitle")} className="flex flex-col gap-3">
              <form.TextField name="email" label={say("settings.data.deleteEmail")} type="email" autoComplete="off" />
              <form.TextField name="password" label={say("settings.data.deletePassword")} type="password" autoComplete="current-password" />
              {erase.problem ? <Alert tone="danger">{erase.problem}</Alert> : null}
              <form.Submit size="md" variant="danger">
                {say("settings.data.deleteButton")}
              </form.Submit>
            </form.Form>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </SettingsSection>
  );
}
