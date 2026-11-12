import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { profileDirty, profilePatch, ProfileSection, type ProfileValues, undoable } from "./ProfileSection";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/fr/app/settings/profil",
  useSearchParams: () => new URLSearchParams(),
}));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const readable = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
const SAVED: ProfileValues = {
  name: "Éric Tremblay",
  avatarSeed: "plain-2",
  locale: "fr",
  perspective: "landlord",
  territory: "QC",
};
const AUDIENCES = [
  { audience: "tenant", status: "available" },
  { audience: "landlord", status: "available" },
  { audience: "freelancer", status: "soon" },
] as const;
const render = (locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>
        <ProfileSection initial={SAVED} audiences={AUDIENCES} />
      </KrizakaQueryProvider>
    </I18nProvider>,
  );

describe("the profile is one section with one save (the review's E2)", () => {
  it("is dirty only when something differs from what is saved — spaces around the name do not count", () => {
    expect(profileDirty(SAVED, { ...SAVED })).toBe(false);
    expect(profileDirty(SAVED, { ...SAVED, name: "  Éric Tremblay " })).toBe(false);
    expect(profileDirty(SAVED, { ...SAVED, name: "Éric" })).toBe(true);
    expect(profileDirty(SAVED, { ...SAVED, avatarSeed: "plain-4" })).toBe(true);
    expect(profileDirty(SAVED, { ...SAVED, locale: "en" })).toBe(true);
    expect(profileDirty(SAVED, { ...SAVED, perspective: "tenant" })).toBe(true);
    expect(profileDirty(SAVED, { ...SAVED, territory: "FR" })).toBe(true);
  });

  it("sends the territory only when it moved, on its own call", () => {
    expect(profilePatch(SAVED, { ...SAVED, territory: "ZZ" })).toEqual({
      profile: null,
      perspective: null,
      territory: "ZZ",
    });
  });

  it("sends only the fields that changed — never the others, which another session may have edited — and the perspective when it moved", () => {
    expect(profilePatch(SAVED, { ...SAVED })).toEqual({ profile: null, perspective: null, territory: null });
    expect(profilePatch(SAVED, { ...SAVED, name: "  " })).toEqual({
      profile: { name: null },
      perspective: null,
      territory: null,
    });
    expect(profilePatch(SAVED, { ...SAVED, avatarSeed: "plain-4" })).toEqual({
      profile: { avatarSeed: "plain-4" },
      perspective: null,
      territory: null,
    });
    expect(profilePatch(SAVED, { ...SAVED, avatarSeed: "" })).toEqual({
      profile: { avatarSeed: null },
      perspective: null,
      territory: null,
    });
    expect(profilePatch(SAVED, { ...SAVED, locale: "en", perspective: "tenant" })).toEqual({
      profile: { locale: "en" },
      perspective: "tenant",
      territory: null,
    });
    expect(profilePatch(SAVED, { ...SAVED, name: " Éric Tremblay ", perspective: "tenant" })).toEqual({
      profile: null,
      perspective: "tenant",
      territory: null,
    });
  });

  it("undo puts the previous values back, except a first perspective the server cannot unset", () => {
    expect(undoable({ ...SAVED, perspective: "tenant" }, SAVED)).toBe(true);
    expect(undoable({ ...SAVED, name: "Éric" }, SAVED)).toBe(true);
    expect(undoable({ ...SAVED, perspective: null }, SAVED)).toBe(false);
    expect(undoable({ ...SAVED, perspective: null }, { ...SAVED, perspective: null })).toBe(true);
  });

  it("renders the four rows — name, picture, language, side of the lease — and exactly one save, in both languages", () => {
    const html = render();
    const text = readable(html);
    for (const word of [
      fr.console.settings.profile.nameLabel,
      fr.console.settings.profile.avatarLabel,
      fr.console.settings.profile.languageLabel,
      fr.console.profile.legend,
    ])
      expect(text).toContain(word);
    expect(html).toMatch(/<input [^>]*id="profile-name"[^>]*value="Éric Tremblay"/);
    expect(text).toContain("Français");
    expect(text).toContain("English");
    expect(text).toContain(fr.console.profile.landlord);
    expect(text).toContain(`${fr.console.profile.freelancer} (${fr.console.profile.soon})`);
    for (const code of ["QC", "FR", "BE-WAL", "ZZ"] as const) {
      expect(text).toContain(fr.console.settings.profile.territories[code]);
    }
    expect(html.match(/<button [^>]*type="submit"/g)).toHaveLength(1);
    expect(text).toContain(fr.console.settings.save.save);
    expect(html).toContain('data-testid="settings-profil"');
    const english = readable(render("en"));
    expect(english).toContain(en.console.settings.profile.nameLabel);
    expect(english).toContain("Français");
  });
});
