import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { DocumentView } from "./DocumentView";
import { tableLabels } from "./table-labels";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => "/fr/app/documents/d1/rapport",
  useSearchParams: () => new URLSearchParams(""),
}));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
type Locale = keyof typeof MESSAGES;

const failedCheck = {
  id: "a1",
  studio: "compliance-check",
  status: "failed",
  runId: "run_8f3a2c",
  blueprintVersion: "1.4.0",
  inputs: { jurisdiction: "QC" },
  report: null,
  error: "UPSTREAM_TIMEOUT",
  createdAt: "2026-10-23T12:00:00.000Z",
  finishedAt: "2026-10-23T12:00:04.000Z",
};
const failedDocument = {
  id: "d1",
  title: "bail-rosemont-5",
  filename: "bail-rosemont-5.pdf",
  mimeType: "application/pdf",
  kind: "lease",
  sizeBytes: 3000,
  pages: 1,
  hasText: true,
  status: "failed",
  createdAt: "2026-10-23T11:59:00.000Z",
  sha256: "a".repeat(64),
  text: "BAIL DE LOGEMENT",
  analyses: [failedCheck],
  storage: {
    kind: "database",
    endpoint: null,
    region: "ca",
    residency: "canada",
    encrypted: true,
    owner: "krizaka",
    devOnly: false,
  },
  retainUntil: null,
  purged: false,
  insight: null,
};

const renderFailed = (locale: Locale) =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>
        <DocumentView
          initial={failedDocument as never}
          tab="rapport"
          place={null}
          registry={null}
          perspective="landlord"
          offer={{ studios: ["compliance-check", "document-authenticity"], jurisdictions: ["QC"], rulesets: [] }}
        />
      </KrizakaQueryProvider>
    </I18nProvider>,
  );

/** A button is filled when it carries the accent background (the `primary` variant of the Button). */
const filledButtons = (html: string) =>
  [...html.matchAll(/<button\b[^>]*class="([^"]*)"/g)].filter((m) => /(^|\s)bg-accent(\s|$)/.test(m[1] ?? ""));

describe.each(["en", "fr"] as const)("the failed check, %s", (locale) => {
  it("offers exactly one filled button: « Try again » leads, the new check is secondary", () => {
    const html = renderFailed(locale);
    expect(html).toContain('data-testid="check-failure"');
    expect(filledButtons(html)).toHaveLength(1);
  });

  it("gives every control of the failure a 44 px target on a phone", () => {
    const html = renderFailed(locale);
    const failure =
      /data-testid="check-failure"[\s\S]*?<div class="flex flex-wrap gap-2">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    const controls = [...failure.matchAll(/<(button|a)\b[^>]*class="([^"]*)"/g)];
    expect(controls.length).toBeGreaterThan(0);
    for (const [, tag, classes] of controls) {
      expect(classes, `${tag}: ${classes}`).toMatch(/(^|\s)min-h-11(\s|$)/);
    }
  });
});

describe.each(["en", "fr"] as const)("the table's expand button name, %s", (locale) => {
  const say = (key: string, vars?: Record<string, string | number>) => {
    const value = key
      .split(".")
      .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], MESSAGES[locale].console);
    if (typeof value !== "string") {
      throw new Error(`missing message ${key}`);
    }
    return value.replace(/\{(\w+)\}/g, (_, v: string) => String(vars?.[v]));
  };

  it("comes from the messages, never the package's English default", () => {
    const labels = tableLabels(say);
    expect(labels.expandRow?.("Bail")).toContain("Bail");
    expect(labels.expandRow?.("Bail")).toBe(say("library.table.expandRow", { name: "Bail" }));
    if (locale === "fr") {
      expect(labels.expandRow?.("Bail")).not.toMatch(/^Show details of/);
    }
    expect(labels.details).toBeTruthy();
    if (locale === "fr") {
      expect(labels.expandRow?.("Bail")).toMatch(/Afficher|Voir|Ouvrir|Détails/);
    }
  });
});
