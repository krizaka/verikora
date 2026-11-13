"use client";

import type { Coupon, Partner, PartnerRow, Redemption } from "@krizaka/coupons";
import { localDay } from "@krizaka/intl/date";
import { krizakaFetch, useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { DataTable, type DataTableColumn } from "@krizaka/ui/data-table";
import { createKrizakaForm } from "@krizaka/ui/form";
import { useMemo, useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import { PILOT_STAGE, type PilotCodeCounts } from "@/lib/coupons/pilot-stages";
import {
  COUPON_CURRENCY,
  type CouponForm,
  couponFormSchema,
  couponPayload,
  type CouponState,
  DISCOUNT_TYPE,
  emptyCouponForm,
  stateOf,
} from "@/lib/coupons/form";
import { formI18n } from "@/lib/form-i18n";
import { useSay } from "@/lib/i18n-client";

import { DISPLAY_TIME_ZONE, formatDate } from "../console/format";

type Say = ReturnType<typeof useSay>["say"];
type Lang = ReturnType<typeof useSay>["locale"];

const TONE: Record<CouponState, "success" | "warning" | "neutral" | "accent"> = {
  active: "success",
  paused: "warning",
  archived: "neutral",
  notStarted: "accent",
  expired: "neutral",
};

const list = z.object({ enabled: z.boolean(), coupons: z.array(z.custom<Coupon>()) });
const partners = z.object({ partners: z.array(z.custom<Partner>()) });
const detail = z.object({ coupon: z.custom<Coupon>(), redemptions: z.array(z.custom<Redemption>()) });
const pilotCounts = z.object({ codes: z.array(z.custom<PilotCodeCounts>()) });
const report = z.object({ partner: z.custom<Partner>(), rows: z.array(z.custom<PartnerRow>()) });

/** Today's day in the product's calendar (the form's first day). */
const today = () => localDay(new Date(), DISPLAY_TIME_ZONE);

const couponForm = createKrizakaForm({ schema: couponFormSchema, defaultValues: emptyCouponForm(today()) });
const partnerForm = createKrizakaForm({
  schema: z.object({ displayName: z.string().trim().min(1).max(80), contactEmail: z.string().trim().max(200) }),
  defaultValues: { displayName: "", contactEmail: "" },
});

/**
 * The coupons of the product (ADR-002, verikora#262): create a discount or a credit code with its window and limits, pause or archive it, see who used it and what it
 * brought, and manage the people who sell with it. The terms are locked once a code has been used. A credit code always has a cap or an expiry: the form asks for both.
 */
export function CouponsView() {
  const { say } = useSay();
  const [open, setOpen] = useState<string | null>(null);
  const [partnerOpen, setPartnerOpen] = useState<string | null>(null);
  const data = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: () => krizakaFetch("/api/admin/coupons?limit=200", { schema: list }),
  });
  const people = useQuery({
    queryKey: ["admin-coupon-partners"],
    queryFn: () => krizakaFetch("/api/admin/coupons/partners", { schema: partners }),
  });
  const pilots = useQuery({
    queryKey: ["admin-pilot-counters"],
    queryFn: () => krizakaFetch("/api/admin/coupons/pilot-counters", { schema: pilotCounts }),
  });
  if (!data.data) return null;
  return (
    <div className="flex flex-col gap-8" data-testid="coupons">
      <div className="flex flex-col gap-2">
        <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">{say("adminConfig.coupons.lead")}</p>
        {data.data.enabled ? null : <Alert tone="warning">{say("adminConfig.coupons.off")}</Alert>}
      </div>
      <NewCoupon partners={people.data?.partners ?? []} />
      <CouponTable coupons={data.data.coupons} partners={people.data?.partners ?? []} onOpen={setOpen} />
      <PilotCounters codes={pilots.data?.codes ?? []} />
      {open ? <Redemptions id={open} onClose={() => setOpen(null)} /> : null}
      <Partners partners={people.data?.partners ?? []} onOpen={setPartnerOpen} />
      {partnerOpen ? <PartnerReport id={partnerOpen} onClose={() => setPartnerOpen(null)} /> : null}
    </div>
  );
}

