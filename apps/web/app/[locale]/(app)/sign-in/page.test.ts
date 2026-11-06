import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

const state = vi.hoisted(() => ({ open: false, mail: true }));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/access", () => ({ pageSession: async () => null }));
vi.mock("@/app/accounts-edge", () => ({ mailConfigured: () => state.mail }));
vi.mock("@/lib/env", () => ({ env: () => ({}) }));
vi.mock("@/lib/settings/signup", () => ({ signupOpenNow: async () => state.open }));
vi.mock("@/components/console/SignInForm", () => ({ SignInForm: () => null }));

import SignInPage from "./page";

const MESSAGES = { en, fr } as const;
type Locale = keyof typeof MESSAGES;

const render = async (locale: Locale, query: { verified?: string; verify?: string; reset?: string } = {}) =>
  renderToStaticMarkup(await SignInPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(query) }));

const readable = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");

describe("sign-in (the UX review's Y8)", () => {
  beforeEach(() => {
    state.open = false;
    state.mail = true;
  });

  it("draws the owl large (160 px) and the three proofs in the brand panel, in each language", async () => {
    for (const locale of ["fr", "en"] as const) {
      const html = await render(locale);
      expect(html).toMatch(/width="160"/);
      const text = readable(html);
      for (const key of ["proofOne", "proofTwo", "proofThree"] as const) {
        expect(text).toContain(MESSAGES[locale].console.signIn[key]);
      }
    }
  });

  it("says sign-up is closed when the setting is off, and offers the account link only when it is open", async () => {
    state.open = false;
    const closed = readable(await render("fr"));
    expect(closed).toContain(fr.console.signIn.closedTitle);
    expect(closed).toContain(fr.console.signIn.closed);
    expect(closed).not.toContain(fr.console.signIn.signUpLink);

    state.open = true;
    const open = readable(await render("fr"));
    expect(open).toContain(fr.console.signIn.signUpLink);
    expect(open).not.toContain(fr.console.signIn.closedTitle);
  });

  it("makes only the claims the deployment keeps: no residency promise (dev stores in New York), and the report language stated as it is", () => {
    // Regression (krizaka/verikora#297 review): dev.app.yaml stores documents on ny.storage.bunnycdn.com, so « stay in Canada » was false here.
    expect(en.console.signIn.proofTwo).not.toMatch(/Canada|Canadian/);
    expect(fr.console.signIn.proofTwo).not.toMatch(/Canada|Canad/);
    // Regression: lib/report.ts keeps Sovkora's French titles and explanations, even for an English export.
    expect(en.console.signIn.proofThree).not.toMatch(/English/);
    expect(fr.console.signIn.proofThree).not.toMatch(/anglais/);
  });

  it("shows the confirmation notice, or the error notice for an invalid or expired link", async () => {
    const ok = readable(await render("en", { verified: "1" }));
    expect(ok).toContain(en.console.signIn.verifiedNotice);
    expect(ok).not.toContain(en.console.signIn.invalidNotice);

    const bad = readable(await render("en", { verify: "1" }));
    expect(bad).toContain(en.console.signIn.invalidNotice);
    expect(bad).not.toContain(en.console.signIn.verifiedNotice);
  });

  it("offers « Forgot your password? » to the page that asks for it, in each language — and only while e-mail can be sent", async () => {
    for (const locale of ["fr", "en"] as const) {
      const html = await render(locale);
      expect(html).toContain(`href="/${locale}/forgot-password"`);
      expect(readable(html)).toContain(MESSAGES[locale].console.signIn.forgotLink);
    }
    state.mail = false;
    expect(await render("en")).not.toContain("/forgot-password");
  });

  it("tells the person their password is changed when they come back from the reset", async () => {
    expect(readable(await render("en", { reset: "1" }))).toContain(en.console.signIn.resetNotice);
    expect(readable(await render("fr", { reset: "1" }))).toContain(fr.console.signIn.resetNotice);
    expect(readable(await render("en"))).not.toContain(en.console.signIn.resetNotice);
  });
});
