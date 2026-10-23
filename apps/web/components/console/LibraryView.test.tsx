import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CheckSummary } from "@/lib/checks";
import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { LibraryView } from "./LibraryView";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/fr/app", useSearchParams: () => new URLSearchParams() }));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const readable = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");
const collection = (patch: Record<string, unknown> = {}) => ({ id: "c1", name: "My documents", files: 2, folders: 0, tags: [], isDefault: true, avatar: null, description: null, lastCheck: { at: "2026-10-20T15:00:00.000Z", status: "attention" }, ...patch });
const doc = (n: number, status: string) => ({ id: `d${n}`, title: `Bail ${n}`, filename: `b${n}.pdf`, mimeType: "application/pdf", kind: "lease", sizeBytes: 10, pages: 1, hasText: true, status, createdAt: "2026-10-20T15:00:00.000Z" });
const check = (n: number, result: CheckSummary["result"]): CheckSummary => ({ id: `a${n}`, documentId: `d${n}`, title: `Bail ${n}`, kind: "lease", studio: "compliance-check", result, runId: `run_${n}`, at: `2026-10-2${n}T12:00:00.000Z` });
const EXAMPLES = { tenant: { title: "Bail locataire", filename: "bail-locataire.txt", text: "…" }, landlord: { title: "Bail propriétaire", filename: "bail-proprietaire.txt", text: "…" } };
const render = (props: Record<string, unknown>, locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>
        <LibraryView libraries={[{ id: "l1", name: "Ma bibliothèque", collections: [collection()] }] as never} recents={[doc(1, "attention")] as never} tags={[]} examples={EXAMPLES} {...(props as object)} />
      </KrizakaQueryProvider>
    </I18nProvider>,
  );
/** The markup of the first collection card's link, from its `<a` to its `</a>`. */
const cardLink = (html: string) => {
  const from = html.indexOf('href="/fr/app/bibliotheque/l1/c1"');
  const open = html.lastIndexOf("<a ", from);
  return html.slice(open, html.indexOf("</a>", from));
};

describe("the library home (yomizaka#275, the UX review's Y3)", () => {
  it("has one h1 with its secondary actions, and leaves the primary (« Vérifier un document ») to the header", () => {
    const html = render({});
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(readable(html)).toContain("Bibliothèque");
    expect(readable(html)).toContain("Nouvelle collection");
    expect(readable(html)).not.toContain("Vérifier un document");
  });

  it("names the default collection in the language being read, with its last check", () => {
    const text = readable(render({}));
    expect(text).toContain("Mes documents");
    expect(text).not.toContain("My documents");
    expect(text).toContain("À regarder");
    expect(readable(render({}, "en"))).toContain("My documents");
  });

  it("lists the latest checks first — each a link to the report — with « Tout voir » to Vérifications; says so when there is none", () => {
    const html = render({ latest: [check(1, "attention"), check(2, "checked")] });
    const section = html.slice(html.indexOf('data-testid="latest-checks"'), html.indexOf('data-testid="library-section"'));
    expect(section.match(/<li\b/g)).toHaveLength(2);
    expect(section).toContain('href="/fr/app/documents/d1/verifications"');
    expect(section).toContain('href="/fr/app/verifications"');
    expect(readable(section)).toContain("Dernières vérifications");
    expect(readable(section)).toContain("Tout voir");
    expect(readable(render({ latest: [] }))).toContain(fr.console.organisation.noChecks);
    expect(render({ latest: [] })).not.toContain('href="/fr/app/verifications"');
  });

  it("draws each collection as one link card with a place mark, its count and its last check; the menu sits beside the link, never inside it", () => {
    const html = render({});
    const link = cardLink(html);
    expect(readable(link)).toContain("Mes documents");
    expect(readable(link)).toContain("2 fichiers");
    expect(readable(link)).toContain("Par défaut");
    expect(link).toContain('data-testid="place-mark"');
    expect(link).not.toContain("<button");
    expect(html).toContain('data-testid="collection-last-check"');
    const chosen = cardLink(render({ libraries: [{ id: "l1", name: "L", collections: [collection({ avatar: { kind: "set", seed: "plain-2" } })] }] }));
    expect(chosen).not.toContain('data-testid="place-mark"');
    expect(readable(chosen)).toContain("Mes documents");
  });

  it("with nothing yet: the owl, one sentence, the only drop zone and the two examples — no table, no checks list", () => {
    const html = render({ recents: [], latest: [], libraries: [{ id: "l1", name: "L", collections: [collection({ files: 0, lastCheck: null })] }] });
    expect(html).toContain('data-testid="library-empty"');
    expect(readable(html)).toContain(fr.console.library.emptyPitch);
    expect(html.match(/data-testid="library-dropzone"/g)).toHaveLength(1);
    expect(html).toContain('data-testid="library-examples"');
    expect(readable(html)).toContain(fr.console.library.exampleTenant);
    expect(html).not.toContain('data-testid="latest-checks"');
    expect(html).not.toContain("<table");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it("keeps a collection the person made reachable even with no document yet (no empty state over it)", () => {
    const html = render({ recents: [], latest: [], libraries: [{ id: "l1", name: "L", collections: [collection({ files: 0, lastCheck: null }), collection({ id: "c2", name: "Immeuble Rosemont", isDefault: false, files: 0, lastCheck: null })] }] });
    expect(html).not.toContain('data-testid="library-empty"');
    expect(html).toContain('href="/fr/app/bibliotheque/l1/c2"');
    expect(readable(html)).toContain("Immeuble Rosemont");
  });

  it("shows the recent documents as the table once files exist", () => {
    const html = render({ recents: [doc(1, "checked"), doc(2, "stored")] });
    expect(html).toContain("<table");
    expect(readable(html)).toContain("Récents");
    expect(html).not.toContain('data-testid="library-dropzone"');
  });
});
