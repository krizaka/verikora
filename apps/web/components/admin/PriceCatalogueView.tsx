"use client";

import { krizakaFetch, useQuery, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { AlertDialog } from "@krizaka/ui/dialog";
import {
  PriceCatalogueEditor,
  type PriceFigures,
  type PriceHistoryEntry,
  type PriceScheduleResult,
} from "@krizaka/ui/price-catalogue-editor";
import { format } from "date-fns";
import { useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";
import { effectiveFromOf, patchOf, type PriceFields } from "@/lib/prices/edit";
import { localeTag, money } from "@/lib/prices/format";

const fields = {
  unit: z.string(),
  amountCents: z.number().nullable(),
  availability: z.string(),
  limits: z.record(z.string(), z.number()),
};
const version = z.object({ versionId: z.string(), effectiveFrom: z.string(), ...fields });
const entry = version.extend({
  key: z.string(),
  product: z.string(),
  plan: z.string(),
  currency: z.string(),
  upcoming: z.array(version),
});
const line = z.object({
  versionId: z.string(),
  at: z.string(),
  actorLabel: z.string(),
  effectiveFrom: z.string(),
  before: z.object(fields).nullable(),
  after: z.object(fields),
});
const answer = z.object({
  units: z.array(z.string()),
  availabilities: z.array(z.string()),
  entries: z.array(entry),
  history: z.record(z.string(), z.array(line)),
  processor: z.object({
    mode: z.enum(["test", "live"]).nullable(),
    amounts: z.record(z.string(), z.number().nullable()),
  }),
});
const synced = z.object({
  sync: z.object({ mode: z.string(), prices: z.array(z.object({ lookupKey: z.string(), status: z.string() })) }),
});

const SEED = "seed:";
const LIMITS = ["included", "founderCap", "feeBps", "feeCapCents"] as const;

/** A change the administrator is asked to confirm: what it is, and the answer that settles the editor's promise. */
interface Pending {
  key: string;
  summary: string;
  settle: (ok: boolean) => void;
}

/**
 * The price catalogue (ADR-009, verikora#367 · #548): `PriceCatalogueEditor` of @krizaka/ui draws each entry; a change applies from a
 * day (never in the past), keeps every version, and is confirmed in a dialog before it can touch what customers pay. The processor's
 * price is shown beside the catalogue's, with a « Sync » that creates the matching price in test mode (live is the owner's).
 */
export function PriceCatalogueView() {
  const { say, locale } = useSay();
  const client = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const data = useQuery({
    queryKey: ["admin-prices"],
    queryFn: () => krizakaFetch("/api/admin/prices", { schema: answer }),
  });
  if (!data.data) return null;
  const { entries, units, availabilities, processor, history } = data.data;
  const today = format(new Date(), "yyyy-MM-dd");
  const shown = (cents: number | null) => (cents === null ? say("adminConfig.prices.onQuote") : money(cents, locale));
  const nameOf = (key: string) => say(`adminConfig.prices.entries.${key.split(".")[1]}`);

  const confirm = (key: string, summary: string) =>
    new Promise<boolean>((settle) => setPending({ key, summary, settle }));

  const onSchedule = async (key: string, change: PriceFigures, from: string): Promise<PriceScheduleResult> => {
    const saved = entries.find((e) => e.key === key);
    if (!saved) return { ok: false, message: say("errors.UNKNOWN_PRICE") };
    const before: PriceFields = {
      amountCents: saved.amountCents,
      availability: saved.availability,
      limits: saved.limits,
    };
    const patch = patchOf(before, {
      amount: change.amountCents === null ? "" : String(change.amountCents / 100),
      availability: change.availability,
      limits: Object.fromEntries(Object.entries(change.limits).map(([k, v]) => [k, String(v)])),
      from,
    });
    if (patch === null) return { ok: false, message: say("errors.BAD_VALUE") };
    if (Object.keys(patch).length === 0) return { ok: true };
    const now = from <= today;
    const date = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(`${from}T12:00:00`));
    const terms = {
      name: nameOf(key),
      before: shown(before.amountCents),
      after: shown(patch.amountCents === undefined ? before.amountCents : patch.amountCents),
      date,
    };
    const processorLine = say(
      processor.mode === "live"
        ? "adminConfig.prices.confirm.processorLive"
        : "adminConfig.prices.confirm.processorTest",
    );
    const summary = [
      say(now ? "adminConfig.prices.confirm.now" : "adminConfig.prices.confirm.later", terms),
      processor.mode === null ? "" : processorLine,
    ]
      .join(" ")
      .trim();
    const ok = await confirm(key, summary);
    if (!ok) return { ok: false, message: say("adminConfig.prices.confirm.cancelled") };
    try {
      await krizakaFetch("/api/admin/prices", {
        method: "POST",
        json: { key, ...patch, effectiveFrom: effectiveFromOf(from, today) },
      });
    } catch (error) {
      return { ok: false, message: say(`errors.${errorKey(error)}`) };
    }
    await client.invalidateQueries({ queryKey: ["admin-prices"] });
    return { ok: true };
  };

  const loadHistory = async (key: string): Promise<PriceHistoryEntry[]> =>
    (history[key] ?? []).filter((l) => !l.versionId.startsWith(SEED));

  const sync = async () => {
    setNote(null);
    try {
      const { sync: result } = await krizakaFetch("/api/admin/prices/sync", { method: "POST", schema: synced });
      setNote(
        say("adminConfig.prices.sync.done", {
          lines: result.prices
            .map((p) => [p.lookupKey, say(`adminConfig.prices.sync.status.${p.status}`)].join(": "))
            .join(" · "),
        }),
      );
    } catch (error) {
      setNote(say(`errors.${errorKey(error)}`));
    }
    await client.invalidateQueries({ queryKey: ["admin-prices"] });
  };

  const words = {
    edit: say("adminConfig.prices.editor.edit"),
    amount: say("adminConfig.prices.amount"),
    onQuote: say("adminConfig.prices.onQuote"),
    plusTaxes: say("adminConfig.prices.editor.plusTaxes"),
    unit: say("adminConfig.prices.editor.unit"),
    availability: say("adminConfig.prices.availability"),
    limits: say("adminConfig.prices.editor.limitsLabel"),
    from: say("adminConfig.prices.from"),
    keepsPrice: say("adminConfig.prices.editor.keepsPrice"),
    save: say("adminConfig.prices.schedule"),
    cancel: say("adminConfig.prices.editor.cancel"),
    emptyIsQuote: say("adminConfig.prices.amountHint"),
    scheduled: say("adminConfig.prices.editor.scheduled"),
    history: say("adminConfig.prices.editor.history"),
    historyEmpty: say("adminConfig.prices.editor.historyEmpty"),
    loading: say("adminConfig.prices.editor.loading"),
    historyLine: say("adminConfig.prices.editor.historyLine"),
    scheduledLine: say("adminConfig.prices.editor.scheduledLine"),
    saved: say("adminConfig.prices.editor.saved"),
    units: Object.fromEntries(units.map((u) => [u, say(`adminConfig.prices.units.${u}`)])),
    availabilities: Object.fromEntries(availabilities.map((a) => [a, say(`adminConfig.prices.availabilities.${a}`)])),
    limitNames: Object.fromEntries(LIMITS.map((k) => [k, say(`adminConfig.prices.limits.${k}`)])),
  };
  const mismatched = entries.filter(
    (e) => processor.amounts[e.key] !== undefined && processor.amounts[e.key] !== e.amountCents,
  );

  return (
    <div className="flex flex-col gap-6" data-testid="prices-catalogue">
      <div className="flex flex-col gap-1">
        <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">{say("adminConfig.prices.lead")}</p>
        {processor.mode === null ? (
          <Alert tone="info">{say("adminConfig.prices.processorOff")}</Alert>
        ) : (
          <p className="m-0 text-sm">
            {say("adminConfig.prices.processorMode")}:{" "}
            <Badge tone={processor.mode === "live" ? "danger" : "neutral"}>{processor.mode}</Badge>
          </p>
        )}
      </div>
      <PriceCatalogueEditor
        prices={{ units, availabilities, entries }}
        words={words}
        locale={localeTag(locale)}
        today={today}
        onSchedule={onSchedule}
        loadHistory={loadHistory}
        headingLevel={2}
      />
      {processor.mode === null ? null : (
        <section
          aria-label={say("adminConfig.prices.sync.title")}
          className="flex flex-col gap-2"
          data-testid="prices-sync"
        >
          <h2 className="m-0 font-display text-lg font-bold text-fg">{say("adminConfig.prices.sync.title")}</h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {entries
              .filter((e) => processor.amounts[e.key] !== undefined)
              .map((e) => (
                <li key={e.key} className="flex flex-wrap items-center gap-2">
                  <span>{nameOf(e.key)}</span>
                  <span>
                    {say("adminConfig.prices.charged")}:{" "}
                    {processor.amounts[e.key] === null
                      ? say("adminConfig.prices.notFound")
                      : money(processor.amounts[e.key] as number, locale)}
                  </span>
                  <Badge tone={processor.amounts[e.key] === e.amountCents ? "success" : "danger"}>
                    {say(
                      processor.amounts[e.key] === e.amountCents
                        ? "adminConfig.prices.match"
                        : "adminConfig.prices.mismatch",
                    )}
                  </Badge>
                </li>
              ))}
          </ul>
          <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">
            {say(mismatched.length > 0 ? "adminConfig.prices.chargedHint" : "adminConfig.prices.sync.hint")}
          </p>
          {processor.mode === "live" ? (
            <Alert tone="warning">{say("adminConfig.prices.sync.live")}</Alert>
          ) : (
            <div>
              <Button variant="secondary" onClick={sync}>
                {say("adminConfig.prices.sync.button")}
              </Button>
            </div>
          )}
          {note ? <output className="m-0 block text-sm">{note}</output> : null}
        </section>
      )}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && pending) {
            pending.settle(false);
            setPending(null);
          }
        }}
        title={say("adminConfig.prices.confirm.title", { name: pending ? nameOf(pending.key) : "" })}
        description={pending?.summary}
        confirmLabel={say("adminConfig.prices.confirm.confirm")}
        cancelLabel={say("adminConfig.prices.confirm.cancel")}
        onConfirm={() => {
          pending?.settle(true);
          setPending(null);
        }}
      />
    </div>
  );
}
