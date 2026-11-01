import { YomizakaLogo } from "@krizaka/ui";
import { AuthLayout } from "@krizaka/ui/auth-layout";
import { Badge } from "@krizaka/ui/badge";
import { Mascot } from "@krizaka/ui/mascots";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { SignInForm } from "@/components/console/SignInForm";
import { ipAllowed, pageAdmin } from "@/lib/access";
import { PRODUCT_NAME } from "@/lib/brand";
import { asLocale, getDictionary } from "@/lib/i18n";

/** The administration's own sign-in (its cookie belongs to admin.yomizaka.com), on @krizaka/ui's auth template. */
export default async function AdminSignIn({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  if (!ipAllowed(await headers())) notFound();
  if (await pageAdmin().catch(() => null)) redirect(`/${locale}`);
  const t = getDictionary(locale).console.adminConsole;
  return (
    <AuthLayout
      brand={
        <span className="inline-flex items-center gap-2">
          <YomizakaLogo size={28} /> {PRODUCT_NAME} <Badge tone="warning">{t.shell.dev}</Badge>
        </span>
      }
      promise={t.signIn.promise}
      aside={<Mascot bird="falcon" mood="welcome" size={72} />}
      asideFooter={t.signIn.asideFooter}
      title={t.signIn.title}
      description={t.signIn.description}
    >
      <SignInForm next={`/${locale}`} />
    </AuthLayout>
  );
}
