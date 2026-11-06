import "../globals.css";
import "@krizaka/ui/blocks.css";

import { MotionObserver, PageTransition } from "@krizaka/ui/motion";
import { ThemeProvider, ThemeScript } from "@krizaka/ui/theme";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { StageNotice } from "@/components/StageNotice";
import { getDictionary, type Locale, LOCALES } from "@/lib/i18n";
import { SITE_URL } from "@/lib/site";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = getDictionary(LOCALES.includes(locale as Locale) ? (locale as Locale) : "en");
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t.meta.siteName, template: t.meta.titleTemplate.replace("{title}", "%s") },
    description: t.meta.description,
    applicationName: t.meta.siteName,
    authors: [{ name: "Krizaka", url: "https://www.krizaka.com" }],
    // Not indexed (dev, preview): the page says so too — the header and robots.txt say it already (lib/indexing.ts).
  };
}

/** The root of every page, in the language of the address, dark by default (the visitor's `kz-theme` wins). */
export default async function LocaleLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) notFound();
  return (
    <html lang={locale} data-surface="product" suppressHydrationWarning>
      <head>
        <ThemeScript defaultMode="dark" />
      </head>
      <body className="min-h-screen bg-surface-0 text-fg antialiased selection:bg-accent selection:text-on-accent">
        <ThemeProvider defaultMode="dark">
          <StageNotice locale={locale as Locale} />
          <PageTransition>{children}</PageTransition>
          <MotionObserver />
        </ThemeProvider>
      </body>
    </html>
  );
}
