import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ComponentProps } from "react";

import { SubscribeButton } from "@/components/console/SubscribeButton";
import { PricingContent } from "@/components/pricing/PricingContent";
import { pageSession } from "@/lib/access";
import { entitlementOf } from "@/lib/billing";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { asLocale, getDictionary } from "@/lib/i18n";
import { paymentsFrom } from "@/lib/payments/config";
import { pricingView } from "@/lib/prices/pricing-view";
import { PRICING_PUBLISHED } from "@/lib/prices/publication";
import { isSoldKind, SOLD } from "@/lib/pricing";
import { statusLine } from "@/lib/product-status";
import { settingsFor } from "@/lib/settings/guards";

type PlanProps = ComponentProps<typeof PricingContent>;

/** The button of a plan card: « Subscribe » for a plan that is sold, « Current plan » for the one the account holds. */
function PlanAction({
  plan,
  dict,
  entitlement,
}: Readonly<{
  plan: Parameters<NonNullable<PlanProps["action"]>>[0];
  dict: ReturnType<typeof getDictionary>;
  entitlement: Awaited<ReturnType<typeof entitlementOf>>;
}>) {
  if (!isSoldKind(plan)) {
    return null;
  }
  return (
    <SubscribeButton
      kind={plan}
      plan={dict.pricing.plans[plan as keyof typeof dict.pricing.plans]?.name ?? plan}
      current={entitlement.pro && entitlement.planKey === SOLD[plan].key}
    />
  );
}

/** The offers are data an administrator schedules (ADR-009): read at each request, as on the public page. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return { title: getDictionary(asLocale((await params).locale)).pricing.inApp };
}

/**
 * The plans, inside the app (krizaka-internal#1901): the very grid of /pricing (offers as data, the free monthly dossier included)
 * under the app's shell, with « Subscribe — <plan> » / « Current plan » in place of « Sign in ». The button leads to the same
 * checkout as Plan and billing.
 */
export default async function PlansPage({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  if (!PRICING_PUBLISHED) {
    notFound();
  }
  const locale = asLocale((await params).locale);
  const session = await pageSession();
  if (!session) {
    notFound();
  }
  const now = new Date();
  const [view, entitlement, settings] = await Promise.all([
    pricingView(locale, now),
    entitlementOf(query, session.account.id, now),
    settingsFor(session.account.id),
  ]);
  const paymentsOn = paymentsFrom(env()) !== null && settings["payments.enabled"].value === true;
  const dict = getDictionary(locale);
  return (
    <>
      <PricingContent
        locale={locale}
        {...view}
        status={statusLine(dict.landing.status)}
        action={(plan) => <PlanAction plan={plan} dict={dict} entitlement={entitlement} />}
      />
      {paymentsOn ? null : <p data-testid="payments-off">{dict.pricing.paymentsOff}</p>}
    </>
  );
}