function useRefresh() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["admin-coupons"] }),
      client.invalidateQueries({ queryKey: ["admin-coupon-partners"] }),
      client.invalidateQueries({ queryKey: ["admin-pilot-counters"] }),
    ]);
}

function NewCoupon({ partners: people }: Readonly<{ partners: Partner[] }>) {
  const { say, locale } = useSay();
  const refresh = useRefresh();
  const [shown, setShown] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const generate = useMutation({
    mutationFn: () => krizakaFetch("/api/admin/coupons/code", { schema: z.object({ code: z.string() }) }),
    onSuccess: ({ code }) => form.setValue("code", code),
    onError: (error) => setProblem(say(`errors.${errorKey(error)}`)),
  });
  const form = couponForm.useForm({
    ...formI18n(say, locale),
    defaultValues: emptyCouponForm(today()),
    onSubmit: async (values: CouponForm) => {
      setProblem(null);
      try {
        await krizakaFetch("/api/admin/coupons", { method: "POST", json: couponPayload(values) });
      } catch (error) {
        setProblem(say(`errors.${errorKey(error)}`));
        throw error;
      }
      await refresh();
      setShown(false);
    },
  });
  const choices = (prefix: string, values: readonly string[]) =>
    values.map((value) => ({ value, label: say(`adminConfig.coupons.${prefix}.${value}`) }));
  if (!shown) {
    return (
      <div>
        <Button variant="secondary" size="md" onClick={() => setShown(true)}>
          {say("adminConfig.coupons.new")}
        </Button>
      </div>
    );
  }
  return (
    <section aria-label={say("adminConfig.coupons.new")} className="flex flex-col gap-3" data-testid="coupon-new">
      <h2 className="m-0 font-display text-lg font-bold text-fg">{say("adminConfig.coupons.new")}</h2>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <form.Form aria-label={say("adminConfig.coupons.new")} className="flex flex-col gap-4">
        <form.Select
          name="kind"
          label={say("adminConfig.coupons.kind")}
          options={choices("kinds", ["discount", "credit"])}
        />
        <div className="flex flex-wrap items-end gap-3">
          <form.TextField
            name="code"
            label={say("adminConfig.coupons.code")}
            hint={say("adminConfig.coupons.codeHint")}
            autoComplete="off"
          />
          <Button variant="secondary" size="md" loading={generate.isPending} onClick={() => generate.mutate()}>
            {say("adminConfig.coupons.generate")}
          </Button>
        </div>
        <form.Select
          name="purpose"
          label={say("adminConfig.coupons.purpose")}
          options={choices("purposes", ["promo", "partner", "demo", "support"])}
        />
        <form.Select
          name="partnerId"
          label={say("adminConfig.coupons.partner")}
          hint={say("adminConfig.coupons.partnerHint")}
          placeholder={say("adminConfig.coupons.noPartner")}
          options={people
            .filter((p) => p.status === "active" && p.displayName)
            .map((p) => ({ value: p.id, label: p.displayName ?? p.id }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <form.DateField
            name="startsAt"
            label={say("adminConfig.coupons.startsAt")}
            hint={say("adminConfig.coupons.zone")}
          />
          <form.DateField
            name="endsAt"
            label={say("adminConfig.coupons.endsAt")}
            hint={say("adminConfig.coupons.endsAtHint")}
          />
          <form.TextField
            name="maxRedemptions"
            label={say("adminConfig.coupons.maxRedemptions")}
            hint={say("adminConfig.coupons.maxRedemptionsHint")}
            inputMode="numeric"
          />
          <form.TextField name="maxPerAccount" label={say("adminConfig.coupons.maxPerAccount")} inputMode="numeric" />
        </div>
        <form.Checkbox name="newCustomersOnly" label={say("adminConfig.coupons.newCustomersOnly")} />
        <form.Watch name="kind">
          {(kind) =>
            kind === "credit" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <form.TextField name="credits" label={say("adminConfig.coupons.credits")} inputMode="numeric" />
                <form.TextField
                  name="creditsValidDays"
                  label={say("adminConfig.coupons.creditsValidDays")}
                  hint={say("adminConfig.coupons.creditsValidDaysHint")}
                  inputMode="numeric"
                />
                <form.TextField
                  name="capPerDay"
                  label={say("adminConfig.coupons.capPerDay")}
                  hint={say("adminConfig.coupons.capHint")}
                  inputMode="numeric"
                />
                <form.TextField
                  name="capPerMonth"
                  label={say("adminConfig.coupons.capPerMonth")}
                  hint={say("adminConfig.coupons.capHint")}
                  inputMode="numeric"
                />
                <form.Select
                  name="onExhausted"
                  label={say("adminConfig.coupons.onExhausted")}
                  hint={say("adminConfig.coupons.onExhaustedHint")}
                  options={choices("exhausted", ["stop", "fallback_paid"])}
                />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <form.Select
                  name="discountType"
                  label={say("adminConfig.coupons.discountType")}
                  options={choices("types", Object.values(DISCOUNT_TYPE))}
                />
                <form.Watch name="discountType">
                  {(type) =>
                    type === DISCOUNT_TYPE.amount ? (
                      <form.Money
                        name="amountOffMinor"
                        label={say("adminConfig.coupons.amountOff")}
                        hint={say("adminConfig.coupons.amountOffHint")}
                        currency={COUPON_CURRENCY.toUpperCase()}
                      />
                    ) : (
                      <form.TextField
                        name="percent"
                        label={say("adminConfig.coupons.percent")}
                        hint={say("adminConfig.coupons.percentHint")}
                        inputMode="decimal"
                      />
                    )
                  }
                </form.Watch>
                <form.Select
                  name="duration"
                  label={say("adminConfig.coupons.duration")}
                  options={choices("durations", ["once", "repeating", "forever"])}
                />
                <form.Watch name="duration">
                  {(duration) =>
                    duration === "repeating" ? (
                      <form.TextField
                        name="durationMonths"
                        label={say("adminConfig.coupons.durationMonths")}
                        inputMode="numeric"
                      />
                    ) : (
                      <span />
                    )
                  }
                </form.Watch>
                <form.Money
                  name="minimumMinor"
                  label={say("adminConfig.coupons.minimum")}
                  hint={say("adminConfig.coupons.minimumHint")}
                  currency={COUPON_CURRENCY.toUpperCase()}
                />
              </div>
            )
          }
        </form.Watch>
        <div className="flex gap-2">
          <form.Submit size="md">{say("adminConfig.coupons.create")}</form.Submit>
          <Button variant="ghost" size="md" onClick={() => setShown(false)}>
            {say("adminConfig.coupons.cancel")}
          </Button>
        </div>
      </form.Form>
    </section>
  );
}

function couponColumns(
  say: Say,
  locale: Lang,
  partners: Partner[],
  act: (id: string, action: string) => void,
  onOpen: (id: string) => void,
  busy: boolean,
): DataTableColumn<Coupon>[] {
  const now = new Date();
  const partnerName = (id: string | null) =>
    id ? (partners.find((p) => p.id === id)?.displayName ?? say("adminConfig.coupons.erased")) : "—";
  const terms = (c: Coupon) =>
    c.kind === "credit"
      ? say("adminConfig.coupons.creditTerms", { credits: c.credits ?? 0, days: c.creditsValidDays ?? 0 })
      : say(`adminConfig.coupons.discountTerms.${c.percentOffBp === null ? "amount" : "percent"}`, {
          value:
            c.percentOffBp === null
              ? new Intl.NumberFormat(locale, {
                  style: "currency",
                  currency: (c.currency ?? COUPON_CURRENCY).toUpperCase(),
                }).format((c.amountOffMinor ?? 0) / 100)
              : (c.percentOffBp ?? 0) / 100,
          duration: say(`adminConfig.coupons.durations.${c.duration ?? "once"}`),
        });
  return [
    {
      id: "code",
      header: say("adminConfig.coupons.code"),
      sortable: true,
      card: "title",
      value: (c) => c.code,
      cell: (c) => <code className="font-mono text-xs">{c.code}</code>,
    },
    {
      id: "kind",
      header: say("adminConfig.coupons.kind"),
      value: (c) => c.kind,
      filter: "facet",
      cell: (c) => say(`adminConfig.coupons.kinds.${c.kind}`),
    },
    { id: "terms", header: say("adminConfig.coupons.terms"), value: terms },
    {
      id: "purpose",
      header: say("adminConfig.coupons.purpose"),
      value: (c) => c.purpose,
      filter: "facet",
      cell: (c) => say(`adminConfig.coupons.purposes.${c.purpose}`),
    },
    { id: "partner", header: say("adminConfig.coupons.partner"), value: (c) => partnerName(c.partnerId) },
    {
      id: "window",
      header: say("adminConfig.coupons.window"),
      value: (c) => c.startsAt as unknown as string,
      cell: (c) =>
        `${formatDate(String(c.startsAt), locale)} → ${c.endsAt ? formatDate(String(c.endsAt), locale) : "∞"}`,
    },
    {
      id: "uses",
      header: say("adminConfig.coupons.uses"),
      align: "end",
      value: (c) => c.maxRedemptions ?? 0,
      cell: (c) => (c.maxRedemptions === null ? "∞" : c.maxRedemptions),
    },
    {
      id: "state",
      header: say("adminConfig.coupons.state"),
      value: (c) => stateOf(c, now),
      filter: "facet",
      cell: (c) => <Badge tone={TONE[stateOf(c, now)]}>{say(`adminConfig.coupons.states.${stateOf(c, now)}`)}</Badge>,
    },
    {
      id: "actions",
      header: say("adminConfig.coupons.actions"),
      headerHidden: true,
      value: () => "",
      cell: (c) => (
        <span className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => onOpen(c.id)}>
            {say("adminConfig.coupons.redemptions")}
          </Button>
          {c.status === "active" ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => act(c.id, "pause")}>
              {say("adminConfig.coupons.pause")}
            </Button>
          ) : null}
          {c.status === "paused" ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => act(c.id, "resume")}>
              {say("adminConfig.coupons.resume")}
            </Button>
          ) : null}
          {c.status !== "archived" ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(c.id, "archive")}>
              {say("adminConfig.coupons.archive")}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];
}

