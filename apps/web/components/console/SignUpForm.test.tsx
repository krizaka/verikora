import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { SignUpForm } from "./SignUpForm";

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const draw = (node: React.ReactNode, locale: "en" | "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>{node}</KrizakaQueryProvider>
    </I18nProvider>,
  );
const INVITATION = { token: "yi1." + "A".repeat(43), email: "gestion@exemple.test" };

describe("the sign-up form (krizaka-internal#3230)", () => {
  it("with an invitation: the invited address, locked and said so; no pilot code field", () => {
    for (const locale of ["fr", "en"] as const) {
      const html = draw(<SignUpForm invitation={INVITATION} />, locale);
      expect(html).toMatch(/<input[^>]*value="gestion@exemple\.test"[^>]*>/);
      expect(html).toMatch(/<input[^>]*disabled=""[^>]*type="email"|<input[^>]*type="email"[^>]*disabled=""/);
      expect(html).toContain(MESSAGES[locale].console.signUp.invitedEmailHint.replaceAll("'", "&#x27;"));
      expect(html).not.toContain(MESSAGES[locale].console.signUp.pilotCode);
      expect(html).not.toContain(INVITATION.token);
    }
  });

  it("without one: an empty address to type and the optional pilot code", () => {
    const html = draw(<SignUpForm />, "en");
    expect(html).toContain(en.console.signUp.pilotCode);
    expect(html).not.toContain(en.console.signUp.invitedEmailHint);
    expect(html).not.toMatch(/<input[^>]*type="email"[^>]*disabled=""/);
  });
});
