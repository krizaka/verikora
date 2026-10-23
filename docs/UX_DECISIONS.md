# UX decisions

Each notable choice: the decision · the problem · the principle (with its source) · what we refused · what it costs · the
signal that would tell us we are wrong. Feedback: the pinned Discussion of the repository.

## 1. A finding always shows the passage it rests on

- **Decision**: every compliance finding shows its quoted passage; clicking it scrolls the document's text to the same
  passage, highlighted.
- **Problem**: a verdict without its evidence is taken on faith — or ignored.
- **Principle**: recognition over recall; evidence near the claim (Nielsen, *10 usability heuristics*, #6; Sweller,
  split-attention effect in cognitive load theory).
- **Refused**: a score, a summary paragraph written by a model.
- **Cost**: long reports; the text pane must stay readable at phone width (it scrolls in its own box).
- **Signal we are wrong**: people open the file instead of the text pane to check the passages.

## 2. Three plain levels for tampering signals, never a score

- **Decision**: observed · unusual · inconsistent, with what each may indicate; the report's own disclaimer on top.
- **Problem**: a percentage reads as a probability of fraud and gets quoted in a dispute.
- **Principle**: calibrated communication of uncertainty (Spiegelhalter, *Risk communication*, 2017).
- **Refused**: a red/green "authentic" stamp.
- **Cost**: no single number to sort by.
- **Signal we are wrong**: people ask "so is it fake?" after reading a report.

## 3. The run id is visible

- **Decision**: each check shows the Orazaka run id and the Studio version.
- **Problem**: "who decided this, on which rules?" must have an answer.
- **Principle**: traceability builds trust in automated advice (Lee & See, *Trust in automation*, 2004).
- **Refused**: hiding the engine behind a generic "AI".
- **Cost**: a technical detail on a business screen (kept in a small monospace line).
- **Signal we are wrong**: nobody ever copies a run id when reporting a problem.

## 4. The file and the findings side by side, the passage lit on the page

- **Decision**: the PDF is drawn page by page (pdf.js, through `@krizaka/ui/document-viewer`) on the left, kept in view
  while the findings scroll on the right; « Show in the file » scrolls to the quoted passage and lights it, one box per
  line, found from the PDF's own text positions. A passage the text layer cannot place is never drawn at a guessed
  place: the finding says « Page 3 (exact place not found) » or « Not found in the file's text layer ».