function CouponTable({
  coupons,
  partners: people,
  onOpen,
}: Readonly<{ coupons: Coupon[]; partners: Partner[]; onOpen: (id: string) => void }>) {
  const { say, locale } = useSay();
  const refresh = useRefresh();
  const [problem, setProblem] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      krizakaFetch(`/api/admin/coupons/${id}`, { method: "POST", json: { action } }),
    onSuccess: () => refresh(),
    onError: (error) => setProblem(say(`errors.${errorKey(error)}`)),
  });
  const columns = useMemo(
    () => couponColumns(say, locale, people, (id, action) => change.mutate({ id, action }), onOpen, change.isPending),
    [say, locale, people, change, onOpen],
  );
  return (
    <section aria-label={say("adminConfig.coupons.title")} className="flex flex-col gap-2">
      <h2 className="m-0 font-display text-lg font-bold text-fg">{say("adminConfig.coupons.title")}</h2>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {coupons.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">{say("adminConfig.coupons.empty")}</p>
      ) : (
        <DataTable
          caption={say("adminConfig.coupons.title")}
          rows={coupons}
          columns={columns}
          getRowId={(c) => c.id}
          rowLabel={(c) => c.code}
        />
      )}
    </section>
  );
}

/** The redemptions of a coupon: when, state, who, what was paid and given back, and the revoke. */
function redemptionColumns(
  say: Say,
  locale: Lang,
  revoke: { isPending: boolean; mutate: (redemptionId: string) => void },
): DataTableColumn<Redemption>[] {
  const money = (minor: number | null, currency: string | null) =>
    minor === null
      ? "—"
      : new Intl.NumberFormat(locale, {
          style: "currency",
          currency: (currency ?? COUPON_CURRENCY).toUpperCase(),
        }).format(minor / 100);
  return [
    {
      id: "when",
      header: say("adminConfig.coupons.when"),
      sortable: true,
      value: (r) => String(r.createdAt),
      cell: (r) => formatDate(String(r.createdAt), locale, true),
    },
    {
      id: "status",
      header: say("adminConfig.coupons.state"),
      value: (r) => r.status,
      filter: "facet",
      cell: (r) => (
        <Badge tone={r.status === "confirmed" ? "success" : "neutral"}>
          {say(`adminConfig.coupons.redemptionStates.${r.status}`)}
        </Badge>
      ),
    },
    {
      id: "account",
      header: say("adminConfig.coupons.account"),
      value: (r) => r.accountId ?? "",
      cell: (r) => (
        <code className="font-mono text-xs">
          {r.accountId ? r.accountId.slice(0, 8) : say("adminConfig.coupons.deletedAccount")}
        </code>
      ),
    },
    {
      id: "paid",
      header: say("adminConfig.coupons.paid"),
      align: "end",
      value: (r) => r.amountPaidMinor ?? 0,
      cell: (r) => money(r.amountPaidMinor, r.currency),
    },
    {
      id: "discount",
      header: say("adminConfig.coupons.discount"),
      align: "end",
      value: (r) => r.amountDiscountMinor ?? 0,
      cell: (r) => money(r.amountDiscountMinor, r.currency),
    },
    {
      id: "refunded",
      header: say("adminConfig.coupons.refunded"),
      align: "end",
      value: (r) => r.amountRefundedMinor,
      cell: (r) => money(r.amountRefundedMinor, r.currency),
    },
    {
      id: "late",
      header: say("adminConfig.coupons.late"),
      value: (r) => (r.overLimit ? "yes" : "no"),
      cell: (r) => (r.overLimit ? <Badge tone="warning">{say("adminConfig.coupons.overLimit")}</Badge> : null),
    },
    {
      id: "revoke",
      header: say("adminConfig.coupons.actions"),
      headerHidden: true,
      value: () => "",
      cell: (r) =>
        r.creditGrantId && r.status === "confirmed" ? (
          <Button variant="danger" size="sm" loading={revoke.isPending} onClick={() => revoke.mutate(r.id)}>
            {say("adminConfig.coupons.revoke")}
          </Button>
        ) : null,
    },
  ];
}

