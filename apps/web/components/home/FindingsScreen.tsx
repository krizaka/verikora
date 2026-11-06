"use client";

import type { ComplianceReport } from "@verikora/core";
import dynamic from "next/dynamic";

import type { Locale } from "@/lib/i18n";
import type { ConsoleMessages } from "@/lib/i18n-client";
import { I18nProvider } from "@/lib/i18n-client";

const Live = dynamic(() => import("./FindingsLive").then((m) => m.FindingsLive), {
  ssr: false,
  loading: () => <div className="h-64" />,
});

/** The report face of a check (verdict band + numbered findings), loaded after the page is interactive: below the fold, never the LCP. */
export function FindingsScreen({
  locale,
  messages,
  report,
}: Readonly<{ locale: Locale; messages: ConsoleMessages; report: ComplianceReport }>) {
  return (
    <I18nProvider locale={locale} messages={messages}>
      <Live report={report} />
    </I18nProvider>
  );
}
