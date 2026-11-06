import { QueryClient, QueryClientProvider } from "@krizaka/query";
import { ThemeProvider } from "@krizaka/ui/theme";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const krizakaFetch = vi.fn();
vi.mock("@krizaka/query", async (original) => ({
  ...(await original<typeof import("@krizaka/query")>()),
  krizakaFetch: (...args: unknown[]) => krizakaFetch(...args),
}));

import fr from "@/messages/fr.json";

import {
  BarActions,
  BarActionsView,
  ClosingActionsView,
  ClosingBodyView,
  HeroActionsView,
  type Me,
  ME_KEY,
  meOf,
  signOutAndForget,
} from "./BarSession";
import { SiteHeader } from "./SiteChrome";

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");
const ME: Me = { email: "eric@example.test", name: "Éric", avatarSeed: null };
const view = (props: Partial<Parameters<typeof BarActionsView>[0]> = {}) =>
  renderToStaticMarkup(
    <BarActionsView locale="en" placement="bar" me={null} signupOpen={false} onSignOut={() => {}} {...props} />,
  );
const hero = (props: Partial<Parameters<typeof HeroActionsView>[0]> = {}) =>
  renderToStaticMarkup(
    <HeroActionsView locale="en" me={null} status="In development: sign-up is closed." {...props} />,
  );

beforeEach(() => {
  krizakaFetch.mockReset();
});

describe("the public bar knows who is signed in (verikora#243) — a quiet account entry, never the raw e-mail (the review's F0)", () => {
  it("signed in: the account (avatar, the name when there is one) with « My documents » inside; no primary button in the bar, no « Sign in »", () => {
    const html = view({ me: ME });
    expect(html).toContain('aria-label="Account"');
    expect(html).toContain('data-name="Éric"');
    expect(text(html)).not.toContain("Open my documents");
    expect(text(html)).not.toContain("Sign in");
    expect(html).not.toContain("eric@example.test");
  });

  it("signed in without a name: the avatar alone — the e-mail address is never shown in the bar", () => {
    const html = view({ me: { ...ME, name: null } });
    expect(html).toContain('aria-label="Account"');
    expect(html).not.toContain("data-name=");
    expect(html).not.toContain("eric@example.test");
  });

  it("signed out: « Sign in » while sign-up is closed; « Try Verikora » first, then « Sign in », once it is open", () => {
    expect(text(view())).toContain("Sign in");
    expect(text(view())).not.toContain("Try Verikora");
    const open = view({ signupOpen: true });
    expect(text(open)).toContain("Try Verikora");
    expect(text(open)).toContain("Sign in");
    expect(open).toContain('href="/en/sign-up"');
    expect(text(view({ locale: "fr" }))).toContain("Se connecter");
  });

  it("the mobile panel, a drawer, says it in full: « Open my documents » full width, no account menu", () => {
    const panel = view({ placement: "panel", me: ME });
    expect(text(panel)).toContain("Open my documents");
    expect(panel).toContain('href="/en/app"');
    expect(panel).not.toContain('aria-label="Account"');
    expect(text(view({ placement: "panel", me: ME, locale: "fr" }))).toContain("Ouvrir mes documents");
    expect(text(view({ placement: "panel" }))).toContain("Sign in");
  });

  it("the bar of every public page says no « Talk to us », in either language", () => {
    for (const locale of ["en", "fr"] as const) {
      const html = text(
        renderToStaticMarkup(
          <ThemeProvider>
            <SiteHeader locale={locale} current="home" />
          </ThemeProvider>,
        ),
      );
      expect(html).not.toMatch(/Talk to us|Nous parler|Contact us/);
    }
  });
});