function Redemptions({ id, onClose }: Readonly<{ id: string; onClose: () => void }>) {
  const { say, locale } = useSay();
  const refresh = useRefresh();
  const [problem, setProblem] = useState<string | null>(null);
  const data = useQuery({
    queryKey: ["admin-coupon", id],
    queryFn: () => krizakaFetch(`/api/admin/coupons/${id}?limit=200`, { schema: detail }),
  });
  const revoke = useMutation({
    mutationFn: (redemptionId: string) =>
      krizakaFetch(`/api/admin/coupons/${id}`, { method: "POST", json: { action: "revoke", redemptionId } }),
    onSuccess: () => Promise.all([data.refetch(), refresh()]),
    onError: (error) => setProblem(say(`errors.${errorKey(error)}`)),
  });
  const columns = useMemo(() => redemptionColumns(say, locale, revoke), [say, locale, revoke.isPending]); // eslint-disable-line react-hooks/exhaustive-deps -- `revoke` is a new object each render; its mutate is stable
  return (
    <section
      aria-label={say("adminConfig.coupons.redemptions")}
      className="flex flex-col gap-2"
      data-testid="coupon-redemptions"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 font-display text-lg font-bold text-fg">
          {say("adminConfig.coupons.redemptionsOf", { code: data.data?.coupon.code ?? "" })}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {say("adminConfig.coupons.close")}
        </Button>
      </div>
      <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">{say("adminConfig.coupons.redemptionsNote")}</p>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {data.data && data.data.redemptions.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">{say("adminConfig.coupons.noRedemptions")}</p>
      ) : null}
      {data.data && data.data.redemptions.length > 0 ? (
        <DataTable
          caption={say("adminConfig.coupons.redemptions")}
          rows={data.data.redemptions}
          columns={columns}
          getRowId={(r) => r.id}
          rowLabel={(r) => r.id}
        />
      ) : null}
    </section>
  );
}

