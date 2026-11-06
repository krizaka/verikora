import { Alert } from "@krizaka/ui/alert";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { mailConfigured } from "@/app/accounts-edge";
import { AuthShell } from "@/components/console/AuthShell";
import { SignInForm } from "@/components/console/SignInForm";
import { pageSession } from "@/lib/access";
import { env } from "@/lib/env";
import { asLocale, getDictionary } from "@/lib/i18n";
import { signupOpenNow } from "@/lib/settings/signup";
import { safeNext } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDictionary(asLocale((await params).locale));
  return { title: t.console.meta.signIn, robots: { index: false, follow: false } };
}

/** Sign-in on @krizaka/ui's auth template, Verikora's mark and its owl. Sign-up is closed — the page says so. */
export default async function SignInPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; verified?: string; verify?: string; reset?: string }>;
}>) {
  const locale = asLocale((await params).locale);
  const query = await searchParams;
  const next = safeNext(query.next, locale);
  if (await pageSession().catch(() => null)) redirect(next);
  const t = getDictionary(locale).console.signIn;
  const forgot = mailConfigured();
  return (
    <AuthShell
      locale={locale}
      promise={t.promise}
      title={t.title}
      description={t.description}
      footer={
        (await signupOpenNow(env())) ? (
          <Link className="font-semibold text-fg-accent" href={`/${locale}/sign-up`}>
            {t.signUpLink}
          </Link>
        ) : (
          <>
            <strong className="block font-semibold text-fg">{t.closedTitle}</strong>
            <span className="block">{t.closed}</span>
          </>
        )
      }
      legal={
        <>
          {t.legalPrefix}{" "}
          <Link className="underline" href={`/${locale}/privacy`}>
            {t.privacy}
          </Link>
          .
        </>
      }
    >
      {query.verified ? <Alert tone="success">{t.verifiedNotice}</Alert> : null}
      {query.verify ? <Alert tone="danger">{t.invalidNotice}</Alert> : null}
      {query.reset ? <Alert tone="success">{t.resetNotice}</Alert> : null}
      <SignInForm next={next} />
      {forgot ? (
        <p className="text-center text-sm">
          <Link className="font-semibold text-fg-accent" href={`/${locale}/forgot-password`}>
            {t.forgotLink}
          </Link>
        </p>
      ) : null}
    </AuthShell>
  );
}
