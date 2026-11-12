"use client";

import type { MeAccount } from "@krizaka/auth/contract";
import { HomeIcon, LogoutIcon, SettingsIcon } from "@krizaka/icons";
import { krizakaFetch, KrizakaQueryProvider, useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { AccountMenu } from "@krizaka/ui/account-menu";
import { Button } from "@krizaka/ui/button";
import { type NavSession, ProductBarActions, sessionKey, useNavSession, useSessionHint } from "@krizaka/ui/nav-bar";
import Link from "next/link";
import { z } from "zod";

import { BRAND_ID } from "@/lib/brand";
import { type Locale, translator } from "@/lib/i18n";
import { signInPath } from "@/lib/nav";

/**
 * The public site knows who is signed in (verikora#243) without the pages stopping being static: a small client island asks
 * `/api/me` (`signedIn: false` = signed out) and `/api/auth/sign-up/status`. What it learns only changes what the page SHOWS — the bar's
 * account and the hero's action — never what anyone may do: the app and the API check the real session on every request.
 * The bar and the hero read the same answer (one `BarQueryRoot` around the page), so they never disagree (the review's F0).
 */
export const ME_ENDPOINT = "/api/me";
/** The family's one session query (`@krizaka/ui/nav-bar`): the bar, the hero and the closing call read it, so they never disagree (krizaka-ui#800). */
export const ME_KEY = sessionKey(ME_ENDPOINT);
export type Me = Pick<MeAccount, "email" | "name" | "avatarSeed">;

/** Signing out: the server ends the session, and whatever the page remembered is dropped at once. */
export async function signOutAndForget(
  client: { setQueryData: (key: readonly string[], value: { signedIn: false; signupOpen: boolean }) => void },
  post: () => Promise<unknown>,
): Promise<void> {
  try {
    await post();
  } finally {
    client.setQueryData(ME_KEY, { signedIn: false, signupOpen: false });
  }
}

export function BarQueryRoot({ children }: Readonly<{ children: React.ReactNode }>) {
  return <KrizakaQueryProvider>{children}</KrizakaQueryProvider>;
}

/**
 * What the page knows of the visitor: `pending` until `/api/me` answers (the bar then draws neither state), the person once it did,
 * and the LAST KNOWN state when a refetch fails or is throttled: only an answer signs anyone out (krizaka-ui#800).
 */
export const meOf = (session: NavSession<Me>): { pending: boolean; me: Me | null } => ({
  pending: session.status === "pending",
  me: session.status === "in" ? session.account : null,
});
const useMe = () => meOf(useNavSession<Me>(ME_ENDPOINT));

/**
 * What the bar's actions look like, from what is known; the container below only fetches. Signed in, the bar keeps a quiet
 * account entry — the avatar and the name when there is one, never the raw e-mail address — and the hero carries the one
 * primary action, « Ouvrir mes documents »; the mobile panel, a drawer, says it in full.
 */
export function BarActionsView({
  locale,
  placement,
  me,
  signupOpen,
  onSignOut,
}: Readonly<{
  locale: Locale;
  placement: "bar" | "panel";
  me: Me | null;
  signupOpen: boolean;
  onSignOut: () => void;
}>) {
  const t = translator(locale);
  if (me) {
    const app = `/${locale}/app`;
    if (placement === "panel") {
      return (
        <Button asChild variant="primary" size="md" shape="cut" className="mt-2 w-full font-bold">
          <Link href={app}>{t("chrome.openApp")}</Link>
        </Button>
      );
    }
    return (
      <AccountMenu
        label={t("chrome.account")}
        name={me.name ?? undefined}
        email={me.email}
        showName={Boolean(me.name)}
        avatar={{
          defaultAvatar: { brand: BRAND_ID, seed: me.avatarSeed ?? me.email },
          fallback: (me.name ?? me.email).charAt(0).toUpperCase(),
        }}
        linkAs={Link}
        links={[
          { id: "documents", label: t("chrome.myDocuments"), href: app, icon: <HomeIcon size={16} /> },
          { id: "account", label: t("chrome.settings"), href: `${app}/settings`, icon: <SettingsIcon size={16} /> },
        ]}
        signOut={{ label: t("chrome.signOut"), onSelect: onSignOut, icon: <LogoutIcon size={16} /> }}
      />
    );
  }
  return (
    <ProductBarActions
      placement={placement}
      linkAs={Link}
      signupOpen={signupOpen}
      signIn={{ href: signInPath(locale), label: t("chrome.signIn") }}
      tryIt={{ href: `/${locale}/sign-up`, label: t("chrome.tryIt") }}
    />
  );
}

const signupStatus = z.object({ open: z.boolean() });

export function BarActions({ locale, placement }: Readonly<{ locale: Locale; placement: "bar" | "panel" }>) {
  const client = useQueryClient();
  const { pending, me } = useMe();
  const hinted = useSessionHint();
  const signup = useQuery({
    queryKey: ["signup-status"],
    queryFn: () =>
      krizakaFetch("/api/auth/sign-up/status", { schema: signupStatus }).then(
        (r) => r.open,
        () => false,
      ),
    staleTime: 60_000,
    retry: false,
    throwOnError: false,
  });
  const signOut = useMutation({
    mutationFn: () => signOutAndForget(client, () => krizakaFetch("/api/auth/sign-out", { method: "POST" })),
  });
  // Neither « Sign in » nor the avatar until the session is known: a signed-in person never sees the bar flash signed out.
  // With the proxy's hint (a session cookie exists, krizaka-ui#827) the reserved place is the account's own size.
  if (pending)
    return (
      <span
        data-testid="bar-session"
        data-session="pending"
        data-hint={hinted ? "signed-in" : undefined}
        aria-hidden="true"
        className={hinted ? "inline-block size-9 rounded-full bg-fg-secondary/20" : "inline-block h-9 min-w-24"}
      />
    );
  return (
    <BarActionsView
      locale={locale}
      placement={placement}
      me={me}
      signupOpen={signup.data ?? false}
      onSignOut={() => signOut.mutate()}
    />
  );
}