/** The partners: name, address, state, and the row's actions (report, export, archive or restore, erase). */
function partnerColumns(
  say: Say,
  onOpen: (id: string) => void,
  act: { isPending: boolean; mutate: (call: { id: string; action: string }) => void },
): DataTableColumn<Partner>[] {
  return [
    {
      id: "name",
      header: say("adminConfig.coupons.partnerName"),
      sortable: true,
      card: "title",
      value: (p) => p.displayName ?? "",
      cell: (p) => p.displayName ?? say("adminConfig.coupons.erased"),
    },
    { id: "email", header: say("adminConfig.coupons.partnerEmail"), value: (p) => p.contactEmail ?? "" },
    {
      id: "status",
      header: say("adminConfig.coupons.state"),
      value: (p) => (p.erasedAt ? "erased" : p.status),
      cell: (p) => (
        <Badge tone={p.status === "active" && !p.erasedAt ? "success" : "neutral"}>
          {say(`adminConfig.coupons.partnerStates.${p.erasedAt ? "erased" : p.status}`)}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: say("adminConfig.coupons.actions"),
      headerHidden: true,
      value: () => "",
      cell: (p) => (
        <span className="flex flex-wrap gap-2">
          {p.erasedAt ? null : (
            <>
              <Button variant="secondary" size="sm" onClick={() => onOpen(p.id)}>
                {say("adminConfig.coupons.report")}
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <a href={`/api/admin/coupons/partners/${p.id}?export=1`} download>
                  {say("adminConfig.coupons.export")}
                </a>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={act.isPending}
                onClick={() => act.mutate({ id: p.id, action: p.status === "active" ? "archive" : "restore" })}
              >
                {say(p.status === "active" ? "adminConfig.coupons.archive" : "adminConfig.coupons.restore")}
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={act.isPending}
                onClick={() => act.mutate({ id: p.id, action: "erase" })}
              >
                {say("adminConfig.coupons.erase")}
              </Button>
            </>
          )}
        </span>
      ),
    },
  ];
}

function Partners({ partners: people, onOpen }: Readonly<{ partners: Partner[]; onOpen: (id: string) => void }>) {
  const { say, locale } = useSay();
  const refresh = useRefresh();
  const [problem, setProblem] = useState<string | null>(null);
  const form = partnerForm.useForm({
    ...formI18n(say, locale),
    defaultValues: { displayName: "", contactEmail: "" },
    onSubmit: async (values) => {
      setProblem(null);
      try {
        await krizakaFetch("/api/admin/coupons/partners", {
          method: "POST",
          json: {
            displayName: values.displayName,
            contactEmail: values.contactEmail === "" ? null : values.contactEmail,
          },
        });
      } catch (error) {
        setProblem(say(`errors.${errorKey(error)}`));
        throw error;
      }
      await refresh();
      form.reset();
    },
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      krizakaFetch(`/api/admin/coupons/partners/${id}`, { method: "POST", json: { action } }),
    onSuccess: () => refresh(),
    onError: (error) => setProblem(say(`errors.${errorKey(error)}`)),
  });
  const columns = useMemo(() => partnerColumns(say, onOpen, act), [say, onOpen, act.isPending]); // eslint-disable-line react-hooks/exhaustive-deps -- `act` is a new object each render; its mutate is stable
  return (
    <section
      aria-label={say("adminConfig.coupons.partners")}
      className="flex flex-col gap-3"
      data-testid="coupon-partners"
    >
      <h2 className="m-0 font-display text-lg font-bold text-fg">{say("adminConfig.coupons.partners")}</h2>
      <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">{say("adminConfig.coupons.partnersLead")}</p>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <form.Form aria-label={say("adminConfig.coupons.addPartner")} className="flex flex-wrap items-end gap-3">
        <form.TextField name="displayName" label={say("adminConfig.coupons.partnerName")} maxLength={80} />
        <form.TextField name="contactEmail" label={say("adminConfig.coupons.partnerEmail")} inputMode="email" />
        <form.Submit size="md">{say("adminConfig.coupons.addPartner")}</form.Submit>
      </form.Form>
      {people.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">{say("adminConfig.coupons.noPartners")}</p>
      ) : (
        <DataTable
          caption={say("adminConfig.coupons.partners")}
          rows={people}
          columns={columns}
          getRowId={(p) => p.id}
          rowLabel={(p) => p.displayName ?? p.id}
        />
      )}
    </section>
  );
}

