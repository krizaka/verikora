import { VerikoraLogo } from "@krizaka/ui";
import { AuthLayout } from "@krizaka/ui/auth-layout";
import { Mascot } from "@krizaka/ui/mascots";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignUpForm, type SignUpInvitation } from "@/components/console/SignUpForm";
import { pageSession } from "@/lib/access";
import { PRODUCT_NAME } from "@/lib/brand";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { asLocale, getDictionary } from "@/lib/i18n";
import { limit } from "@/lib/limits";
import { signupOpenNow } from "@/lib/settings/signup";
import { peekInvitation } from "@/lib/signup-invitation";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDictionary(asLocale((await params).locale));
  return { title: t.console.signUp.title, robots: { index: false, follow: false } };
}

/** The invitation of `?invite=`, read on the server (rate-limited per address): the token and its address, or `"invalid"` for a link that opens nothing. */
async function invitationOf(token: string | undefined): Promise<SignUpInvitation | "invalid" | null> {
  if (token === undefined) {
    return null;
  }
  try {
    await limit("invitePeek", { headers: await headers() }, null);
  } catch (error) {
    if (error instanceof HttpError) {
      return "invalid";
    }
    throw error;
  }
  const found = await peekInvitation(query, token, new Date());
  return found ? { token, email: found.email } : "invalid";
}

/**
 * Sign-up on @krizaka/ui's auth template. The page only reflects the server: it is closed unless the server says it is open, or the link carries a valid invitation
 * (krizaka-internal#3230), which opens the form for the invited address only. A link that opens nothing says so in one message, whichever the reason.
 */
export default async function SignUpPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ locale: string }>; searchParams: Promise<{ invite?: string | string[] }> }>) {
  const locale = asLocale((await params).locale);
  if (await pageSession().catch(() => null)) redirect(`/${locale}/app`);
  const t = getDictionary(locale).console.signUp;
  const { invite } = await searchParams;
  const invitation = await invitationOf(Array.isArray(invite) ? invite[0] : invite);
  const view = await viewOf(t, invitation);
  return (
    <AuthLayout
      brand={
        <Link href={`/${locale}`} className="inline-flex items-center gap-2">
          <VerikoraLogo size={28} /> {PRODUCT_NAME}
        </Link>
      }
      promise={t.promise}
      aside={<Mascot bird="owl" mood="welcome" size={72} />}
      asideFooter={t.notice}
      title={view.title}
      description={view.description}
      footer={
        <Link className="font-semibold text-fg-accent" href={`/${locale}/sign-in`}>
          {t.haveAccount}
        </Link>
      }
    >
      {view.form}
    </AuthLayout>
  );
}

type Words = ReturnType<typeof getDictionary>["console"]["signUp"];

/** What the page shows: an invitation's form, its one refusal, the open form, or the closed message. */
async function viewOf(t: Words, invitation: SignUpInvitation | "invalid" | null) {
  if (invitation === "invalid") {
    return { title: t.inviteInvalidTitle, description: t.inviteInvalid, form: null };
  }
  if (invitation) {
    return { title: t.invitedTitle, description: t.invited, form: <SignUpForm invitation={invitation} /> };
  }
  const open = await signupOpenNow(env());
  return open
    ? { title: t.title, description: t.description, form: <SignUpForm /> }
    : { title: t.closedTitle, description: t.closed, form: null };
}
