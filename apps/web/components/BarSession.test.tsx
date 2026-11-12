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

import { BarActions, BarActionsView, type Me, ME_KEY, meOf, signOutAndForget } from "./BarSession";
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