/** What a partner's codes brought: uses, discount, revenue, credits. */
function reportColumns(say: Say, locale: Lang): DataTableColumn<PartnerRow>[] {
  const money = (minor: number, currency: string | null) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: (currency ?? COUPON_CURRENCY).toUpperCase() }).format(
      minor / 100,
    );
  return [
    {
      id: "code",
      header: say("adminConfig.coupons.code"),
      card: "title",
      value: (r) => r.code,
      cell: (r) => <code className="font-mono text-xs">{r.code}</code>,
    },
    { id: "uses", header: say("adminConfig.coupons.uses"), align: "end", value: (r) => r.redemptions },
    {
      id: "discount",
      header: say("adminConfig.coupons.discount"),
      align: "end",
      value: (r) => r.discountMinor,
      cell: (r) => money(r.discountMinor, r.currency),
    },
    {
      id: "revenue",
      header: say("adminConfig.coupons.revenue"),
      align: "end",
      value: (r) => r.revenueMinor,
      cell: (r) => money(r.revenueMinor, r.currency),
    },
    { id: "credits", header: say("adminConfig.coupons.creditsGranted"), align: "end", value: (r) => r.creditsGranted },
  ];
}

function PartnerReport({ id, onClose }: Readonly<{ id: string; onClose: () => void }>) {
  const { say, locale } = useSay();
  const data = useQuery({
    queryKey: ["admin-coupon-partner", id],
    queryFn: () => krizakaFetch(`/api/admin/coupons/partners/${id}`, { schema: report }),
  });
  const columns = useMemo(() => reportColumns(say, locale), [say, locale]);
  return (
    <section
      aria-label={say("adminConfig.coupons.report")}
      className="flex flex-col gap-2"
      data-testid="coupon-partner-report"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 font-display text-lg font-bold text-fg">
          {say("adminConfig.coupons.reportOf", { name: data.data?.partner.displayName ?? "" })}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {say("adminConfig.coupons.close")}
        </Button>
      </div>
      <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">{say("adminConfig.coupons.reportNote")}</p>
      {data.data && data.data.rows.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">{say("adminConfig.coupons.noRedemptions")}</p>
      ) : null}
      {data.data && data.data.rows.length > 0 ? (
        <DataTable
          caption={say("adminConfig.coupons.report")}
          rows={data.data.rows}
          columns={columns}
          getRowId={(r) => `${r.couponId}:${r.currency ?? ""}`}
          rowLabel={(r) => r.code}
        />
      ) : null}
    </section>
  );
}

