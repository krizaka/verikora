import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { LibraryView } from "./LibraryView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => "/fr/app",
  useSearchParams: () => new URLSearchParams(),
}));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
/** The text of some markup, scanned (no regular expression strips tags): each tag becomes `gap`, a `<style>` element is dropped whole. */
function flatten(html: string, gap: string): string {
  let out = "";
  let i = 0;
  while (i < html.length) {
    if (html[i] !== "<") {
      out += html[i++];
      continue;
    }
    const end = html.indexOf(">", i);
    if (end < 0) break;
    const name = html
      .slice(i + 1, end)
      .split(/[\s/>]/)[0]
      ?.toLowerCase();
    i = name === "style" ? html.indexOf("</style>", end) + "</style>".length : end + 1;
    out += gap;
  }
  return out;
}
const readable = (html: string) =>
  flatten(html, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
const collection = (patch: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "My documents",
  files: 2,
  folders: 0,
  tags: [],
  isDefault: true,
  avatar: null,
  description: null,
  lastCheck: { at: "2026-10-20T15:00:00.000Z", status: "attention" },
  ...patch,
});
const EXAMPLES = {
  tenant: { title: "Bail locataire", filename: "bail-locataire.txt", text: "…" },
  landlord: { title: "Bail propriétaire", filename: "bail-proprietaire.txt", text: "…" },
};
const render = (props: Record<string, unknown>, locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>
        <LibraryView
          libraries={[{ id: "l1", name: "Ma bibliothèque", collections: [collection()] }] as never}
          documents={1}
          examples={EXAMPLES}
          {...(props as object)}
        />
      </KrizakaQueryProvider>
    </I18nProvider>,
  );

const file = (patch: Record<string, unknown> = {}) => ({
  id: "f1",
  candidateName: "Camille Roy",
  status: "used",
  createdAt: "2026-10-18T10:00:00.000Z",
  expiresAt: "2026-11-18T10:00:00.000Z",
  submittedAt: "2026-10-25T10:00:00.000Z",
  closedAt: null,
  documents: 3,
  requested: 3,
  decision: "to_decide",
  tagIds: [],
  ...patch,
});

describe("the home (krizaka-internal#1898)", () => {
  it("is titled « Accueil » / « Home », with one h1", () => {
    const html = render({});
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Accueil</);
    expect(render({}, "en")).toMatch(/<h1[^>]*>Home</);
  });

  it("offers « Vérifier un document » as a button before the drop zone (krizaka-internal#2001), in both languages", () => {
    const html = render({});
    expect(html).toMatch(/<a [^>]*data-testid="home-check-button"[^>]*href="\/fr\/app\/check"/);
    expect(html.indexOf('data-testid="home-check-button"')).toBeLessThan(
      html.indexOf('data-testid="library-dropzone"'),
    );
    expect(readable(html)).toContain(fr.console.shell.checkAction);
    expect(readable(render({}, "en"))).toContain(en.console.shell.checkAction);
  });

  it("offers « Vérifier un document » first: the drop zone is on the home, before the dossiers", () => {
    const html = render({});
    expect(html.match(/data-testid="library-dropzone"/g)).toHaveLength(1);
    expect(html.indexOf('data-testid="home-check"')).toBeLessThan(html.indexOf('data-testid="home-dossiers"'));
    expect(readable(html)).toContain(fr.console.home.check.title);
    expect(readable(render({}, "en"))).toContain(en.console.home.check.title);
  });

  it("lists the dossiers as one list: the collection (its last status) and the applicant file (its state), each row a link", () => {
    const html = render({ files: [file()], screening: true });
    const text = readable(html);
    expect(text).toContain("Mes documents");
    expect(text).toContain("Camille Roy");
    expect(html).toContain('href="/fr/app/library/l1/c1"');
    expect(html).toContain('href="/fr/app/dossiers/f1"');
    expect(text).toContain(fr.console.statuses.attention);
    expect(text).toContain(fr.console.dossiers.filter.states.used);
    expect(html.match(/data-testid="home-dossiers"/g)).toHaveLength(1);
  });

  it("has no activity wall, no binder tabs, no latest-checks block", () => {
    const html = render({});
    for (const gone of ["activity", "binder", "latest-checks", "collection-card"]) {
      expect(html).not.toContain(`data-testid="${gone}"`);
    }
  });

  it("says the plan and usage as one line leading to the plans", () => {
    const html = render({ credits: { kind: "pro", used: 12, cap: 100, renewsAt: null, cancelled: false } });
    expect(html.match(/data-testid="credits"/g)).toHaveLength(1);
    expect(readable(html)).toContain("12 sur 100");
    expect(html).toContain('href="/fr/app/plans"');
  });

  it("keeps a sticky « Vérifier un document » for a phone, and links the batch import quietly", () => {
    const html = render({});
    expect(html).toContain('href="/fr/app/check"');
    expect(html).toContain('data-testid="home-import"');
  });

  it("with nothing yet: the owl, one sentence, the only drop zone and the two examples", () => {
    const html = render({
      documents: 0,
      libraries: [{ id: "l1", name: "L", collections: [collection({ files: 0, lastCheck: null })] }],
    });
    expect(html).toContain('data-testid="library-empty"');
    expect(readable(html)).toContain(fr.console.library.emptyPitch);
    expect(html.match(/data-testid="library-dropzone"/g)).toHaveLength(1);
    expect(html).toContain('data-testid="library-examples"');
    expect(html).not.toContain('data-testid="home-dossiers"');
  });

  it("keeps a collection the person made reachable even with no document yet (no empty state over it)", () => {
    const html = render({
      documents: 0,
      libraries: [
        {
          id: "l1",
          name: "L",
          collections: [
            collection({ id: "c9", name: "Immeuble Laurier", isDefault: false, files: 0, lastCheck: null }),
          ],
        },
      ],
    });
    expect(html).not.toContain('data-testid="library-empty"');
    expect(readable(html)).toContain("Immeuble Laurier");
  });
});
