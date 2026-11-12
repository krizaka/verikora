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

const check = (patch: Record<string, unknown> = {}) => ({
  id: "a1",
  documentId: "d1",
  title: "Bail Laurier",
  kind: "lease",
  studio: "compliance-check",
  result: "attention",
  runId: "run1",
  at: "2026-10-26T10:00:00.000Z",
  ...patch,
});

describe("the home (krizaka-internal#1898)", () => {
  it("is titled « Accueil » / « Home », with one h1", () => {
    const html = render({});
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Accueil</);
    expect(render({}, "en")).toMatch(/<h1[^>]*>Home</);
  });

  it("has one primary « Vérifier un document » (the header's): no second button, no drop zone, the drop overlay stays", () => {
    const html = render({ files: [file()], screening: true });
    expect(html).not.toContain('data-testid="home-check-button"');
    expect(html).not.toContain('data-testid="library-dropzone"');
    expect(html).not.toContain('data-testid="library-examples"');
    expect(readable(html)).not.toContain("Choisir des fichiers");
  });

  it("leads with the new sentence under « Accueil », in both languages", () => {
    expect(readable(render({}))).toContain(fr.console.home.check.lead);
    expect(readable(render({}, "en"))).toContain(en.console.home.check.lead);
    expect(fr.console.home.check.lead).toContain("pièce de dossier");
  });

  it("shows the applicant files first, before « Mes documents », each row a link to its file", () => {
    const html = render({ files: [file()], screening: true });
    const text = readable(html);
    expect(html.indexOf('data-testid="home-files"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="home-files"')).toBeLessThan(html.indexOf('data-testid="home-dossiers"'));
    expect(text).toContain(fr.console.home.files.title);
    expect(text).toContain("Camille Roy");
    expect(text).toContain("3 sur 3 reçus");
    expect(text).toContain(fr.console.dossiers.filter.states.used);
    expect(html).toContain('href="/fr/app/dossiers/f1"');
    expect(text).toContain(fr.console.dossiers.request);
  });

  it("lists five applicant files at most and links to all of them", () => {
    const many = Array.from({ length: 7 }, (_, i) => file({ id: `f${i}`, candidateName: `Candidat ${i}` }));
    const html = render({ files: many, screening: true });
    const section = html.slice(html.indexOf('data-testid="home-files"'), html.indexOf('data-testid="home-todo"'));
    expect(section.match(/href="\/fr\/app\/dossiers\/f\d"/g)).toHaveLength(5);
    expect(html.slice(html.indexOf('data-testid="home-todo"')).match(/href="\/fr\/app\/dossiers\/f\d"/g)).toHaveLength(
      5,
    );
    expect(readable(html)).toContain(fr.console.home.files.all);
  });

  it("has no applicant section for a role not offered the flow, and keeps the collections", () => {
    const html = render({});
    expect(html).not.toContain('data-testid="home-files"');
    expect(html).toContain('href="/fr/app/library/l1/c1"');
    expect(readable(html)).toContain(fr.console.statuses.attention);
    expect(html.match(/data-testid="home-dossiers"/g)).toHaveLength(1);
  });

  it("has no activity wall and no binder tabs", () => {
    const html = render({});
    for (const gone of ["activity", "binder", "collection-card"]) {
      expect(html).not.toContain(`data-testid="${gone}"`);
    }
  });

  it("lists « À traiter » (files to decide, checks to look at) and « Dernières vérifications », in both languages", () => {
    const html = render({
      files: [file()],
      checks: [check(), check({ id: "a2", title: "Bail OK", result: "checked" })],
      screening: true,
    });
    const text = readable(html);
    expect(text).toContain(fr.console.home.treat.title);
    expect(text).toContain(fr.console.home.latest.title);
    expect(html).toContain('data-testid="home-todo"');
    expect(html.match(/href="\/fr\/app\/documents\/d1\/rapport"/g)).toHaveLength(3);
    expect(html.indexOf('data-testid="home-files"')).toBeLessThan(html.indexOf('data-testid="home-todo"'));
    expect(html.indexOf('data-testid="home-todo"')).toBeLessThan(html.indexOf('data-testid="home-dossiers"'));
    expect(html.indexOf('data-testid="home-dossiers"')).toBeLessThan(html.indexOf('data-testid="home-latest-checks"'));
    expect(html).toContain("lg:grid-cols-3");
    // One shrinkable column on a phone (krizaka-internal#2290): a long name wraps inside 360 px, the page never scrolls sideways.
    expect(html).toContain("grid grid-cols-1");
    expect(html.match(/class="min-w-0 lg:col-span-2/g)).toHaveLength(3);
    expect(readable(render({ files: [file()], checks: [check()] }, "en"))).toContain(en.console.home.latest.title);
    expect(readable(render({}, "en"))).toContain(en.console.home.treat.title);
  });

  it("says so, honestly, when nothing waits and no check ran", () => {
    const text = readable(render({ files: [file({ status: "closed" })], screening: true }));
    expect(text).toContain(fr.console.home.treat.empty);
    expect(text).toContain(fr.console.home.latest.empty);
  });

  it("lists five latest checks at most", () => {
    const many = Array.from({ length: 8 }, (_, i) => check({ id: `a${i}`, documentId: `d${i}`, result: "checked" }));
    const html = render({ checks: many });
    expect(html.match(/href="\/fr\/app\/documents\/d\d\/rapport"/g)).toHaveLength(5);
  });

  it("says the plan and usage as one line leading to the plans", () => {
    const html = render({ credits: { kind: "pro", used: 12, cap: 100, renewsAt: null, cancelled: false } });
    expect(html.match(/data-testid="credits"/g)).toHaveLength(1);
    expect(readable(html)).toContain("12 sur 100");
    expect(html).toContain('href="/fr/app/plans"');
  });

  it("links the batch import quietly", () => {
    expect(render({})).toContain('data-testid="home-import"');
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
