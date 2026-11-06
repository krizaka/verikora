"use client";

import { krizakaFetch, useQuery } from "@krizaka/query";
import { SettingsRow } from "@krizaka/ui/settings-layout";
import { z } from "zod";

import { useSay } from "@/lib/i18n-client";

type Say = (key: string, vars?: Record<string, string | number>) => string;

const payments = z.object({
  payments: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      what: z.string().nullable(),
      amountCents: z.number(),
      currency: z.string(),
      state: z.enum(["paid", "refunded"]),
      receiptUrl: z.string().url().nullable(),
    }),
  ),
});
export type PaymentLine = z.infer<typeof payments>["payments"][number];

/** What one payment line says: the day, what was bought, the amount, the state, the receipt label. Pure. */
export function paymentLine(p: PaymentLine, say: Say, locale: string) {
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(p.at));
  const amount = new Intl.NumberFormat(locale, { style: "currency", currency: p.currency.toUpperCase() }).format(
    p.amountCents / 100,
  );
  return {
    id: p.id,
    day,
    what: p.what ?? say("settings.billing.history.what"),
    amount,
    state: say(`settings.billing.history.${p.state}`),
    receipt: say("settings.billing.history.receiptFor", { date: day }),
    receiptUrl: p.receiptUrl,
  };
}

/** Account → Billing: the last payments with a receipt link each (verikora#585). Read by the server from the processor; nothing about a card. */
export function PaymentHistory({ enabled }: Readonly<{ enabled: boolean }>) {
  const { say, locale } = useSay();
  const history = useQuery({
    queryKey: ["billing-payments"],
    queryFn: () => krizakaFetch("/api/billing/payments", { schema: payments }),
    enabled,
  });
  if (!enabled || !history.data) {
    return null;
  }
  const lines = history.data.payments.map((p) => paymentLine(p, say, locale));
  return (
    <SettingsRow
      label={say("settings.billing.history.title")}
      description={lines.length === 0 ? say("settings.billing.history.empty") : undefined}
    >
      {lines.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="payment-history">
          {lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
              <span className="text-fg-muted">
                <time dateTime={l.day}>{l.day}</time> · {l.what}
              </span>
              <span className="font-semibold text-fg">
                {l.amount} <span className="font-normal text-fg-muted">· {l.state}</span>
                {l.receiptUrl ? (
                  <>
                    {" · "}
                    <a
                      className="text-fg-accent hover:underline"
                      href={l.receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={l.receipt}
                    >
                      {say("settings.billing.history.receipt")}
                    </a>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsRow>
  );
}
