import assert from "node:assert/strict";
import { test } from "vitest";

import { PERSONA_ERIC } from "../demo-documents/catalogue.mjs";
import { REPORT_DOCUMENT, reportDocumentIn } from "./showcase-document.mjs";

// web-report-en/fr were refused for « marker 0 shows an error state » (runs 43022692286, 43230340915, 43430663763): the film opened
// the first document of the Rosemont dossier, which the seed leaves with a check that did not finish (krizaka-internal#1900, #3375).
test("the showcase's report is a document of the demo dossier that carries a finished check", () => {
  const rosemont = PERSONA_ERIC.collections.find((c) => c.key === "rosemont");
  assert.ok(rosemont.documents.includes(REPORT_DOCUMENT), "it is in the dossier the film opens");
  assert.ok(PERSONA_ERIC.checked.includes(REPORT_DOCUMENT), "its check is finished");
  assert.ok(!PERSONA_ERIC.failed.some((f) => f.id === REPORT_DOCUMENT), "the seed does not fail it");
});

test("the film opens that document, never the first row of the dossier", () => {
  const hrefs = [
    { href: "/en/app/documents/a", text: "contrat-entretien-rosemont.pdf" },
    { href: "/en/app/documents/b", text: `${REPORT_DOCUMENT}.pdf` },
  ];
  assert.equal(reportDocumentIn(hrefs), "/en/app/documents/b");
  assert.equal(reportDocumentIn([hrefs[0]]), undefined);
});
