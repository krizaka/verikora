import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { SEGMENT_SHAPES, SegmentError, SegmentLoading } from "./SegmentStates";

/**
 * The states pass (design § 3.5, P11, verikora#328): every page of the signed-in space has its own `loading.tsx` (a skeleton
 * in the page's shape, never a centred spinner) and its own `error.tsx` (an Alert in place with the way back; the shell stays).
 */
const WEB = join(__dirname, "../..");
const APP = join(WEB, "app/[locale]/(app)/app");

function segments(dir: string): string[] {
  const here = readdirSync(dir).includes("page.tsx") ? [dir] : [];
  return [
    ...here,
    ...readdirSync(dir)
      .filter((f) => statSync(join(dir, f)).isDirectory())
      .flatMap((f) => segments(join(dir, f))),
  ];
}
function sources(dir: string): { name: string; source: string }[] {
  return readdirSync(dir).flatMap((f) => {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(f) && !f.includes(".test.")
      ? [{ name: relative(WEB, full), source: readFileSync(full, "utf8") }]
      : [];
  });
}

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const inI18n = (node: React.ReactNode, locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      {node}
    </I18nProvider>,
  );
const readable = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");

describe("every segment of the app has its loading and its error boundary (P11)", () => {
  const all = segments(APP);

  it("finds the app's pages", () => {
    expect(all.length).toBeGreaterThan(10);
    expect(all.map((d) => relative(APP, d))).toContain("verifications");
  });

  for (const dir of all) {
    const name = relative(APP, dir) || "(accueil)";
    it(`${name}: a loading.tsx in the page's shape and an error.tsx with the way back`, () => {
      const loading = readFileSync(join(dir, "loading.tsx"), "utf8");
      const shape = loading.match(/<SegmentLoading shape="(\w+)"/)?.[1];
      expect(SEGMENT_SHAPES as readonly string[]).toContain(shape);
      const error = readFileSync(join(dir, "error.tsx"), "utf8");
      expect(error.startsWith('"use client";')).toBe(true);
      expect(error).toMatch(/<SegmentError\b[^>]*retry=\{retry\}/);
    });
  }
});

describe("the skeletons: the page's shape, announced once, no spinner", () => {
  for (const shape of SEGMENT_SHAPES) {
    it(`${shape}: a status region busy with the console's words, drawn with Skeleton`, () => {
      const html = inI18n(<SegmentLoading shape={shape} />);
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain(`data-shape="${shape}"`);
      expect(readable(html)).toContain(fr.console.states.loading);
      expect(html).toMatch(/animate-pulse|kz-skeleton/);
      expect(html).not.toMatch(/animate-spin|kz-spinner|role="progressbar"/);
    });
  }

  it("draws different shapes: a list is rows, a report has its verdict band and its aside", () => {
    expect(inI18n(<SegmentLoading shape="list" />)).toContain('data-skeleton="rows"');
    const detail = inI18n(<SegmentLoading shape="detail" />);
    expect(detail).toContain('data-skeleton="verdict"');
    expect(detail).toContain('data-skeleton="aside"');
  });
});

describe("an error stays in place, with its cause and the way back", () => {
  it("is a danger Alert with the words and « Réessayer », in each language", () => {
    for (const [locale, d] of [
      ["fr", fr],
      ["en", en],
    ] as const) {
      const html = inI18n(<SegmentError error={new Error("boom")} retry={() => {}} />, locale);
      expect(html).toContain('role="alert"');
      const text = readable(html);
      expect(text).toContain(d.console.states.error.title);
      expect(text).toContain(d.console.states.error.text);
      expect(text).toContain(d.console.states.error.retry);
      // The raw message of a server error is never shown to the person.
      expect(text).not.toContain("boom");
    }
  });
});

describe("no spinner outside a button", () => {
  it("no Spinner and no spinning class in the app's components and pages (a button's `loading` is the only spinner)", () => {
    const files = [...sources(join(WEB, "components")), ...sources(join(WEB, "app/[locale]"))];
    expect(
      files.filter((f) => /@krizaka\/ui\/spinner|\bSpinner\b|animate-spin/.test(f.source)).map((f) => f.name),
    ).toEqual([]);
  });
});

describe("the NO_TEXT partial state says why, and what still runs", () => {
  it("names the missing text layer, the law check that could not read the clauses, and the file's examination that still runs", () => {
    expect(fr.console.document.noText.pdf).toBe(
      "Ce PDF n'a pas de couche texte : la vérification au regard de la loi n'a pas pu lire ses clauses. L'examen du fichier, lui, a lieu.",
    );
    expect(en.console.document.noText.pdf).toBe(
      "This PDF has no text layer: the check against the law could not read its clauses. The file itself is still examined.",
    );
  });
});
