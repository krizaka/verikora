"use client";

import { krizakaFetch, useMutation, useQuery } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { useState } from "react";
import { z } from "zod";

import { PromoCode } from "@/components/console/PromoCode";
import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";
import { paywallFigures, type SoldPrice } from "@/lib/prices/paywall";
import type { SoldKind } from "@/lib/pricing";

const price = z.object({
  key: z.string(),
  amountCents: z.number().nullable(),
  limits: z.record(z.string(), z.number()),
});
const summary = z.object({
  paymentsOn: z.boolean(),
  couponsOn: z.boolean().default(false),
  paymentsDisplay: z.string().optional(),
  fairUsePerMonth: z.number(),
  prices: z.array(price),
});
const redirect = z.object({ url: z.string().url() });

/** The second audit: pay for this document or subscribe — at the catalogue's prices. Without payment configured it says so — no button that leads nowhere. */
export function Paywall({ reason }: Readonly<{ reason: "PAYWALL" | "FAIR_USE" }>) {
  const { say, locale } = useSay();
  const [problem, setProblem] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const info = useQuery({ queryKey: ["billing"], queryFn: () => krizakaFetch("/api/billing", { schema: summary }) });
  const go = useMutation({
    mutationFn: (kind: SoldKind) =>
      krizakaFetch("/api/billing/checkout", {
        method: "POST",
        json: { kind, ...(code && { code }) },
        schema: redirect,
      }),
    onSuccess: ({ url }) => globalThis.location.assign(url),
    onError: (error) => setProblem(say(`errors.${errorKey(error)}`)),
  });
  if (reason === "FAIR_USE")
    return (
      <Alert tone="warning" title={say("paywall.fairUseTitle")}>
        {say("paywall.fairUse", { limit: info.data?.fairUsePerMonth ?? 0 })}
      </Alert>
    );
  const figures = info.data ? paywallFigures(info.data.prices as SoldPrice[], locale) : null;
  return (
    <Alert tone="info" title={say("paywall.title")}>
      <p>{say("paywall.text")}</p>
      {info.data?.paymentsOn && info.data.couponsOn ? (
        <div className="mt-3">
          <PromoCode kind="document" onCode={setCode} onRedeemed={() => globalThis.location.reload()} />
        </div>
      ) : null}
      {info.data?.paymentsOn ? (
        <div className="mt-3 flex flex-wrap gap-3">
          <Button size="md" disabled={go.isPending} onClick={() => go.mutate("document")}>
            {say("paywall.payOne")}
          </Button>
        </div>
      ) : null}
      {info.data && !info.data.paymentsOn ? (
        <p className="mt-3 font-semibold" data-testid="payments-soon">
          {say("paywall.soon")}
        </p>
      ) : null}
      {problem ? <p className="mt-2">{problem}</p> : null}
      {info.data?.paymentsOn && info.data.paymentsDisplay === "test" ? (
        <p className="mt-2 text-sm font-semibold" data-testid="payments-test-mode">
          {say("paywall.testMode")}
        </p>
      ) : null}
      {figures ? (
        <p className="mt-3 text-sm" data-testid="paywall-prices">
          {say("paywall.notice", figures)}
        </p>
      ) : null}
      <p className="mt-3 text-sm">{say("paywall.informative")}</p>
    </Alert>
  );
}
