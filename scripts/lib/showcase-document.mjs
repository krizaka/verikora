// The document the web showcase's report film opens. The Rosemont dossier also holds documents whose check did not finish (the seed
// fails them on purpose, one per cause: krizaka-internal#1900, #3375), and the first row may be one of them: its page is an error state,
// which film-markers-lib refuses. The film names a document whose check is finished (content of scripts/demo-documents/catalogue.mjs).
export const REPORT_DOCUMENT = "bail-rosemont-1-conforme";

/** The link of that document among the dossier's rows ({ href, text } of each row: the file name is on the row, not in the link's title), or undefined when the dossier does not show it. */
export const reportDocumentIn = (links) => links.find((l) => l.text.includes(REPORT_DOCUMENT))?.href;