const PILOT_COLUMNS = Object.values(PILOT_STAGE);

/** The pilot funnel, read-only: one row per pilot code with its four counters (totals; no account, e-mail or applicant is behind them). */
function PilotCounters({ codes }: Readonly<{ codes: PilotCodeCounts[] }>) {
  const { say } = useSay();
  const columns: DataTableColumn<PilotCodeCounts>[] = [
    {
      id: "code",
      header: say("adminConfig.coupons.pilotCode"),
      sortable: true,
      value: (c) => c.code,
      cell: (c) => c.code,
    },
    ...PILOT_COLUMNS.map((stage) => ({
      id: stage,
      header: say(`adminConfig.coupons.stages.${stage}`),
      sortable: true,
      value: (c: PilotCodeCounts) => String(c.counts[stage]).padStart(9, "0"),
      cell: (c: PilotCodeCounts) => String(c.counts[stage]),
    })),
  ];
  return (
    <section
      aria-label={say("adminConfig.coupons.pilotTitle")}
      className="flex flex-col gap-2"
      data-testid="pilot-counters"
    >
      <h2 className="m-0 font-display text-lg font-bold text-fg">{say("adminConfig.coupons.pilotTitle")}</h2>
      <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">{say("adminConfig.coupons.pilotLead")}</p>
      {codes.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">{say("adminConfig.coupons.pilotEmpty")}</p>
      ) : (
        <DataTable
          caption={say("adminConfig.coupons.pilotTitle")}
          rows={codes}
          columns={columns}
          getRowId={(c) => c.couponId}
          rowLabel={(c) => c.code}
        />
      )}
    </section>
  );
}
