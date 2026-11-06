import { readFileSync } from "node:fs";

import { KrizakaQueryProvider } from "@krizaka/query";
import type { DocumentSummary } from "@verikora/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import { parseView } from "@/lib/organisation/rules";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { PlaceView } from "./PlaceView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/fr/app/library/l1/c1",
  useSearchParams: () => new URLSearchParams(""),
}));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const readable = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
const doc = (n: number): DocumentSummary => ({
  id: `d${n}`,
  title: `Bail ${n}`,
  filename: `bail-${n}.pdf`,
  mimeType: "application/pdf",
  kind: "lease",
  sizeBytes: 1000,
  pages: 1,
  hasText: true,
  status: "checked",
  createdAt: "2026-10-20T12:00:00.000Z",
});
const folder = (id: string, name: string, files: number) =>
  ({ id, name, files, tags: [], collection_id: "c1", owner_id: "o1", created_at: "2026-10-01T00:00:00.000Z" }) as never;
const PATH = "/fr/app/library/l1/c1";
type Props = Partial<Parameters<typeof PlaceView>[0]>;
const render = (props: Props = {}, locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>
        <PlaceView
          locale={locale}
          t={MESSAGES[locale].console.organisation as never}
          library={{ id: "l1", name: "Ma bibliothèque" }}
          collection={{ id: "c1", name: "Rosemont", isDefault: false, avatar: null }}
          folders={[folder("f1", "Baux", 3), folder("f2", "Factures", 1)]}
          documents={[doc(1), doc(2)]}
          tags={[]}
          documentTags={[]}
          view={parseView({})}
          tagsByDocument={{}}
          collections={[{ id: "c1", name: "Rosemont", avatar: null }]}
          collectionTags={[]}
          path={PATH}
          {...props}
        />
      </KrizakaQueryProvider>
    </I18nProvider>,
  );

describe("a collection (the UX review's Y7)", () => {
  it("has a breadcrumb whose root is the library and whose last crumb is this place, and one h1 that names it", () => {
    const html = render();
    expect(html).toContain('aria-label="breadcrumb"');
    expect(html).toContain('href="/fr/app"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const text = readable(html);
    expect(text).toContain(fr.console.organisation.library);
    expect(html).toMatch(/aria-current="page"[^>]*>Rosemont</);
  });

  it("says what is here under the name — the counts with their plurals — in both languages", () => {
    expect(readable(render())).toContain("2 dossiers · 2 fichiers");
    expect(readable(render({ folders: [folder("f1", "Baux", 3)], documents: [doc(1)] }))).toContain(
      "1 dossier · 1 fichier",
    );
    expect(readable(render({}, "en"))).toContain("2 folders · 2 files");
  });

  it("offers « Ajouter des documents » (the page's picker), a new folder and the collection's menu in the header; a folder's page carries the folder's menu", () => {
    const html = render();
    expect(html).toContain('data-testid="add-files"');
    expect(readable(html)).toContain(fr.console.organisation.addDocuments);
    expect(readable(html)).toContain(fr.console.organisation.newFolder);
    expect(html).toContain(fr.console.organisation.actions.replace("{name}", "Rosemont"));
    const inFolder = render({ folder: { id: "f1", name: "Baux" }, documents: [doc(1)] });
    expect(inFolder).toContain(fr.console.organisation.actions.replace("{name}", "Baux"));
    expect(inFolder).not.toContain(fr.console.organisation.actions.replace("{name}", "Rosemont"));
    expect(inFolder).not.toContain('data-testid="folder-chips"');
    expect(readable(inFolder)).toContain("1 fichier");
    expect(readable(inFolder)).not.toContain("dossier ·");
  });

  it("draws the folders as a row of chips with their counts — never a grid of cards", () => {
    const html = render();
    expect(html).toContain('data-testid="folder-chips"');
    expect(html).not.toContain('data-testid="folder-card"');
    expect(html).toContain('href="/fr/app/library/l1/c1/f1"');
    const text = readable(html);
    expect(text).toContain("Baux · 3 fichiers");
    expect(text).toContain("Factures · 1 fichier");
  });

  it("the documents' tags are a filter bar with the ones in force as chips; absent when the account has no document tag", () => {
    expect(render()).not.toContain('data-testid="place-filters"');
    const T1 = "11111111-1111-4111-8111-111111111111";
    const T2 = "22222222-2222-4222-8222-222222222222";
    const tags = [
      { id: T1, name: "Urgent", color: "red" },
      { id: T2, name: "2026", color: "blue" },
    ] as never;
    const html = render({ documentTags: tags, view: parseView({ tags: T1 }) });
    expect(html).toContain('data-testid="place-filters"');
    const text = readable(html);
    expect(text).toContain("Urgent");
    expect(text).toContain(fr.console.organisation.clearTags);
    expect(text).toContain("2 fichiers");
  });

  it("a dropped file is checked under the account's offer, and a folder's menu leads somewhere valid once the folder is deleted or moved", () => {
    const page = readFileSync(new URL("./PlacePage.tsx", import.meta.url), "utf8");
    expect(page).toContain(
      "offerFor(await availableFlows(appEnvironment()), session.account.perspective).jurisdictions",
    );
    expect(page).toContain("jurisdictions={jurisdictions}");
    expect(page).toContain("libraryId: l.id");
    const view = readFileSync(new URL("./PlaceView.tsx", import.meta.url), "utf8");
    expect(view).toMatch(/jurisdictions=\{jurisdictions\}\s*>/);
    expect(view).toContain("afterDelete={libraryPath(locale, library.id, collection.id)}");
    expect(view).toContain("afterMove={movedFolderHrefs(locale, collections, folder.id)}");
    const actions = readFileSync(new URL("./OrganisationActions.tsx", import.meta.url), "utf8");
    expect(actions).toContain("if (next) router.push(next);");
    expect(actions).toMatch(/onClose,\s*\(to\) => after\?\.\[to\] \?\? null,?\s*\)/);
    expect(actions).toMatch(/onClose,\s*\(\) => after \?\? null,?\s*\)/);
  });

  it("the whole page is the drop zone (an overlay); the empty place shows the only visible zone with the owl, the full one its table", () => {
    const full = render();
    expect(full).not.toContain('data-testid="place-empty"');
    expect(full).not.toContain('data-testid="library-dropzone"');
    expect(full).toContain("<table");
    const empty = render({ documents: [] });
    expect(empty).toContain('data-testid="place-empty"');
    expect(empty).toContain('data-testid="library-dropzone"');
    expect(readable(empty)).toContain(fr.console.organisation.emptyCollection);
    expect(empty).not.toContain("<table");
  });
});
