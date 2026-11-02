import type { Metadata } from "next";

import { ConsoleProviders } from "@/components/console/ConsoleProviders";
import { PRODUCT_NAME } from "@/lib/brand";
import { asLocale, getDictionary } from "@/lib/i18n";

// admin.yomizaka.com: never indexed, never cached.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: `${PRODUCT_NAME} — Administration`,
};

export default async function AdminRoot({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const { console: messages } = getDictionary(locale);
  return (
    <ConsoleProviders locale={locale} messages={{ console: messages }}>
      {children}
    </ConsoleProviders>
  );
}
