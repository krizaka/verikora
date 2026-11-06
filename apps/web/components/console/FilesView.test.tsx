import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ApplicantFileView, FileSummary } from "@/lib/applicant-file";
import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { FilesView } from "./FilesView";
import { askedRows, FileView } from "./FileView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => "/fr/app/dossiers",
  useSearchParams: () => new URLSearchParams(),
}));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const readable = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
const wrap = (node: React.ReactNode, locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>{node}</KrizakaQueryProvider>
    </I18nProvider>,
  );
const TYPES = [
  { id: "pay-stub", label: "Talon de paie" },
  { id: "bank-statement", label: "Relevé bancaire" },
  { id: "employment-letter", label: "Lettre d'emploi" },
];
/** Rows as `listApplicantFiles` returns them. */
const summary = (id: string, name: string, extra: Partial<FileSummary> = {}): FileSummary => ({
  id,
  candidateName: name,
  status: "open",
  createdAt: "2026-10-20T14:00:00.000Z",
  expiresAt: "2026-11-07T15:00:00.000Z",
  submittedAt: null,
  closedAt: null,
  documents: 0,
  requested: 3,
  decision: "a_decider",
  tagIds: [],
  ...extra,
});

describe("« Dossiers »: the list (P6, verikora#323)", () => {
  it("draws a row per file of listApplicantFiles — the applicant, the link in words, the documents in against those asked — each leading to its file", () => {
    const html = wrap(
      <FilesView
        files={[
          summary("f1", "Camille Fictif", { documents: 2 }),
          summary("f2", "Noé Imaginaire", { status: "used", submittedAt: "2026-10-22T14:00:00.000Z", documents: 3 }),
        ]}
        types={TYPES}
        origin="https://www.verikora.com"
      />,
    );
    const text = readable(html);
    expect(text).toContain("Camille Fictif");
    expect(text).toContain("Lien ouvert jusqu'au 7 nov. 2026");
    expect(text).toContain("2 sur 3 reçus");
    expect(text).toContain("Documents envoyés le 22 oct. 2026");
    expect(html).toContain('href="/fr/app/dossiers/f1"');
    expect(html).toContain('href="/fr/app/dossiers/f2"');
    expect(text).toContain(fr.console.dossiers.request);
    expect(html).not.toContain('data-testid="files-empty"');
  });

  it("says the link's state for every state linkState knows, in both languages", () => {
    const text = readable(
      wrap(
        <FilesView
          files={[
            summary("a", "A", { status: "expired" }),
            summary("b", "B", { status: "revoked" }),
            summary("c", "C", { status: "closed", closedAt: "2026-10-23T14:00:00.000Z" }),
            summary("d", "D", { status: "erased" }),
          ]}
          types={TYPES}
          origin=""
        />,
      ),
    );
    for (const words of [
      fr.console.dossiers.link.expired,
      fr.console.dossiers.link.revoked,
      "Dossier fermé le 23 oct. 2026",
      fr.console.dossiers.link.erased,
    ])
      expect(text).toContain(words);
    expect(readable(wrap(<FilesView files={[summary("f1", "Camille")]} types={TYPES} origin="" />, "en"))).toContain(
      "Link open until Nov 7, 2026",
    );
  });

  it("with no file: the owl, what the list is for, and « Demander des documents »", () => {
    const html = wrap(<FilesView files={[]} types={TYPES} origin="" />);
    expect(html).toContain('data-testid="files-empty"');
    const text = readable(html);
    expect(text).toContain(fr.console.dossiers.empty.title);
    expect(text).toContain(fr.console.dossiers.empty.text);
    expect(text).toContain(fr.console.dossiers.request);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("<table");
  });
});

const file = (documents: ApplicantFileView["documents"]): ApplicantFileView => ({
  id: "f1",
  candidateName: "Camille Fictif",
  candidateEmail: "camille@exemple.test",
  status: "used",
  createdAt: "2026-10-20T14:00:00.000Z",
  expiresAt: "2026-11-07T15:00:00.000Z",
  requestedTypes: ["pay-stub", "employment-letter"],
  submittedAt: "2026-10-22T14:00:00.000Z",
  revokedAt: null,
  closedAt: null,
  consents: [],
  documents,
});
const received = {
  id: "d1",
  typeId: "pay-stub",
  filename: "talon-octobre.pdf",
  sizeBytes: 1000,
  pages: 1,
  retention: "after-check",
  purged: true,
  skipped: [],
  checks: [
    {
      id: "a1",
      studio: "document-authenticity",
      status: "succeeded",
      runId: "run_1",
      blueprintVersion: "1.0.0",
      inputs: {},
      report: { header: null, signals: [{ signalId: "metadata-producer", level: "inhabituel", observation: "x" }] },
      error: null,
      createdAt: "2026-10-22T14:00:00.000Z",
      finishedAt: "2026-10-22T14:00:05.000Z",
    },
  ],
} as unknown as ApplicantFileView["documents"][number];

describe("« Dossiers »: one file (P6)", () => {
  it("lists the documents asked, each with the one received — what becomes of it and its checks — or « Pas encore reçu »", () => {
    expect(askedRows(file([received])).map((r) => `${r.type}:${r.document?.id ?? "-"}`)).toEqual([
      "pay-stub:d1",
      "employment-letter:-",
    ]);
    const html = wrap(<FileView file={file([received])} types={TYPES} />);
    const text = readable(html);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(text).toContain("Camille Fictif");
    expect(text).toContain("Documents envoyés le 22 oct. 2026");
    expect(text).toContain("1 sur 2 reçus");
    expect(text).toContain("Talon de paie");
    expect(text).toContain("Reçu : talon-octobre.pdf");
    expect(text).toContain(fr.console.dossiers.detail.purged);
    expect(text).toContain("Authenticité · 1 signal");
    expect(text).toContain("Lettre d'emploi");
    expect(text).toContain(fr.console.dossiers.detail.notReceived);
    expect(html).toContain('href="/fr/app/documents/d1/rapport"');
    expect(html).toContain('href="/fr/app/dossiers"');
  });

  it("decides nothing: no decision chip, no approve or refuse, no run id on the face", () => {
    const text = readable(wrap(<FileView file={file([received])} types={TYPES} />));
    expect(text).not.toMatch(/Approuv|Refus|Retenu|À décider/);
    expect(text).not.toContain("run_1");
  });
});

describe("« Dossiers » filtered by the link's state, from the home's figures (verikora#325)", () => {
  const files = [
    summary("f1", "Camille Fictif"),
    summary("f2", "Noé Imaginaire", { status: "used", submittedAt: "2026-10-22T14:00:00.000Z" }),
  ];
  it("lists the files in that state only, says the filter and offers « Tout voir »", () => {
    const html = wrap(<FilesView files={files} states={["used"]} types={TYPES} origin="" />);
    const text = readable(html);
    expect(text).toContain("Noé Imaginaire");
    expect(text).not.toContain("Camille Fictif");
    expect(text).toContain(fr.console.dossiers.filter.states.used);
    expect(html).toContain('href="/fr/app/dossiers"');
    expect(text).toContain(fr.console.dossiers.filter.clear);
  });
  it("says so in one line when no file is in that state, never the first-time empty state", () => {
    const html = wrap(<FilesView files={[files[0]!]} states={["used"]} types={TYPES} origin="" />);
    expect(readable(html)).toContain(fr.console.dossiers.filter.none);
    expect(html).not.toContain('data-testid="files-empty"');
  });
});