- **Problem**: checking a verdict against the file means hunting for the sentence by eye.
- **Principle**: evidence next to the claim, one action to see it (Nielsen #6; split-attention effect).
- **Refused**: an iframe of the browser's PDF reader (no way to light anything), a screenshot of the page, lighting a
  page when the quote is not found.
- **Cost**: pdf.js (~1 MB) is loaded on the document page only; boxes are per line, not per word (positions inside a
  text item are proportional); a scanned PDF has no text layer, so nothing is lit.
- **Signal we are wrong**: people still open « Its text » or the raw file to confirm a passage.

## 5. A signed audit report, and a members-only page where it is checked

- **Decision**: a finished compliance check exports a self-contained HTML report (print it to PDF) carrying the document's
  SHA-256, jurisdiction, rules version, Studio version, Orazaka run id, dates, every finding with passage and article, and
  an Ed25519 signature over those and over the report's own text. `/verify` checks a file for a signed-in member the report's owner gave access to (ADR-0002: leases and identity
  documents are confidential), with the original document if wanted, and says exactly what a green result guarantees and
  what it does not. Without a grant it says so and offers « Request access ».
- **Problem**: a firm must hand a client or an auditor something that cannot be quietly edited, and that says which
  document and which rules it is about.
- **Principle**: say what is guaranteed, no more (calibrated trust; Lee & See, 2004).
- **Refused**: a blockchain, an unsigned PDF, a « verified » badge with no explanation, a report that changes on every
  download (the same check always gives the same bytes).
- **Cost**: the trust is in Krizaka as the key holder; no independent time-stamp; a key rotation needs the old public
  key kept; the report is HTML, not a PDF file (printing it is the PDF).
- **Signal we are wrong**: a reader asks whether the report « proves the lease is legal ».

## 6. The proof is a real run — recorded, one per side of the lease

- **Decision** (revised 2026-10-17, Oussama): « A real run » shows two recorded runs, one per side of the lease — a
  fictitious tenant's lease and a landlord's template, each sent to Orazaka's compliance Studio on dev (Québec) and kept
  exactly as returned (`content/recorded-runs/`, written by `scripts/record-runs.mjs`): a summary line (counted, not typed),
  the findings with the non-compliant first, the sample with the quoted passages lit, the Orazaka run id (copy), the date
  and source of the recording, and the signed report. A page without a recorded run does not build.
- **Problem**: the first version read the one run an administrator promoted on the platform — and showed « nothing yet »
  until someone did. An empty proof is worse than none; and one lease spoke for one side only.
- **Principle**: show the evidence and the way to check it, not an assertion (calibrated trust; Lee & See, 2004); proof
  first, detail on demand (progressive disclosure).
- **Refused**: a typed or edited result, a screenshot of the viewer, an unflagged personal document, a hidden failure (a
  ruleset gap shown by a run is reported to the pack, not removed from the sample).
- **Cost**: the recording is redone with `scripts/record-runs.mjs` when the ruleset or the Studio changes, and the file
  committed; the recorded report cannot be verified on /verify (it is not an account's report).
- **Signal we are wrong**: visitors open the signed report but ask whether the sample is a real client, or the recording
  is older than the ruleset it shows.

## 7. The landing tells one story in five sections, and its proof is the real app recorded

- **Decision**: the home is five sections: the promise with the real journey recorded on dev.yomizaka.com (StepShowcase:
  a phone below md, a browser from md; keep → check → find, the check a live Orazaka run whose id is printed under it),
  three outcomes (each card a way in), how it works in three steps with the owl's promise, trust (Canada, traced, open
  source, Orazaka named once, the status read from dev-preview.json), the closing call. « A real run » moved to its own
  address (/run). The bar has one « Product » menu and no version chip; the version is in the footer.
- **Problem**: the old home had nine blocks (traps, decisions, two checks, search, the run…): a visitor met the details
  before knowing what the product does for them, and the real run was buried at the bottom.
- **Principle**: one idea per screen, proof before detail (progressive disclosure; Nielsen, 2006); recognition over
  recall: the visitor sees the product working instead of reading about it (Nielsen's heuristics, 1994).
- **Refused**: a generated « ambiance » video in the hero (it shows no product), a hand-made mock-up of the console, a
  version chip in the bar, more than one primary action per section.
- **Cost**: the recording must be redone when the console changes (`scripts/landing-journey.mjs`, new hashes in
  `lib/tour.ts`); the app is recorded in English, which the French caption says.
- **Signal we are wrong**: visitors leave the hero before the second step plays, or ask whether the recording is a mock-up.

## 8. Both sides of the lease: a landing per side, a role in the app

- **Decision**: the service is offered to the tenant (« locataire ») and the landlord (« locateur » in the legal sense,
  « propriétaire » in everyday copy). The home carries « Je suis locataire / Je suis propriétaire »: two links to two
  static, indexable addresses (`/fr/locataire`, `/fr/proprietaire`, `/en/tenant`, `/en/landlord`) whose hero, steps and
  examples speak to that side. In the app the side is asked once at onboarding (the library) and changeable in settings;
  it picks the check offered first (a landlord's « other » documents — the tenant's papers — start with the PDF
  examination) and the wording of the checks. The rules do not change: both sides run the same Orazaka Studios on the same
  rulesets (a side-specific rule would be data of the pack, not code here).
- **Problem**: the product spoke from one side only (the tenant checking a lease), while the landlord has the same need —
  a compliant template, the tenant's papers, a report to keep and share.
- **Principle**: speak to the person's task (jobs-to-be-done; Christensen, 2016) and let the URL carry the state, so a side
  is shareable and crawlable (progressive enhancement).
- **Refused**: a client-side toggle that hides the other side's copy (no address, no SEO), a different set of rules per
  side hard-coded here, a forced choice before the library opens (it asks, it does not block).
- **Cost**: two copies of the pitch in two languages to keep honest — every example is a finding of a real run; rent
  increase and other TAL rules are not in the Québec ruleset yet and are not promised.
- **Signal we are wrong**: visitors take the wrong side's page and bounce to the other, or never choose a side in the app.

## 9. The signed report is also a PDF

- **Decision**: a member (the owner, or someone the owner gave access to) downloads the report as an HTML file and as a signed
  PDF: the report's pages, then a visible signature page (key id, text fingerprint, signature), the attestation embedded in the
  file's Info dictionary. Verification reads it back, checks the Ed25519 signature, extracts the text of the pages and compares
  it with the signed fingerprint: a changed word is `ALTERED`. It signs what the file **says**, not its bytes (a viewer that
  re-saves a PDF changes the bytes). Same key, same grants, same audit as the HTML report; a specimen is rejected.
- **Problem**: people print and file reports, and send them to an accountant or a manager; HTML is not what they attach.
- **Principle**: meet the person's format (recognition over recall); say exactly what the signature covers (calibrated trust).
- **Refused**: PAdES/CMS certificate signatures (they need a certificate authority the product does not have: the trust is in
  Krizaka's key, as the report says), signing the bytes, a PDF served to anyone.
- **Cost**: standard fonts only (WinAnsi): French thin spaces, arrows, ≥ ≤ and check marks are folded to their plain equivalent, any other character prints as « ? » — in the signed text too; the file is not signed
  at the PDF-reader level, so a reader shows no « signed » badge.
- **Signal we are wrong**: people ask why their PDF reader does not show a signature, or re-save PDFs and expect them to verify.


## 10. Three small navigations: the bar, the library, the administration

- **Decision**: the public bar has five entries (Product, How it works, A real run, Privacy, Verify a report) and the family's
  language switch; the members' app has two (Library, Search) because everything else is reached from a document; the
  administration has seven pages in **three groups** — People and files (Overview, People, Documents), Flows and engine
  (Flows, Orazaka runs), Operations (Operations, Audit log) — each page its own address, shareable (`lib/admin-nav.ts`, guarded by
  `lib/admin-nav.test.ts`). Dates in the console are always written in Montréal's time zone, whoever draws them.
- **Problem**: the console grew a page per need (seven flat entries, two with the same icon) and its dates were drawn in the
  machine's own time zone on the server and again in the browser: React refused the page (hydration error #418) on five of its
  pages, found by the live walk (`scripts/check-admin-live.mjs`) on 2026-10-19.
- **Principle**: group by the operator's job, not by table (information architecture, Rosenfeld & Morville; Hick's law for the
  number of choices); one rendering for the server and the browser (React hydration contract).
- **Refused**: tabs for seven pages (the family allows about five in a bar), a page per audit action, the machine's time zone.
- **Cost**: a page moves under a group label when it is added; the time zone is the product's (Montréal), not the operator's.
- **Signal we are wrong**: the operator opens « Operations » to look for runs, or asks for dates in their own zone.

## 9. Three public pages: the home, sign-in, the privacy notice

- **Decision** (2026-10-21, krizaka/yomizaka#120): the signed-out site is the home (what Yomizaka does for you, one real
  check recorded as it came back, one way in: sign-in), sign-in and the legal page. The menu has three places (what it
  does, a real run, privacy) and the bar's actions. `/run`, `/changelog`, the four audience pages (§ 8) and the old
  « Pour qui ? » picker are gone: 308 to the home (`lib/removed-urls.mjs`). Orazaka is one quiet line under the proof.
- **Problem**: eleven page templates for a product in development, the same promise said on the home, on `/run` and on
  four audience pages; a bar with a dropdown to reach three of them; effects (animated flow, glow, counters) that read as
  template rather than as a tool.
- **Principle**: one idea per page, every page reachable from the menu, words and recorded data over decoration.
- **Refused**: an audience page per role (the app asks the side at onboarding, § 8), a changelog nobody asked for, a
  second proof on another address.
- **Cost**: the invoice, contract and landlord recordings are no longer shown (the landlord's stays in the repository for
  the recording script); a role's pitch lives in one line of the home.
- **Signal we are wrong**: invited users ask where the landlord or freelancer pages went.

## 10. One product bar: use the app first, and the signed-in person always visible

- **Decision** (2026-10-23, krizaka/yomizaka#243, krizaka-ui#505): the bar's primary action is using the app —
  « Sign in » while sign-up is closed, « Try Yomizaka » (then « Sign in » beside it) once the product's own setting opens it,
  « Open the app » and the avatar when signed in (`ProductBarActions` of `@krizaka/ui/nav-bar`). « Talk to us » is gone from
  the bar and the mobile panel; Contact stays in the footer. The public pages stay static: a client island asks
  `/api/me` (401 = signed out) and `/api/auth/sign-up/status` through `@krizaka/query`. The result only changes what is
  shown; the app and the API check the real session on every request (`lib/gate.test.ts`). In the app the account menu
  (avatar, name, e-mail, settings, theme, language, sign out) is in the header on every width.
- **Problem**: a signed-in person on the home saw « Sign in »; the bar pushed a sales call before the product.
- **Refused**: a hint cookie (a second source of truth that can lie); the account at the rail's foot (it adds an empty
  column to the phone's tab bar until the rail counts hidden children).
- **Signal we are wrong**: the avatar flashes « Sign in » visibly before the island answers.

## 11. The shell on Orazaka's pattern: destinations on the rail, the product in the header, the action in the header

- **Decision** (2026-10-23, the UX review of October 2026 — `docs/ux/2026-10-full-review.md`, krizaka/yomizaka#278, #281):
  the rail holds destinations only — Bibliothèque · Vérifications · Recherche — with the collapse control alone at its
  foot; the header names the product (`AppHeader name="Yomizaka"`), carries the DEV build as a chip and the one action of
  every signed-in screen, « Vérifier un document » (its word from `sm`, its icon with the same accessible name below);
  the account menu owns the settings (Profil · Réglages · Facturation · Langue · Thème · Se déconnecter) and shows the
  name only when there is one, never the raw address; every page draws its own `h1` with `PageHeader`. Vérifications is
  a destination: every check, newest first, « Lots » as a tab in the address (`?tab=lots`); `/app/verifier/lots` answers
  308 to it. On the public home the hero's action follows the session from the bar's own query — « Ouvrir mes documents »
  signed in, « Se connecter » and the status line otherwise — and the bar keeps a quiet account entry, no second primary.
- **Problem**: an action (« + Vérifier ») sat on the rail between two places, a cog and a lone chevron at its foot, the
  page's title in the header and no `h1` anywhere, the e-mail address beside the avatar; signed in, the home's hero still
  said « Sign in » beside a bar that said « Open the app ».
- **Principle**: where you work on the rail, who you are under the avatar, nothing in both; the header names the product,
  the page names itself; one primary action per screen; one answer for the whole page.
- **Refused**: a settings entry on the rail (the account owns it); hiding the header's action on a phone (its icon stays,
  named); a second « Open the app » button in the bar beside the hero's; a hint cookie for the hero (§ 10).
- **Cost**: at 360 px the header's action is an icon with a tooltip until `AppHeader` grows a `primary` slot
  (krizaka-ui#588); the theme row is composed by hand until `AccountMenu` takes a `theme` prop (krizaka-ui#589).
- **Signal we are wrong**: people look for « Vérifier » on the rail; the Vérifications list is opened less than the
  library's « Dernières vérifications ».

## 12. The library home answers « what did I check » before « what do I have », and takes a file anywhere

- **Decision** (2026-10-23, the UX review's Y3, krizaka/yomizaka#275, #281): under the page's `h1`, the five latest checks
  come first (from the same list as Vérifications, each a link to its report, « Tout voir » to the destination); the
  collections are link cards — a place mark, the name in the language being read, the count, the last check's result —
  with their menu beside the card, never inside the link; the recent documents keep the table, and on a phone its card
  shows the title and the result only. A file dragged anywhere on the page is checked (`DropOverlay`), and a tray follows
  the queue while the person keeps browsing. With nothing yet: the owl, one sentence, the only drop zone, two examples.
- **Problem**: the collection wore the account's person picture (a folder of leases looked like a contact), the home
  said what Éric had but not what he had checked, the drop zone and its two checkboxes sat on three screens, and a phone
  printed four label/value rows per document.
- **Principle**: the answer first; one drop zone per screen, the window itself elsewhere; a card is one link.
- **Refused**: the latest checks as « the first five recent documents » (a document is not a check); guessing a mark from a
  collection's name; a dev-only « Charger la démo » button (no endpoint does it; the seed is a script).
- **Cost**: one neutral place mark for every collection until krizaka-ui #590 ships the set; the checking options (keep,
  photos as pages) are the owner's defaults when a file is dropped on the page — Y4 asks them once the files are known.
- **Signal we are wrong**: people open a collection to find the report instead of the latest checks; files dropped on the
  page land in the default collection when a collection was meant.
## 13. The settings on SettingsLayout: routes as sections, flat rows, one save per section, who is signed in on top

- **Decision** (2026-10-23, the UX review's Y2, #281): the five sections stay routes (`/app/settings/<section>`) and are
  `SettingsLayout`'s navigation (chips that wrap on a phone, variant `flat`: one calm column, hairline rows); the
  identity card (`AccountProfileCard`: picture, name, verified address, member since) sits on top; the profile is one
  section with one save — name, picture (`AvatarPicker`), language (`LanguagePicker`), which side of the lease
  (`ChoiceCards`) — dirty → saving → saved, with an undo; billing is flat rows (plan, free audit, paid audits left,
  renewal) and one primary (« Passer à Pro »), the audit beside it, the portal as a quiet action; storage offers only
  the choices this installation can honour (the person's own S3 is absent where credentials cannot be kept — no
  operator's sentence) and keeps the default as a switch row; « Mes données » is two rows with their action.
- **Problem**: five tabs in a row pushed the page 167 px past a 390 px phone (197 px at 360 px); the profile was
  hand-made against the documented blocks (a save above the pictures, six loose radios, an unlabelled segmented bar, a
  second disabled save for the perspective); billing had two equal buttons; storage spoke to an operator.
- **Principle**: the documented block over a composition; one save per section; say only what the person can do.
- **Refused**: one long page with anchors (the sections are routes, the URL is the state, § 7); a save per field.
- **Cost**: the address and the password keep their own forms (two sections on the Security route: each needs the
  password, a different act from the profile's save).
- **Signal we are wrong**: people change the language and do not expect the page to move to it; the undo is never used.

## 14. Checking a document: drop first, the kind as a choice, the options once the files are known, the run on the drop

- **Decision** (2026-10-23, the UX review's Y4, #281; the CTO's answer to question 2): on « Vérifier un document » the
  drop zone comes first and large, « Quel document ? » under it as a choice grid (Automatique first; the URL is the
  state), and the options (keep the document, « these photos are one document ») fold under the zone once files are
  known — the grouping only with two photos or more. A file that landed opens on its report: the check starts at once
  when the kind is sure (the person named it, or Yomizaka recognised it with high confidence), otherwise the report tab
  asks to confirm. The rules follow the kind — Québec's named rulesets for an invoice or a contract, said in one line; a
  lease keeps its jurisdiction. While it runs, a step progress (Lecture › Contrôle › Règles › Rapport) tops the tab.
- **Problem**: the kind picker was a tab bar glued to the top with no question; two checkboxes made no sense before a
  file was chosen; the thing to do came fourth; after the upload the person landed on « Informations » and had to decide
  again on another tab; an invoice still showed the lease's jurisdiction.
- **Principle**: the thing to do first; ask once the question makes sense; one decision, not two.
- **Refused**: starting a run on an uncertain kind (a wrong file still costs a run); a jurisdiction menu for a kind whose
  rules are Québec's by name.
- **Cost**: a drop of several photos is grouped by the default (one document) before the option is visible; the option
  rules the next drop.
- **Signal we are wrong**: people cancel runs started on the drop; « Autre » is chosen to avoid the automatic start.
