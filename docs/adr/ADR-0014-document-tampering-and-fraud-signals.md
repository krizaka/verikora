# ADR-0014: Document tampering and fraud signals

- Status: accepted (2026-10-30, the CTO's design session, a decision the founder delegated). Issue: krizaka/verikora#102
  (epic #100). Extends ADR-0001 (the trust SPI, residency), ADR-0006 (understanding), ADR-0010 (photos) and ADR-0012
  (retention); the analysis stays in Sovkora (AGENTS.md §2, « products run on Sovkora »).

## Context

A landlord or an agency receives an applicant's pay stubs, an employment letter, a bank statement. Some are edited: a
gross pay changed in an online PDF editor, a figure pasted over, a stub made by a fake-stub generator. #102 asks for a
« tamper score 0-100 ». What already runs:

- Sovkora's `document-validation` pack, Studio `document-authenticity` (no model call): 22 signal cases as data
  (`worker/authenticity-signals.json`) over PDF metadata (`PDF-META-001…004`), incremental saves (`PDF-REV-001`), the two
  `/ID` (`PDF-ID-001`), an OCR text layer (`PDF-TEXT-001`), a font on one page only (`PDF-FONT-001`), orphan objects
  (`PDF-OBJ-001`), the XMP history (`XMP-HIST-001`), image EXIF (`IMG-META-001…005`), office packages (`OFF-META-*`), and
  document profiles (`pay-stub`, `bank-statement`, `employment-letter`: `DOC-PROFILE-001`). Three levels written in words
  (`observé`, `inhabituel`, `incohérent`), no score, a `NOT_EXAMINED` list printed in every report, tests that refuse
  verdict words. Verikora shows these in `AuthenticitySignals.tsx`, without evidence positions.
- `identity-document-check` (MRZ check digits, dates, printed fields vs zone vs barcode; a vision reading never fails a
  document alone) and `message-authenticity` (AI-text classifier for chat messages, measured: it recognises a small
  minority of generated texts at the price of not accusing humans).
- `tenant-screening-qc`: its default cut-off **stops** the saga on any `incohérent` document signal.
- The rent share (#559) set the guardrail for anything about an applicant: information, never a verdict.

The question is what can be detected honestly, what is only a signal, what is never claimed, where it runs and how we
prove it before a landlord reads it.

## Decision

### 1. No score, no verdict, never « forged »

- **Refused: the tamper score of #102.** A number without a measured base rate is a lie, and it gets quoted in a dispute as
  if it were one. The same holds for a percentage, a « risk level », a colour scale summed across documents, a sort or a
  filter of applicants by their signals.
- Verikora **never says that a document is forged, fake, falsified or fraudulent, and never says anything about the person**.
  Forgery is a legal conclusion (Criminal Code s. 366) about an intent we cannot see; saying it of an applicant harms a
  reputation (C.c.Q. art. 3 and 35) and can refuse a lease on a ground the Québec Charter protects (s. 10 and 12, social
  condition, as for the rent share #559).
- What Verikora reports is an **observed fact about the file**, its **evidence** (page, box, revision), what it **may
  indicate** with its ordinary explanations, and **what to ask for**. The landlord decides; Verikora decides nothing, so
  there is no decision based exclusively on automated processing about the applicant (Law 25, private sector Act s. 12.1).
- A document with no signal is **not** declared genuine: a careful forger who regenerates a whole file leaves none of these
  traces. Every report says so and lists what was not examined.
- Words refused by tests in Verikora's messages and rendered report, EN/FR: forged, fake, fraud, fraudulent, falsified,
  counterfeit, faux, falsifié, frauduleux, contrefait, trafiqué, score, risk score, %. Internally the families are named
  « tampering signals »; on the page they are « traces of editing » / « traces de modification ».

### 2. What can be detected honestly, and how

Four families. Each case is a detector in the pack, its sentences written by hand in the data file, its PASS/FAIL fixture,
and it ships only if the corpus (§5) lets it.

| Family | What is read | Signal cases | Highest level | Honest limit |
| :--- | :--- | :--- | :--- | :--- |
| **PDF structure** | incremental updates and **what a later revision changed** (pages, replaced text objects, a replaced object that draws a figure); `/ID` pair; producer vs creator **class** (a payroll generator as creator, an editor as producer); the XMP history vs the info dictionary; a figure drawn in another font, subset or size than its neighbours; text over a filled rectangle that hides other text; a FreeText or Stamp annotation over a figure; orphan objects | existing `PDF-*`, `XMP-HIST-001`, new `PDF-REV-002`, `PDF-META-005`, `PDF-FONT-002`, `PDF-LAYER-001` | `incohérent` when two facts of the file contradict each other (a later save replaced the object that draws the net pay) | signing, filling a form, merging, compressing and mail conversion leave the same structures; a file printed to PDF again erases them all |
| **Image forensics** | compression history (JPEG quantization tables, double compression) first; error level analysis and copy-move (keypoints matched inside one image) **only** where a bounded region is found over a figure or a signature area; metadata consistency (existing `IMG-META-*`) | `IMG-JPEG-001`, `IMG-PIX-001`, `IMG-PIX-002` | `inhabituel`: a pixel method alone is never `incohérent` | ELA and copy-move are noisy on text documents, screenshots and re-saved photos; no heat map is ever shown (people read colour as proof), the evidence is a box |
| **Content consistency** | the document's own figures: gross − deductions = net, year-to-date totals that add the period, opening balance + movements = closing, pay dates against the stated frequency; QPP/RRQ, QPIP/RQAP and EI/AE deductions against the year's rates and ceilings, **dated data with their official source**; the issuer's number printed on the document against the public registries | `CONTENT-PAY-001…003`, `CONTENT-BANK-001`, `CONTENT-DATE-001`, `REG-001…003` | `incohérent` only for arithmetic on the document's own figures; a rate gap is `inhabituel` (exemptions, retro pay, a second employer) | a forger who recomputes the figures passes; a field not read is a case that does not run, never a guess |
| **Cross-document** | one applicant's documents compared from their **facts**: employer on the stub vs the letter, net pay vs a deposit of that amount on the matching dates, the salary stated in the letter vs the stubs over the period | `FILE-001…003` | `incohérent` only when both sides are read with confidence and disagree | two jobs, a split deposit, another bank account, a raise: `inhabituel` at most when a side is missing or ambiguous |

Registries, where lawful: the Registraire des entreprises du Québec (NEQ), the CRA GST/HST registry and Revenu Québec's QST
number validation are public services about **businesses**. Only the number printed on the document is looked up, only
after the terms of use of each source are read and quoted (a source whose terms forbid automated use is not used); a sole
proprietorship registered under a person's name shows « registered / not found / struck off », never the name; nothing is
ever looked up from a person's name.

Refused on purpose:

- **A model that judges tampering** in a pay stub or a letter. A model asked to explain a signal explains signals it never
  received, and the error it makes most readily is the one that accuses an honest person (the pack's own rule). The vision
  reading of `identity-document-check` stays what it is: a reason for a person to look, never a failure alone.
- **AI-text detection on letters** (`message-authenticity`): measured unreliable on short and French texts, and a letter
  written with help is not an edited document.
- **Commercial fake-stub template fingerprints** in a first version: it needs real samples of those generators, which we
  will not collect from real people; a template is a later data entry once a lawful synthetic source exists.

### 3. Where it runs and what it costs

- **Detection is Sovkora's**: the `document-validation` pack, Studio `document-authenticity`, its worker
  (`sovkora-worker-validation`, Python, pypdf; Pillow HPND and OpenCV Apache-2.0 for the image cases). Deterministic, CPU
  only, no model, no GPU. The cross-document comparison is a new step of the same pack (`job.validation.file`) that receives
  **facts, not files**: the fields each document's run already returned.
- **Verikora** keeps what is a product's job: the registry connectors (ADR-0001 §1: third-party connectors live in
  Verikora, behind a `BusinessRegistry` port in `lib/registries/`), grouping one applicant's documents, the consent, the
  report, the applicant's answer. It never judges a document itself.
- **Cost per check**: a target of under 1 cent of compute per document (median CPU time measured by the corpus harness,
  §5; the image cases downscale to 2 MP and stop at 5 s). It is an estimate until the harness prints the measured figure.
  The cheapest plan sells a verification at 0,30 $ (ADR-0013), so authenticity stays inside the one verification a document
  already costs; the cross-document step is one more engine run per applicant file, counted as a verification and shown
  before it starts. A reused run (ADR-0005) costs nothing.

### 4. Privacy: consent, minimisation, Canada, retention

- **Consent and transparency**: an applicant's documents are examined only for the purpose they consented to
  (`applicant-consent`, purpose `DOCUMENTS`); the notice (a new `NOTICE_VERSION`) says that the files are examined as files,
  what is reported, that Verikora decides nothing, and how to answer (Law 25 s. 8 and 8.1). The applicant **sees the signals
  about their own documents** and can add an explanation and the issuer's original, shown next to the signal.
- **Minimisation**: only documents the applicant chose to give are compared; the product never asks for a bank statement to
  make a comparison possible (whether a landlord may ask for one at all is on the lawyer's list, #303). Signals and audit
  lines carry ids, levels and boxes, never a value of the document (an amount appears only inside the person's own report);
  no log carries an explanation.
- **Canada**: the bytes stay in Verikora's store in Canada (ADR-0012, #524) and go to Sovkora only for the run. Sovkora's
  hosting is « not stated » in `docs/privacy/transfers.md` today: **no production check on a real applicant's document runs
  before the engine states where its document workers run and keep data** (krizaka/sovkora-engine#196), and, if any part
  is outside Canada, before the EFVP covers it (Law 25 s. 17; `docs/privacy/efvp.md`).
- **Retention**: the pack is `SENSITIVE` (bytes in memory in the worker, the run record on the shortened schedule); in
  Verikora the signals are part of the analysis, follow the document's retention and are deleted with it (cascade); an
  erased screening erases the applicant's explanations.
- **No automatic stop**: a document signal is never a default cut-off of a screening (krizaka/sovkora-packs#181 replaces
  the default that stops on `incohérent`); Verikora's screening band (`no-concern · review · incomplete`) never reads
  authenticity signals.

### 5. Validation: a synthetic corpus, precision targets, false positives

- **The corpus is synthetic and ours**: a deterministic generator (fixed seed, no clock) of fictitious pay stubs, bank
  statements, employment letters and invoices for the demo personas, from fictitious issuers. Tampered variants are made by
  script with local tools (pypdf, pikepdf, qpdf, Ghostscript, LibreOffice, Pillow), each recording what changed and where:
  the ground truth. **Never a real person's document, never a real issuer's template or logo, never a file sent to an online
  editor.**
- **Ordinary negatives are the set that matters**: the same clean documents through ordinary workflows (printed to PDF,
  merged, compressed, signed, form-filled, converted by a mail client, scanned, photographed), at least 200.
- **Targets, enforced in CI** (the harness writes `results.json`; a case under the bar ships `enabled: false`, it is never
  loosened to pass):
  - an `incohérent` case fires on **no** ordinary negative (0 of ≥ 200, a 95 % upper bound of about 1,5 %);
  - an `inhabituel` case fires on **at most 5 %** of the ordinary negatives;
  - recall is **reported** per tamper type, not promised; the deterministic cases (an amount replaced in an incremental save,
    arithmetic that does not add up) are expected to find every corpus variant, and a miss is a bug.
- **False positives in production**: the applicant's explanation travels with the report; the « what to ask for » line
  sends the landlord to the issuer (« ask for the stub downloaded from the payroll portal », « call the employer on a number
  you found yourself »), not to a conclusion; a reported false positive becomes a corpus negative and a regression test.
- The measured numbers are **published** on the check's page and in the report's closing note, read from the pack's results
  at build, never typed in a message.

### 6. Output in the report, UI, EN/FR

- Each signal is a card in the same language as a compliance finding (the Section G check, #554): what we observed · where
  (page, « See in the file » lights the box in the same viewer, the revision for a later save) · what it may indicate, with
  its ordinary explanations · what to ask for · the applicant's explanation if any · the run id.
- Grouped by family (file history, layout and fonts, images, figures, across the file); an « Across the file » section for
  the cross-document signals, each pointing at both documents.
- A « what this check is not » box at the top: not a finding of forgery, nothing about the person, what was not examined.
- Levels in words; `incohérent` is a warning tone, **never red** (red reads as a verdict). No total, no sort.
- `@verikora/core` `signal` gains optional `evidence` (`page`, `box` in PDF points, `revision`, `field`) and `family`; old
  reports still parse. The signed PDF report carries the same cards. Every word in `messages/{en,fr}.json`.

## Slices, in order

Verikora (this repository), sub-issues of #102:

1. #625: the report shows each signal with its evidence, grouped, no verdict words, no red (can start now).
2. #626: the applicant sees the signals about their own documents and can answer.
3. #627: an issuer's business number against the public registries (terms read first).
4. #628: the measured numbers published (after krizaka/sovkora-packs#176).
5. #629: across the file, through the file-consistency step (after krizaka/sovkora-packs#179 and #180).
6. #630: a photographed document's original image read before cleaning (after krizaka/sovkora-packs#178).

For the Sovkora lane, also sub-issues of #102:

1. krizaka/sovkora-packs#176: the synthetic corpus and its measurement harness, the gate of every new case (**first**).
2. krizaka/sovkora-packs#181: no document signal as a default screening cut-off (independent, can start now).
3. krizaka/sovkora-engine#196: state where the document workers run and keep data (blocks production use).
4. krizaka/sovkora-packs#177: PDF structure v2 with evidence boxes.
5. krizaka/sovkora-packs#179: figures that do not add up, rates as dated data with sources.
6. krizaka/sovkora-packs#180: the file-consistency step.
7. krizaka/sovkora-packs#178: image forensics.

## Consequences

- #102's acceptance criteria change: no « tamper score 0-100 »; a structured report of signals with evidence boxes, and a
  benchmark on our synthetic corpus instead of « known forged paystubs ».
- The product says less than a competitor's « fraud score » and can defend every word of it; the price is that a careful
  forger passes, and the report says that too.
- Each new case costs a detector, two hand-written sentences, a fixture and a corpus measurement before it ships.
- Lawyer's reading (#303): the words of the « what this check is not » box, the applicant notice, whether asking for a bank
  statement is allowed, and the registry terms.
