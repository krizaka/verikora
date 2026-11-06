import { existsSync, readFileSync } from "node:fs";

import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FileSummary } from "@/lib/applicant-file";
import { I18nProvider } from "@/lib/i18n-client";
import { binderPlan } from "@/lib/workspace/binder";
import { DECISION, KIND } from "@/lib/workspace/decl";
import { DECISION_SET, DEFAULT_CONFIGS } from "@/lib/workspace/defaults";
import { resolveView } from "@/lib/workspace/view";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { FilesView } from "../console/FilesView";
import { FileView } from "../console/FileView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/fr/app/dossiers",
  useSearchParams: () => new URLSearchParams(""),
}));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const wrap = (node: React.ReactNode, locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>{node}</KrizakaQueryProvider>
    </I18nProvider>,
  );
const readable = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
const TYPES = [{ id: "pay-stub", label: "Talon de paie" }];
const T1 = "11111111-1111-4111-8111-111111111111";
const file = (id: string, name: string, extra: Partial<FileSummary> = {}): FileSummary => ({
  id,
  candidateName: name,
  status: "used",
  createdAt: "2026-10-20T14:00:00.000Z",
  expiresAt: "2026-11-07T15:00:00.000Z",
  submittedAt: "2026-10-22T14:00:00.000Z",
  closedAt: null,
  documents: 1,
  requested: 1,
  decision: DECISION.toDecide,
  tagIds: [],
  ...extra,
});
const views = DEFAULT_CONFIGS[KIND.applicantFile].views;
const workspace = (search = "", locale: "en" | "fr" = "fr") => ({
  set: DECISION_SET,
  tags: [{ id: T1, name: "Garant", color: "amber" as const }],
  system: views,
  saved: [],
  resolved: resolveView({ view: new URLSearchParams(search).get("view"), filters: {} }, views, [], locale),
  plan: binderPlan(DECISION_SET, [T1], {}),
  counts: { tabs: [2, 1, 0, 1], chips: [1] },
});