describe("the hero's action reads the same answer (F0): rendered on the server in both states, never two truths on one screen", () => {
  it("signed in: « Open my documents » to the library, and no status line", () => {
    const html = hero({ me: ME });
    expect(html).toContain('data-session="in"');
    expect(html).toContain('href="/en/app"');
    expect(text(html)).toContain("Open my documents");
    expect(text(html)).not.toContain("Sign in");
    expect(html).not.toContain('data-testid="hero-status"');
    expect(text(hero({ me: ME, locale: "fr" }))).toContain("Ouvrir mes documents");
  });

  it("signed out: « Sign in » with the product's status line", () => {
    const html = hero();
    expect(html).toContain('data-session="out"');
    expect(html).toContain('href="/en/sign-in"');
    expect(text(html)).toContain("Sign in");
    expect(text(html)).toContain("In development: sign-up is closed.");
    expect(text(html)).not.toContain("Open my documents");
    expect(hero({ locale: "fr" })).toContain('href="/fr/sign-in"');
  });

  it("the bar and the hero use the same words for the way in, in both languages", async () => {
    const en = (await import("@/messages/en.json")).default;
    const fr = (await import("@/messages/fr.json")).default;
    expect(en.landing.openApp).toBe(en.chrome.openApp);
    expect(fr.landing.openApp).toBe(fr.chrome.openApp);
  });
});

describe("the hint comes from the server, never from the browser's memory", () => {
  it("reads the identity from the family's /api/me query", () => {
    expect(ME_KEY).toEqual(["krizaka", "session", "/api/me"]);
  });

  it("pending is neither state; an answer is the person or signed out", () => {
    expect(meOf({ status: "pending" })).toEqual({ pending: true, me: null });
    expect(meOf({ status: "in", account: ME, signupOpen: false })).toEqual({ pending: false, me: ME });
    expect(meOf({ status: "out", signupOpen: true })).toEqual({ pending: false, me: null });
  });

  it("signing out forgets the person at once — even when the call fails", async () => {
    const signedOut = { signedIn: false, signupOpen: false };
    const cache = new Map<string, unknown>([[ME_KEY.join(), ME]]);
    const client = {
      setQueryData: (key: readonly string[], value: typeof signedOut) => void cache.set(key.join(), value),
    };
    await signOutAndForget(client, async () => undefined);
    expect(cache.get(ME_KEY.join())).toEqual(signedOut);
    cache.set(ME_KEY.join(), ME);
    await expect(signOutAndForget(client, async () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
    expect(cache.get(ME_KEY.join())).toEqual(signedOut);
  });
});

describe("the bar's first render matches the session (krizaka-ui#800)", () => {
  const bar = (prime?: (client: QueryClient) => void) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    prime?.(client);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <BarActions locale="en" placement="bar" />
      </QueryClientProvider>,
    );
  };

  it("not known yet: neither « Sign in » nor the account (a signed-in person never sees the bar flash signed out)", () => {
    const html = bar();
    expect(html).toContain('data-session="pending"');
    expect(text(html)).not.toContain("Sign in");
    expect(html).not.toContain('aria-label="Account"');
  });

  it("known and signed in: the very first render is the account", () => {
    const html = bar((c) => c.setQueryData(ME_KEY, { signedIn: true, signupOpen: false, account: ME }));
    expect(html).toContain('aria-label="Account"');
    expect(text(html)).not.toContain("Sign in");
  });

  it("known and signed out: the very first render is « Sign in »", () => {
    const html = bar((c) => c.setQueryData(ME_KEY, { signedIn: false, signupOpen: false }));
    expect(text(html)).toContain("Sign in");
    expect(html).not.toContain('aria-label="Account"');
  });
});

describe("the closing call follows the session like the hero (the UX review's Y9)", () => {
  const me = { id: "a1", email: "eric@example.test", name: "Éric" } as unknown as Me;
  it("signed out: the way in, secondary, and the sentence that invites; signed in: the documents and the sentence that says where they are", () => {
    const out = renderToStaticMarkup(<ClosingActionsView locale="fr" me={null} />);
    expect(out).toContain('data-session="out"');
    expect(out).toContain('href="/fr/sign-in"');
    expect(out).toContain(fr.landing.signIn);
    expect(out).not.toContain("primary");
    const inn = renderToStaticMarkup(<ClosingActionsView locale="fr" me={me} />);
    expect(inn).toContain('data-session="in"');
    expect(inn).toContain('href="/fr/app"');
    expect(inn).toContain(fr.landing.openApp);
    expect(inn).not.toContain("eric@");
    expect(renderToStaticMarkup(<ClosingBodyView me={null} signedOut="Out." signedIn="In." />)).toContain("Out.");
    expect(renderToStaticMarkup(<ClosingBodyView me={me} signedOut="Out." signedIn="In." />)).toContain("In.");
  });
});
