import { YomizakaLogo } from "@krizaka/ui";
import { AuthLayout } from "@krizaka/ui/auth-layout";
import { Mascot } from "@krizaka/ui/mascots";
import Link from "next/link";
import type { ReactNode } from "react";

import { getDictionary, type Locale } from "@/lib/i18n";
import { PRODUCT_NAME } from "@/lib/brand";

/** The frame of the sign-in family — sign-in, forgot password, new password: Yomizaka's mark, the owl large and the three proofs. */
export function AuthShell({
  locale,
  promise,
  title,
  description,
  footer,
  legal,
  children,
}: Readonly<{
  locale: Locale;
  promise: string;
  title: string;
  description: string;
  footer: ReactNode;
  legal?: ReactNode;
  children: ReactNode;
}>) {
  const t = getDictionary(locale).console.signIn;
  return (
    <AuthLayout
      brand={
        <Link href={`/${locale}`} className="inline-flex items-center gap-2">
          <YomizakaLogo size={28} /> {PRODUCT_NAME}
        </Link>
      }
      promise={promise}
      aside={
        <>
          <Mascot bird="owl" mood="welcome" size={160} />
          <ul className="mt-6 grid gap-2">
            <li>{t.proofOne}</li>
            <li>{t.proofTwo}</li>
            <li>{t.proofThree}</li>
          </ul>
        </>
      }
      title={title}
      description={description}
      footer={footer}
      legal={legal}
    >
      {children}
    </AuthLayout>
  );
}
