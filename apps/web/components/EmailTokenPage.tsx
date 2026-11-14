import { Button } from "@krizaka/ui/button";
import { Page } from "@krizaka/ui/page";
import { PageHero } from "@krizaka/ui/page-hero";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteChrome";
import { ProductFooter } from "@/components/SiteFooter";
import { asLocale, getDictionary } from "@/lib/i18n";
import { pagePath } from "@/lib/site";

/** The two pages a mailed link lands on (confirm a new address, verify a sign-up): the action is a button (a POST), so a mail scanner cannot spend the link. */
export type EmailTokenKind = "confirmEmail" | "verifyEmail";

export async function EmailTokenPage({
  params,
  searchParams,
  kind,
  isToken,
  action,
}: Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
  kind: EmailTokenKind;
  isToken: (token: string | undefined) => boolean;
  action: string;
}>) {
  const locale = asLocale((await params).locale);
  const token = (await searchParams).token;
  const t = getDictionary(locale);
  const v = t.console[kind];
  const valid = isToken(token);
  return (
    <>
      <SiteHeader locale={locale} current="home" />
      <main id="content" className="pt-20">
        <PageHero
          back={{ href: pagePath(locale, "home"), label: t.meta.siteName }}
          linkAs={Link}
          title={v.title}
          backdrop="plain"
          lead={valid ? v.lead : v.invalid}
        />
        <Page>
          {valid ? (
            // ui-allow: a native POST with no script, so a mail scanner cannot spend the single-use link; a @krizaka/ui Form is client state with no plain action
            <form method="post" action={action}>
              {/* ui-allow: hidden carriers of the token and the language in that native POST */}
              <input type="hidden" name="token" value={token} />
              {/* ui-allow: hidden carriers of the token and the language in that native POST */}
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" size="lg" variant="primary">
                {v.button}
              </Button>
            </form>
          ) : null}
        </Page>
      </main>
      <ProductFooter locale={locale} />
    </>
  );
}

export const emailTokenMetadata = async (params: Promise<{ locale: string }>, kind: EmailTokenKind) => ({
  title: getDictionary(asLocale((await params).locale)).console[kind].title,
  robots: { index: false, follow: false },
});