describe("« Dossiers » organised (verikora#324)", () => {
  const files = [
    file("f1", "Camille Fictif", { tagIds: [T1] }),
    file("f2", "Noé Imaginaire", {
      decision: DECISION.notSelected,
      closedAt: "2026-10-23T14:00:00.000Z",
      status: "closed",
    }),
  ];
  const html = wrap(<FilesView files={files} types={TYPES} origin="" workspace={workspace()} />);
  const text = readable(html);

  it("shows your decision as a chip with the set's words, apart from the link's line of facts", () => {
    expect(text).toContain(fr.console.dossiers.columns.decision);
    expect(text).toContain("À décider");
    expect(text).toContain("Non retenu");
    expect(text).toContain("Documents envoyés le 22 oct. 2026");
  });

  it("writes the tag's name beside its marker, never colour alone", () => {
    expect(text).toContain("Garant");
  });

  it("shows the decision states as binder tabs with their counts, apart from the saved views", () => {
    expect(html).toContain('data-testid="binder"');
    expect(html).toMatch(/href="\/fr\/app\/dossiers\?status=a_decider"/);
    expect(html).toMatch(/href="\/fr\/app\/dossiers\?status=non_retenu"/);
    expect(text).toMatch(/Tous 2 .*À décider 1 .*Retenu 0 .*Non retenu 1/);
    expect(text).toMatch(/Garant 1/);
    expect(html).not.toMatch(/href="\/fr\/app\/dossiers\?view=to_decide/);
  });

  it("keeps the other system views as links that carry their filters in the address, and a menu on a phone", () => {
    expect(html).toContain(`aria-label="${fr.console.dossiers.views.label}"`);
    expect(html).toContain(`aria-label="${fr.console.dossiers.views.groups.system}"`);
    expect(html).toContain("Vue : ");
    expect(html).toMatch(
      /href="\/fr\/app\/dossiers\?view=decided&amp;status=retenu,non_retenu"|href="\/fr\/app\/dossiers\?view=decided&amp;status=retenu%2Cnon_retenu"/,
    );
  });

  it("has a filter bar on the tag and the decision, and a selectable table", () => {
    expect(html).toContain('data-testid="files-filters"');
    expect(text).toContain(fr.console.dossiers.filters.tags);
    expect(text).toContain(fr.console.dossiers.filters.decision);
    expect(html).toMatch(/type="checkbox"/);
  });

  it("says in the address's view which one is active", () => {
    const active = wrap(
      <FilesView files={[files[0]!]} types={TYPES} origin="" workspace={workspace("view=decided")} />,
    );
    expect(active).toMatch(/aria-current="page"[^>]*href="[^"]*view=decided[^"]*"[^>]*>Décidés/);
    expect(active).toContain("Vue : Décidés");
  });

  it("without the workspace, behaves as before: no decision column, no selection", () => {
    const plain = wrap(<FilesView files={files} types={TYPES} origin="" />);
    expect(readable(plain)).not.toContain(fr.console.dossiers.columns.decision);
    expect(plain).not.toMatch(/type="checkbox"/);
  });

  it("speaks English too", () => {
    const english = readable(
      wrap(<FilesView files={files} types={TYPES} origin="" workspace={workspace("", "en")} />, "en"),
    );
    expect(english).toContain("Your decision");
    expect(english).toContain("Not selected");
  });
});

describe("one file's decision (verikora#324)", () => {
  const detail = {
    id: "f1",
    candidateName: "Camille Fictif",
    candidateEmail: "camille@exemple.test",
    status: "used" as const,
    createdAt: "2026-10-20T14:00:00.000Z",
    expiresAt: "2026-11-07T15:00:00.000Z",
    requestedTypes: ["pay-stub"],
    submittedAt: "2026-10-22T14:00:00.000Z",
    revokedAt: null,
    closedAt: null,
    consents: [],
    documents: [],
  };
  const render = (decision: string) =>
    readable(
      wrap(<FileView file={detail} types={TYPES} workspace={{ set: DECISION_SET, decision, tags: [], tagIds: [] }} />),
    );

  it("offers the two decisions while the file is to decide, and says a decision is final", () => {
    const text = render(DECISION.toDecide);
    expect(text).toContain("Marquer « Retenu »");
    expect(text).toContain("Marquer « Non retenu »");
    expect(text).toContain(fr.console.dossiers.decide.final);
  });

  it("offers nothing after a decision: no undo, the documents are gone", () => {
    const text = render(DECISION.selected);
    expect(text).toContain("Retenu");
    expect(text).not.toContain("Marquer");
    expect(text).not.toMatch(/Annuler|Rouvrir|Undo/);
  });

  it("never suggests a decision from a check", () => {
    for (const source of [
      "../organise/DecisionActions.tsx",
      "../organise/BulkActions.tsx",
      "../console/FilesView.tsx",
    ]) {
      expect(readFileSync(new URL(source, import.meta.url), "utf8"), source).not.toMatch(
        /recommend|suggest|score|attention/i,
      );
    }
  });
});

describe("no local copy of a block Krizaka UI ships (ADR-006 § 6)", () => {
  it.each(["StatusChip", "SavedViews", "SelectionBar"])("%s is gone", (name) => {
    expect(existsSync(new URL(`./${name}.tsx`, import.meta.url)), name).toBe(false);
  });

  it("names no issue that was waiting for the pieces", () => {
    for (const name of ["BulkActions.tsx", "useSavedViews.ts", "DecisionActions.tsx", "FileTags.tsx"]) {
      expect(readFileSync(new URL(`./${name}`, import.meta.url), "utf8"), name).not.toMatch(/krizaka-ui#(627|690|657)/);
    }
  });

  it("the selection bar is the table's (bulkActions), the views are the filter bar's", () => {
    const view = readFileSync(new URL("../console/FilesView.tsx", import.meta.url), "utf8");
    expect(view).toContain("bulkActions");
    expect(view).toContain("views={views}");
  });
});
