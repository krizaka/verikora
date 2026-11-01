import { YomizakaLogo } from "@krizaka/ui";
import { AuthLayout } from "@krizaka/ui/auth-layout";
import { Mascot } from "@krizaka/ui/mascots";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignUpForm } from "@/components/console/SignUpForm";
import { pageSession } from "@/lib/access";
import { env } from "@/lib/env";
import { asLocale, getDictionary } from "@/lib/i18n";
import { signupOpenNow } from "@/lib/settings/signup";
import { PRODUCT_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDictionary(asLocale((await params).locale));
  return { title: t.console.signUp.title, robots: { index: false, follow: false } };
}

/** Sign-up on @krizaka/ui's auth template. The page only reflects the server: it is closed unless the server says it is open. */
export default async function SignUpPage({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  if (await pageSession().catch(() => null)) redirect(`/${locale}/app`);
  const t = getDictionary(locale).console.signUp;
  const open = await signupOpenNow(env());
  return (
    <AuthLayout
      brand={
        <Link href={`/${locale}`} className="inline-flex items-center gap-2">
          <YomizakaLogo size={28} /> {PRODUCT_NAME}
        </Link>
      }
      promise={t.promise}
      aside={<Mascot bird="owl" mood="welcome" size={72} />}
      asideFooter={t.notice}
      title={open ? t.title : t.closedTitle}
      description={open ? t.description : t.closed}
      footer={
        <Link className="font-semibold text-fg-accent" href={`/${locale}/sign-in`}>
          {t.haveAccount}
        </Link>
      }
    >
      {open ? <SignUpForm /> : null}
    </AuthLayout>
  );
}
