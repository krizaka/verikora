"use client";

import { KrizakaQueryProvider } from "@krizaka/query";
import { useRouter } from "next/navigation";

import type { Locale } from "@/lib/i18n";
import type { ConsoleMessages } from "@/lib/i18n-client";
import { I18nProvider } from "@/lib/i18n-client";
import { installIngressAwareFetch } from "@/lib/ingress-fetch";

// Once per page load, before any call: the ingress turns a 502 into a 504 page and keeps the headers (krizaka-internal#3225).
installIngressAwareFetch();

/** The console's client roots: its language (only its own slice), and server state through @krizaka/query. */
export function ConsoleProviders({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages: ConsoleMessages; children: React.ReactNode }>) {
  const router = useRouter();
  return (
    <I18nProvider locale={locale} messages={messages}>
      <KrizakaQueryProvider onUnauthorized={() => router.replace(`/${locale}/sign-in`)}>
        {children}
      </KrizakaQueryProvider>
    </I18nProvider>
  );
}
