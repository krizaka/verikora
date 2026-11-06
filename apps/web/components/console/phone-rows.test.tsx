import { readFileSync } from "node:fs";

import { KrizakaQueryProvider } from "@krizaka/query";
import type { DocumentSummary } from "@verikora/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FileSummary } from "@/lib/applicant-file";
import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { DocumentTable } from "./DocumentTable";
import { FilesView } from "./FilesView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/fr/app",
  useSearchParams: () => new URLSearchParams(""),
}));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <I18nProvider locale="fr" messages={MESSAGES.fr as never}>
      <KrizakaQueryProvider>{node}</KrizakaQueryProvider>
    </I18nProvider>,
  );
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
const file = (id: string, name: string): FileSummary => ({
  id,
  candidateName: name,
  status: "used",
  createdAt: "2026-10-20T14:00:00.000Z",
  expiresAt: "2026-11-07T15:00:00.000Z",
  submittedAt: "2026-10-22T14:00:00.000Z",
  closedAt: null,
  documents: 1,
  requested: 2,
  decision: "a_decider",
  tagIds: [],
});

/** The phone's list rows, as the table draws them under 36 rem: the checkbox, the title (the row's link) with ONE line of facts, the status at the end. */
const rowsOf = (html: string) => html.split("<tr ").slice(2);
/** The text of some markup, tags dropped by a scan (no regular expression: a replace can leave a tag behind). */
const textOf = (markup: string) => {
  let out = "";
  let inTag = false;
  for (const ch of markup) {
    if (ch === "<") inTag = true;
    else if (ch === ">" && inTag) inTag = false;
    else if (!inTag) out += ch;
  }
  return out;
};
const factsIn = (row: string) =>
  [...row.matchAll(/<span data-facts="[^"]*"[^>]*>(.*?)<\/span><\/span>/g)].map((m) => textOf(m[1]!));

describe("phone lists as list rows (P12, #329)", () => {
  it("Documents: a title linking to its page, one line of facts « Bail · 20 oct. 2026 », the result at the end, no dl per row", () => {
    const html = wrap(<DocumentTable rows={[doc(1), doc(2)]} />);
    expect(html).not.toContain("<dl");
    const rows = rowsOf(html);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.match(/data-list="title"/g)).toHaveLength(1);
      expect(row.match(/data-list="status"/g)).toHaveLength(1);
      expect(row.match(/data-facts=/g)).toHaveLength(1);
      expect(factsIn(row)).toEqual(["Bail · 20 oct. 2026"]);
    }
    expect(rows[0]).toContain('href="/fr/app/documents/d1"');
  });

  it("Dossiers: the applicant is the title and the row's link, the link's state waits whole in the row's detail (a one-line fact was cut off at 360 and 390 px, #496), the decision ends the row", () => {
    const html = wrap(<FilesView files={[file("f1", "Camille Fictif")]} types={[]} origin="" workspace={undefined} />);
    expect(html).not.toContain("<dl");
    const [row] = rowsOf(html);
    expect(row).toContain('href="/fr/app/dossiers/f1"');
    expect(factsIn(row!).join(" ")).not.toContain("Documents envoyés");
    expect(textOf(row!)).toContain("Documents envoyés le 22 oct. 2026");
  });

  it('every table of the three says phone="list" and types its title column with the row\'s link', () => {
    for (const source of ["DocumentTable.tsx", "FilesView.tsx", "ChecksView.tsx"]) {
      const code = readFileSync(new URL(`./${source}`, import.meta.url), "utf8");
      expect(code, source).toContain('phone="list"');
      expect(code, source).toMatch(/type: "title",\s*href:/);
      expect(code, source).not.toMatch(/<dl\b/);
    }
  });

  it("Vérifications: the kind and the day are the line of facts, the studio and the run wait in the row's detail", () => {
    const code = readFileSync(new URL("./ChecksView.tsx", import.meta.url), "utf8");
    expect(code).toMatch(/id: "kind",[^}]*priority: 2/);
    expect(code).toMatch(/id: "at",[^}]*priority: 2/);
    expect(code).toMatch(/id: "studio",[^}]*priority: 3/);
    expect(code).toMatch(/id: "run",[^}]*priority: 3/);
    expect(code).toMatch(/id: "result",\s*header: say\("checks.columns.result"\),\s*type: "status"/);
  });

  it("Documents: the row bookmark is a quick action, it stays on the phone card (priority 2), never under the chevron (verikora#339)", () => {
    const code = readFileSync(new URL("./DocumentTable.tsx", import.meta.url), "utf8");
    expect(code).toMatch(/id: "bookmarks",[\s\S]*?priority: 2,/);
  });
});
