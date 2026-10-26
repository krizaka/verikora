import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import { DocsContent } from "@/components/docs/DocsContent";
import { SiteFooter } from "@/components/SiteFooter";

import { openApiDocument } from "./api-v1/openapi";
import { DOCS_SECTIONS } from "./docs";
import { apiOperations, apiWebhooks } from "./docs-api";
import { llmsText } from "./seo";
import { SITE_URL } from "./site";

/** yomizaka#387: Yomizaka documents itself, from its OpenAPI document and its own words, with only what is true. */
const LOCALES = ["en", "fr"] as const;
const html = (locale: (typeof LOCALES)[number]) => renderToStaticMarkup(DocsContent({ locale }));

describe("/docs", () => {
  it("renders in both languages, with every section as an anchor and as an entry of the contents", () => {
    for (const locale of LOCALES) {
      const page = html(locale);
      for (const id of DOCS_SECTIONS) {
        expect(page, `${locale} #${id}`).toContain(`id="${id}"`);
        expect(page, `${locale} toc ${id}`).toContain(`href="#${id}"`);
      }
    }
  });

  it("has a section for every operation of the OpenAPI document, and for every webhook", () => {
    const spec = openApiDocument(SITE_URL);
    const documented = Object.values(spec.paths).flatMap((methods) => Object.values(methods).map((op) => (op as { operationId: string }).operationId));
    expect(documented.length).toBeGreaterThanOrEqual(6);
    expect(apiOperations().map((o) => o.id).sort()).toEqual([...documented].sort());
    for (const locale of LOCALES) {
      const page = html(locale);
      for (const op of apiOperations()) {
        expect(page, `${locale} ${op.method} ${op.path}`).toContain(`id="${op.id}"`);
        expect(page).toContain(op.path);
      }
      for (const hook of apiWebhooks()) expect(page, hook.event).toContain(hook.event);
    }
    expect(apiWebhooks().map((h) => h.event)).toEqual(Object.keys(spec.webhooks));
  });

  it("takes the scope of each route from the document: a route that needs a key names it", () => {
    const secured = apiOperations().filter((o) => o.scope);
    expect(secured.length).toBeGreaterThan(0);
    for (const op of secured) expect(["checks:write", "reports:read", "contracts:seal"]).toContain(op.scope);
  });

  it("reads what a signed report guarantees from the words of the verification page", async () => {
    for (const locale of LOCALES) {
      const messages = (await import(`@/messages/${locale}.json`)).default;
      const page = html(locale).replaceAll("&#x27;", "'");
      for (const line of Object.values(messages.verify.guarantees) as string[]) expect(page).toContain(line.replaceAll("&", "&amp;"));
    }
  });

  it("never talks of identity verification, and links to the privacy notice instead of copying it", () => {
    for (const locale of LOCALES) {
      const page = html(locale);
      expect(page).not.toMatch(/ID verification|identity verification|vérification d'identité|vérification d’identité/i);
      expect(page).toContain(`href="/${locale}/privacy"`);
    }
  });

  it("is in the menu, the footer, the sitemap and llms.txt", () => {
    const nav = readFileSync(join(import.meta.dirname, "nav.ts"), "utf8");
    expect(nav).toContain('page: "docs"');
    for (const locale of LOCALES) expect(renderToStaticMarkup(SiteFooter({ locale }))).toContain(`href="/${locale}/docs"`);
    const urls = sitemap().map((e) => e.url);
    for (const locale of LOCALES) expect(urls).toContain(`${SITE_URL}/${locale}/docs`);
    expect(llmsText()).toContain(`${SITE_URL}/en/docs`);
  });
});
