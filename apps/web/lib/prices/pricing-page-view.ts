import { connection } from "next/server";

import { pageSession } from "@/lib/access";
import { CONSOLE_ROUTES } from "@/lib/console-nav";
import type { Locale } from "@/lib/i18n";

import { type PricingPlan, type PricingSoon } from "./page";
import { pricingView } from "./pricing-view";

/** What the pricing page needs: the offers, and where a signed-in person goes instead (their plans page). */
export interface PricingPageView {
  sold: PricingPlan[];
  soon: PricingSoon[];
  redirectTo: string | null;
}

/**
 * The dev app's pricing data: the catalogue in force, read from the database at each request (prices are data an administrator
 * schedules, ADR-009 — hence `connection()`, which keeps the page out of the build), and the visitor's session. The public export
 * swaps this module for `pricing-page-view.public.ts`.
 */
export async function pricingPageView(locale: Locale, now: Date): Promise<PricingPageView> {
  await connection();
  const view = await pricingView(locale, now);
  const session = await pageSession();
  return { sold: view.sold, soon: view.soon, redirectTo: session ? `/${locale}${CONSOLE_ROUTES.plans}` : null };
}
