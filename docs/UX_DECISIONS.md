# UX decisions

Each notable choice: the decision · the problem · the principle (with its source) · what we refused · what it costs · the
signal that would tell us we are wrong. Feedback: the pinned Discussion of the repository.

## 1. A finding always shows the passage it rests on

- **Decision**: every compliance finding shows its quoted passage; clicking it scrolls the document's text to the same
  passage, highlighted.
- **Problem**: a verdict without its evidence is taken on faith — or ignored.
- **Principle**: recognition over recall; evidence near the claim (Nielsen, _10 usability heuristics_, #6; Sweller,
  split-attention effect in cognitive load theory).
- **Refused**: a score, a summary paragraph written by a model.
- **Cost**: long reports; the text pane must stay readable at phone width (it scrolls in its own box).
- **Signal we are wrong**: people open the file instead of the text pane to check the passages.

## 2. Three plain levels for tampering signals, never a score

- **Decision**: observed · unusual · inconsistent, with what each may indicate; the report's own disclaimer on top.
- **Problem**: a percentage reads as a probability of fraud and gets quoted in a dispute.
- **Principle**: calibrated communication of uncertainty (Spiegelhalter, _Risk communication_, 2017).
- **Refused**: a red/green "authentic" stamp.
- **Cost**: no single number to sort by.
- **Signal we are wrong**: people ask "so is it fake?" after reading a report.

## 3. The run id is visible

- **Decision**: each check shows the Sovkora run id and the Studio version.
- **Problem**: "who decided this, on which rules?" must have an answer.
- **Principle**: traceability builds trust in automated advice (Lee & See, _Trust in automation_, 2004).
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
  SHA-256, jurisdiction, rules version, Studio version, Sovkora run id, dates, every finding with passage and article, and
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
  fictitious tenant's lease and a landlord's template, each sent to Sovkora's compliance Studio on dev (Québec) and kept
  exactly as returned (`content/recorded-runs/`, written by `scripts/record-runs.mjs`): a summary line (counted, not typed),
  the findings with the non-compliant first, the sample with the quoted passages lit, the Sovkora run id (copy), the date
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

- **Decision**: the home is five sections: the promise with the real journey recorded on dev.verikora.com (StepShowcase:
  a phone below md, a browser from md; keep → check → find, the check a live Sovkora run whose id is printed under it),
  three outcomes (each card a way in), how it works in three steps with the owl's promise, trust (Canada, traced, open
  source, Sovkora named once, the status read from dev-preview.json), the closing call. « A real run » moved to its own
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

> **Amended (krizaka-internal#2291, 2026-11-04): the first run starts a property manager in one click.** `/app/welcome` is « Vous gérez
> des logements ? Commencez ici. »: one card, « Propriétaire ou gestionnaire », preselected, the three next steps (ask an applicant
> for documents, check your lease template, share the report) and one primary « Commencer »; « Autre usage » (a disclosure with
> `aria-expanded`) unfolds the other sides. The decision below is kept: the app asks and never blocks, and the side changes in settings.

- **Decision**: the service is offered to the tenant (« locataire ») and the landlord (« locateur » in the legal sense,
  « propriétaire » in everyday copy). The home carries « Je suis locataire / Je suis propriétaire »: two links to two
  static, indexable addresses (`/fr/locataire`, `/fr/proprietaire`, `/en/tenant`, `/en/landlord`) whose hero, steps and
  examples speak to that side. In the app the side is asked once at onboarding (the library) and changeable in settings;
  it picks the check offered first (a landlord's « other » documents — the tenant's papers — start with the PDF
  examination) and the wording of the checks. The rules do not change: both sides run the same Sovkora Studios on the same
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
  (Flows, Sovkora runs), Operations (Operations, Audit log) — each page its own address, shareable (`lib/admin-nav.ts`, guarded by
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

- **Decision** (2026-10-21, krizaka/verikora#120): the signed-out site is the home (what Verikora does for you, one real
  check recorded as it came back, one way in: sign-in), sign-in and the legal page. The menu has three places (what it
  does, a real run, privacy) and the bar's actions. `/run`, `/changelog`, the four audience pages (§ 8) and the old
  « Pour qui ? » picker are gone: 308 to the home (`lib/removed-urls.mjs`). Sovkora is one quiet line under the proof.
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

- **Decision** (2026-10-23, krizaka/verikora#243, krizaka-ui#505): the bar's primary action is using the app —
  « Sign in » while sign-up is closed, « Try Verikora » (then « Sign in » beside it) once the product's own setting opens it,
  « Open the app » and the avatar when signed in (`ProductBarActions` of `@krizaka/ui/nav-bar`). « Talk to us » is gone from
  the bar and the mobile panel; Contact stays in the footer. The public pages stay static: a client island asks
  `/api/me` (401 = signed out) and `/api/auth/sign-up/status` through `@krizaka/query`. The result only changes what is
  shown; the app and the API check the real session on every request (`lib/gate.test.ts`). In the app the account menu
  (avatar, name, e-mail, settings, theme, language, sign out) is in the header on every width.
- **Problem**: a signed-in person on the home saw « Sign in »; the bar pushed a sales call before the product.
- **Refused**: a hint cookie (a second source of truth that can lie); the account at the rail's foot (it adds an empty
  column to the phone's tab bar until the rail counts hidden children).
- **Signal we are wrong**: the avatar flashes « Sign in » visibly before the island answers.

## 11. The shell on Sovkora's pattern: destinations on the rail, the product in the header, the action in the header

- **Decision** (2026-10-23, the UX review of October 2026 — `docs/ux/2026-10-full-review.md`, krizaka/verikora#278, #281):
  the rail holds destinations only — Bibliothèque · Vérifications · Recherche — with the collapse control alone at its
  foot; the header names the product (`AppHeader name="Verikora"`), carries the DEV build as a chip and the one action of
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

- **Decision** (2026-10-23, the UX review's Y3, krizaka/verikora#275, #281): under the page's `h1`, the five latest checks
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
  when the kind is sure (the person named it, or Verikora recognised it with high confidence), otherwise the report tab
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

## 29. « Dossiers » as a binder: the decision states as tabs with their counts, the tags as chips (P17, #334)

- The decision set's states are **binder tabs** (`Tabs.Nav variant="binder"`, Krizaka UI 3.55): « Tous », then À décider · Retenu · Non retenu in the set's order, each in the tone of its state. The tabs are links; the address is the state (`?status=`).
- The tags are chips under the tabs, each with its count; a chip toggles the tag in the address.
- **A count is the length of its view.** Each tab and chip carries the filters it opens (`binderPlan`), and the page counts them with `countApplicantFiles`, which uses the same `filterSql` as the list. The test compares both. The count is not capped at the list's 100 rows.
- The system views that a tab already shows are not repeated in the views bar; « Décidés » and the person's saved views stay there.

## 27. The B2 shell: Accueil · Dossiers · Documents · Vérifications, the family's top bar, ⌘K for search (P14, #331)

- **One section map, four destinations**: `SECTION_IDS` is `library` (shown « Accueil » / « Home ») · `files` (« Dossiers », offered with
  the applicant-file flow) · `documents` · `checks`. The rail, the phone's tabs and the Mac's « Aller » menu are drawn from it
  (`sectionsFor`); « Recherche » leaves the map. « Documents » is new on the web (`/app/documents`, every document newest first in
  the collections' table); the phone and the Mac say why they do not have it yet (`pending`) and reach the documents through the
  library. A document's page, and the search page, light « Documents »; a collection lights « Accueil ».
- **The bar is `AppHeader` (@krizaka/ui 3.55, krizaka-ui#640)**, slots in its fixed order: `search` · `language` · `primary` · `account`.
  Search is `AppHeaderSearch` (a field from `md`, an icon below, ⌘K / Ctrl K) opening a `CommandDialog` that asks the same
  `/api/search` as the search page; a hit opens its document, « Tous les résultats » leads to the page with the query in its
  address. The language is `LanguageSwitch` (it left the account menu). The one action is a `gradient` cut button. The account
  shows the name from 1024 px (`showName="lg"`) and holds « Crédits et usage », not « Facturation ».
- **No messages and no notifications**: Verikora has no messaging, and notifications wait for `@krizaka/notifications`
  (krizaka-ts#60). An empty slot is hidden, never filled with an invented feature; a test holds it.
- **The rail's badge** on « Dossiers » counts the files the candidate sent and nobody decided (`filesToDecide`, one query that
  equals the home's « Dossiers à décider »), said in words for a screen reader (« 2 dossiers à décider »).
- Refused: a search destination in the rail (⌘K is faster, and the page stays for « Tous les résultats »); a notification bell
  with nothing behind it; a second language control in the account menu.
- Cost: the rail has no entry for the search page, which is reached from ⌘K or its address. We are wrong if people look for
  « Recherche » in the rail: then the field in the bar is too quiet at 1024–1279 px.

## 28. Phone lists are list rows: a title, one line of facts, the result at the end (P12, #329)

- On a phone, « Vérifications », « Dossiers » and the documents of a collection draw each row as a list row
  (`DataTable phone="list"`, @krizaka/ui 3.55, krizaka-ui#636): the checkbox when the table is selectable, the title as the row's
  link (`type: "title"` with `href`), **one line of facts** (the `priority: 2` columns joined: « Bail · 20 oct. 2026 »), the result
  or the decision at the end (`type: "status"`); everything else (size, studio, run id, tags) waits in the row's detail.
  No box in the box, no label-and-value pair per row (no `dl`).
- The facts: documents and checks = the kind and the day; files = the link's line (« Documents envoyés le 22 oct. »).
- Wide screens keep the table, unchanged. Tested on the markup of each table: one title, one facts line, one status, no `dl`.
- Cost: a phone shows two lines per row, not the whole record; the detail is one tap.

## 26. The organised workspace: your decision, tags with markers, saved views, bulk actions (P7, #324)

Krizaka-ts ADR-003, `@krizaka/organize` 0.4. Verikora is the pilot, on « Dossiers » and on the documents' tags.

- **Decision**: a manager decides an applicant file with a status set kept as data in the database (`organize.kind_config`,
  seeded once, edited by the administration through `PUT /api/admin/organize/<kind>/config`, versioned). The set is
  **À décider → Retenu | Non retenu**; both targets are final and « Non retenu » asks a second press (`confirm`). No reason is
  accepted: there is no free-text note about a person, and no list of reasons yet. « Non retenu » is `neutral`, never `danger`.
- **Deciding closes the file, in the same transaction**: the link is revoked and closed, every document is purged from the
  database and the store (Loi 25), the reports stay, and one audit line per file is written (`organize.status_changed`, then
  `applicant-file.closed` with the purge count). If a kept file's store is not there, nothing is decided. A decision cannot be
  undone, because the documents are gone: no undo is offered after a final state (`undoOf`).
- **Two people deciding the same file at once** give one decision and one refusal: the layer locks the row (`FOR UPDATE`), the
  second sees a final state (`MOVE_NOT_ALLOWED`, or `STALE` when it passed the state it had seen). Tested on PostgreSQL.
- **Two axes, never one chip**: the link's state stays the system's line of facts; the decision is its own column, « Votre
  décision », sorted by the set's order (`lib/workspace/order.ts`), never by a check's result.
- **Tags** have a colour **marker** from the closed palette (blue · green · amber · red · violet · gray) and always a written
  name. Files and documents have their own tags per kind. A document's tags moved from the first layer to the workspace
  (migration 0033 copies names and markers, then drops `document_tags`); a collection's and a folder's stay as they were.
  Documents have **no status** in v1: they already carry Sovkora's fact.
- **Saved views**: the address holds the state (`?view=&tags=&status=&q=`), the database keeps the name. The system views
  (« À décider », « Décidés ») come first, then the account's, then the person's. On a phone the views are a menu.
- **Bulk**: at most 200 files, one transaction, one audit line per file; a foreign id is 404 for the whole call; what cannot
  move is named in `skipped`.
- **The screens**: « Dossiers » gains the column « Votre décision » (the set's chip, sorted by the set's order), the tags with
  their marker, the views (a bar from `sm`, one menu on a phone), a filter bar (Étiquette, Décision) whose chips remove one
  filter, the count, and a selectable table whose bar tags, untags and decides. A file's page has « Votre décision » (the moves
  the set allows from its state, « Non retenu » armed by a first press and sent by the second, `expect` carrying the state seen)
  and its tags. After a decision nothing is offered. Pure rules: `press`, `resolveView`.
- **Krizaka UI's pieces (@krizaka/ui 3.59, ADR-006 § 6)**: the local wrappers are gone. Tags are `TagChip` (name beside its marker),
  the new-tag field is `TagSelector creatable` (with the colour choice), the decision chip is `StatusChip`, the views are the `views`
  of `FilterBar` (`SavedViews`: a menu on a phone; `useSavedViews` only binds them to the API and the address), the selection bar is
  `DataTable bulkActions` (`BulkActions` gives it the actions; the 200 ceiling is the bar's). The administration edits the
  vocabulary on `TagSetEditor` and `StatusSetEditor` (`/config/organisation`, versioned, a stale editor is refused).
- **Appearance** (`/app/settings/apparence`): `AppearanceSettings` with `useAppearance()` — System · Light · Dark (dark by default) and
  the density, kept in the browser. The language stays in the profile; no accent (the product keeps its indigo), no surface set, no sound.
- **No customer webhook yet**: the layer's event has no consumer and the webhooks' event list is public API; nothing is
  emitted until a customer asks.
- Refused: a score or a « best first » order; pre-filling a decision; a free-text reason; a status on documents; a hex colour;
  two sources of truth for the documents' tags.
- Cost: a decision is irreversible (the documents are purged), so the refusal asks twice and the page says so.
- We are wrong if managers keep a decided file open by hand to keep its documents, or ask to change a decision: then a
  « reopen » with a new request to the applicant, never an undo.

## 25. The states pass: a skeleton per page in its shape, errors in place, NO_TEXT said, the demo note at the foot (P11, #328)

- **Decision** (design § 3.5): every page of the signed-in space has its own `loading.tsx` and `error.tsx`, both on
  `components/console/SegmentStates.tsx`. The loading is the page's shape in @krizaka/ui `Skeleton`s (home: the doors,
  the drop and rows; a list: filters and rows; a report: the verdict band, rows and the aside; the check: the defaults
  line and the drop; the settings: sections; the search: the field and rows), announced once (`role="status"`,
  `aria-busy`) and shown only after 300 ms (`ym-wait`), so a quick page never flashes one. The error is a danger `Alert`
  in place, the cause in words and « Réessayer » (Next's `retry`); the rail and the bar stay usable; the raw message
  stays in the logs.
- **No spinner outside a button**: the only spinner is a `Button`'s `loading`; a test refuses `Spinner` and
  `animate-spin` in the components and pages.
- **NO_TEXT**: « Ce PDF n'a pas de couche texte : la vérification au regard de la loi n'a pas pu lire ses clauses.
  L'examen du fichier, lui, a lieu. » (why, and what still runs).
- **The demo note** of a seeded check moves from the folded technical details to the report's foot, as a footnote
  after the review note (never a box above the report).
- **Refused**: one `loading.tsx` at the root of the app (one shape for every page is the centred spinner by another
  name); a toast for a failure the person must act on.
- **Cost**: 38 small files (two per page); a new page must bring its two, or `states.test.tsx` fails.
- **Signal we are wrong**: people retry a page that keeps failing (the cause is not theirs: the error needs a status
  link), or a skeleton shows on most visits (the pages are too slow, not the states too visible).

## 24. The public site, plain: no eyebrow, no figures row, no mono captions, a bento without an orphan (P10, #327)

- **Decision**: the home is the product's site, not a Cahier site (design § 3.2, finding 10). `LandingPage` gets no
  `eyebrow` (the blocks draw it in the margin's red and the typewriter face), no `proofs` (the figures band under the
  hero, a tell ADR-004 retired: the figures stay as one plain line in « La preuve »), no `visualLabel` (the window bar's
  mono caption; the frame keeps the caption as its accessible name). The owl stays once; its caption is read by a screen reader, not shown in the mono. The
  three things are of the same weight: one row of the bento, no 2 + 1 orphan. « Pour qui » drops its `Facts` chips (the blocks draw them as mono words): its lead already names who it is for. The lease excerpt, the cited article and
  the run's line are in the sans; the mono is for code only (`<code>`, `<pre>`: the key id, the public key, the hashes).
- **Y9's leftover**: the trust line says where the data lives as the storage choice has it (ADR-0007): Toronto by
  default, the customer's own storage when chosen.
- **Guard**: `components/home/plain.test.tsx` reads every public component (every `font-mono` on a `<code>`/`<pre>`, no
  margin red, no eyebrow) and renders the home (no eyebrow, no band, no caption, every bento row full).
- **Refused**: overriding the blocks' faces in `globals.css` (a copy of krizaka-ui's decisions); the visual and the words
  stay its own.
- **Cost**: the hero says less at a glance (no figures); the proof's line carries them.
- **Signal we are wrong**: visitors stop scrolling to « La preuve » and miss the run's figures.

## 23. The check flow: the defaults before the drop, one row per file in words, an uncertain kind asked per file (P9, #326)

- **Before the drop** (Errata 6), « Vérifier un document » says its defaults in one line: « Effacé après la vérification ·
  Règles du Québec en vigueur aujourd'hui · dans « Mes documents » », with « Modifier » to unfold the choice of keeping.
  This reverses the review's B4 (options only once files are known) on this page only; « Ces photos sont les pages d'un
  document » still comes once photos are known (C3), and the library's drop keeps B4.
- **One row per file** once it landed (`lib/check-queue.ts`): « Lecture du document… », « Lancement de la
  vérification… », « Vérification lancée », « Non lancée : … ». Every stage is a word, so reduced motion loses nothing.
  The run's own stages come with #208 when sovkora#189 lands.
- **A confident kind starts on the drop; an uncertain one is asked « Quel document ? » for that file only**, its own
  question under the list. A single file opens its report as soon as it is under way; with several, each row links to its
  report, and nothing navigates away from the others.

## 22. The home's data: « À traiter » as doors, the activity of a period, « Récents » off the home (P8, #325)

- **« À traiter »** comes first: the checks to look at (Sovkora flagged a point, or the run did not end), and with the
  applicant-file flow the files to decide (documents sent, file not closed) and the open links (with the first expiry).
  Each figure is a query over the rows its view lists, and a link to that view **with its filter in the address**
  (`/app/verifications?result=attention,failed`, `/app/dossiers?state=used`, `?state=open`). At zero, one line:
  « Rien à traiter ».
- **The activity** of 7, 30 or 90 days (30 by default, `?period=` in the address): the checks of each day in Québec,
  every day present. This slice shows the total; the strip, the sparklines and the weekly chart are B2's (P15).
- **« Récents » leaves the home**: every document is in its collection and in Recherche.
- « Dossiers » reads `?state=` and says the filter, with « Tout voir ».

## 21. One section map on the web, the phone and the Mac (verikora#319, P2 of the design direction)

- **Problem**: three apps, three maps: the web's rail (Bibliothèque · Vérifications · Recherche), the phone's tabs
  (Vérifier · Bibliothèque · Réglages) and the Mac's sidebar (Library · Batches · Reports, ⌘1 to ⌘3).
- **Principle**: one list in `packages/core` (`SECTIONS`, `sectionsFor(platform)`), labelled `sections.<id>` in every
  catalogue: Bibliothèque · Dossiers · Vérifications · Recherche. « Dossiers » is shown only to the people offered the
  applicant-file flow. « Lots » is a tab of Vérifications everywhere. « Vérifier un document » is the header's one
  action (the phone's « + »), and the settings live under the avatar. The Mac numbers what it shows, ⌘1 to ⌘4, and builds
  its « Aller » menu from the same list.
- **Refused**: a different map per platform. A platform that lacks a screen says why in the map (`pending`): Dossiers on
  the phone and the Mac (P6), and Recherche there (no search call in `@verikora/client` yet, and ⌘K with P14).
- **Cost**: the phone no longer opens a « Réglages » tab (the avatar does); the Mac's « Rapports » is now « Vérifications ».
- **Signal we are wrong**: people look for the settings in the phone's tab bar.

## 20. « Quel document ? » only when the kind is uncertain (verikora#318, P1 of the design direction)

- **Problem**: `/app/verifier` asked the kind of every file before the drop, as a five-tile story grid (`ChoiceGrid`)
  whose name and hint read glued without its stylesheet (#316); most files are recognised, so the question was noise.
- **Principle**: ask only what Verikora does not know (§ 5.4): the page opens on the drop zone; a file recognised with
  high confidence starts its check and opens on its report; an uncertain one is asked « Quel document ? » with
  `ChoiceCards` (the four kinds, a title and a hint each, a labelled radio group), for that file only.
- **Refused**: keeping « Automatique » as a fifth card (it is what the drop already does); a local card grid.
- **Cost**: choosing the kind before the drop is only `?type=` in the address now (links that name it keep working);
  a mismatch between the named and the read kind is still confirmed on the report tab.
- **Signal we are wrong**: people drop, then look for a way to say the kind before Verikora asks.

## 19. The public home: the product's answer on screen, the session answered once, no void above the hero

- **Decision** (2026-10-23, the UX review's Y9, #281): the home is `LandingPage` — the promise beside the product's answer
  itself: the recorded check in a panel that grows with its text (the lease line lit, the finding Verikora returned, its
  article — the `BeforeAfter` block, read from the recorded run, nothing drawn by hand; a fixed-aspect device frame
  clipped the finding on a phone), the figures of that run under it
  (rules checked, articles cited, findings), the three things as a bento (signature icons), the run's facts with the owl
  once (`MascotQuote` callout), who it is for (`Facts`), one closing call whose sentence and action follow the same session answer as the hero
  (signed in: the documents; signed out: the way in — never « sign in » to someone who is). The hero's action and status
  line read the same `/api/me` answer as the bar (F0, Y1); the landing's hero frame pads itself with `--kz-hero-top`
  (nothing added on `main`, or the offset doubles); the page starts 24 px under the fixed bar (`--kz-hero-top` = 92 px, no `pt-20`, on
  every public page); at 390 × 844 the visual sits in the first screen. Captures are taken once, on the final design: the
  recorded steps of the real app (`StepShowcase`) take the panel's place then, never a screenshot of a design in progress.
- **Problem**: a 236 px void above the hero (F6); the product never shown — a text hero with an empty right half, three
  `h3`s, one mono block (F7); a phone's first screen without product or proof (F8); flat sections (F9).
- **Principle**: show the product's answer, not a description of it; every figure from a recorded run; one answer per screen.
- **Refused**: « no mascot quote » and « no backdrop » from the earlier home (#120, § 2): the review, validated, puts the owl
  once and the brand's dome behind the hero — no grid, no counter, no glow; screenshots of screens still being redesigned;
  a second primary action (the closing call is secondary — the hero's island holds the one primary).
- **Cost**: the proof block appears once (in the hero's panel), so the « Une vraie vérification » section keeps only the
  figures, the run's facts and the owl; CI measures the rendered hero frame against the real bar and refuses a panel that
  clips its text; the recording is a follow-up once the design is final.
- **Signal we are wrong**: the frame is scrolled past without a pause; people look for the figures' source and do not find
  the run's facts under them.

## 18. The 404: the owl's page, in the language of the address

- **Decision** (2026-10-23, the UX review's Y10, #281): a page that does not exist (or is not this person's) is `ErrorPage` —
  the code drawn, the owl, « Cette page n'existe pas. », one line, and the ways back: « Retour à la bibliothèque » (primary)
  then « Accueil » — in the language of the address. The proxy carries that language to the page as `x-locale` (a 404 has no
  route and no params); every language segment is routed to this one page, which is the site's 404. CI asks the container
  for `/fr/nope` and `/en/nope`: a 404 status and the words of the language.
- **Problem**: the 404 said « Not found · Introuvable » in both languages at once, with one bare link.
- **Principle**: one language per page, the one the address says; the way back is the place the person uses.
- **Refused**: a search on the 404 (the console has one; the public site does not need one yet); a « lost » owl (the mood does
  not exist in Krizaka UI yet — krizaka-ui is asked; `empty` until then).
- **Cost**: a request header to carry (`x-locale`), set by the proxy for every page — the proxy now walks every localised
  address, even one with a dot in a segment; a catch-all route (`[...rest]`) under the language, since a segment's own
  `not-found` answers only `notFound()` from a matched route; on the admin host the way back is the console.
- **Signal we are wrong**: people land on the 404 from an old address we could have redirected (then the redirect, not the page).

## 17. The collection: the header says what is here, folders as a row, the drop on the whole page, the tags as a filter bar

- **Decision** (2026-10-23, the UX review's Y7, #281): a collection (or a folder) is `PageHeader` — the breadcrumb whose
  root is « Bibliothèque », the place mark and the name, the counts under it (« 2 dossiers · 12 fichiers »), the actions:
  « Ajouter des documents » (the page's file picker), « Nouveau dossier », the ⋯ menu of the place (a folder's menu is on
  the folder's page, no longer on each card). The folders are a row of chips with their counts. The tags are a
  `FilterBar` (`?tags=`, the URL is the state), the table keeps its own filters (title, kind, state). A file dragged
  anywhere on the page is filed into this place and checked when its kind is sure; the only drop zone is the empty
  collection's. The search says « 1 résultat » and « 3 résultats ».
- **Problem**: the collection repeated the drop zone under the table (B4); the folders were cards with a menu each
  (three per row, a page for six folders); the table's filter read « Rechercher dans « Document » » (B6); the search
  said « 1 résultat(s) » (H1).
- **Principle**: the header answers « where am I, what is here, what can I do »; one drop zone per screen (§ 12).
- **Refused**: a tree in a side panel (a collection rarely has more than a handful of folders); moving the table's
  filters into the bar (the table's are the documented ones; the bar holds what the table cannot: the tags).
- **Cost**: a folder's menu is one click further (open the folder first) — and once the folder is deleted or moved from
  its own page, the page leads to the collection or to the folder's new address, never to a dead one; the tag menu lists
  names without their colour (the chips and the table keep it); photos dropped together are one document (the task
  page's default), said in the tray.
- **Signal we are wrong**: people look for the folder's menu on the chip; the folder row wraps on three lines.

## 16. Vérifications: the filters in the address, their counts on the menus, a « nothing matches » that clears itself

- **Decision** (2026-10-23, the UX review's Y6, #281): above the list of checks, `FilterBar` — a search on the title, the
  result, the kind and the period as `FilterMenu`s (each option with the count it would give, the other filters in
  force), the filters in force as removable chips, the count of checks. Every filter is a key of the address
  (`?q=&result=&kind=&period=`, `lib/check-filters.ts`): a filtered list is a link, back undoes a filter, a stale value
  is dropped. Filters that keep nothing say « Aucune vérification ne correspond » and offer « Effacer les filtres » (the
  plain address); the owl's « Aucune vérification encore » stays for an account with no check. The periods read the
  server's `now` in the console's zone (America/Toronto, as every date shown), so the server and the browser keep the
  same rows; a choice (a menu, a chip, « Effacer ») is a history step Back undoes, typing is replaced as it goes.
- **Problem**: up to 500 checks and no way in but the table's own text filter; a result could not be shared as a link.
- **Principle**: the URL is the state (§ 7); the count before the click.
- **Refused**: the `DataTable`'s column filters (not in the address, no period); a date picker (three periods answer
  the question; a range comes when someone asks for one); server-side filtering (the list is capped at the newest 500,
  filtered on the client in one pass).
- **Cost**: the filters apply to the rows the page loaded; the search field keeps what is typed until the address
  carries it.
- **Signal we are wrong**: people type a date in the search; the chips wrap on three lines at 360 px.

## 15. The document on DetailLayout: the verdict first, the tabs as routes, the engine's facts folded

- **Decision** (2026-10-23, the UX review's Y5, #281): the document page is `DetailLayout` — back to the library, the kind
  and the filename as the eyebrow, one h1 that says what the document is and who it is with (`displayTitle`: the
  insight's nature and the tenant — or the other party, or the issuer —, the stored title when nothing is sure), the
  status chip, pages · size · retention as the meta, one primary action by state (« Télécharger le rapport » once a real
  check finished; nothing to press before), the rest in a ⋯ menu (open the file, the PDF, delete with a confirm). Three
  tabs are three routes: `/rapport` — the verdict band (the points to look at on the rules read, in the report's tone,
  one line of context: the jurisdiction's rules, the ruleset, its date), the findings with what failed first (blocking
  before major, in words and tone, the quote, the article; what passed folded), then the engine's facts folded (the run
  id once, the Studio version, the ruleset, the dates, the report's fingerprint and key) and the detailed note folded;
  `/document` — the file or its text, what Verikora read (each kind of amount once), where it lives, the file facts;
  `/historique` — only once a second run exists. The sharing sits in the side panel, only for a check that can be
  certified; a seeded demo check says it has no certified report. The old addresses (`/infos`, `/fichier`, `/texte`,
  `/verifications`) answer 308 to their tab.
- **Problem**: the filename was the title (« bail-rosemont-5.pdf »); the run id, the Studio version and the fingerprint
  sat on the face before the verdict; severities read as codes (BLOCKING, DETERMINISTIC); the amounts repeated; four
  tabs for two things; two equal export buttons.
- **Principle**: the answer first, the proof on demand; the title is what the document is, not what the file is called;
  one primary action by state.
- **Refused**: a verdict of Verikora's own (the report's figures only — rules read, points to look at —, never
  « conforme »); a tab per analysis; hiding the run id (it is in the technical details, once); a local copy of a verdict
  block (K5 goes to krizaka-ui; until it ships, the band is `Stat` in a toned section and the findings are cards).
- **Cost**: the authenticity signals share the report tab, under the verdict; a document with no check shows the start
  cards under « Pas encore vérifié »; « Voir dans le fichier » moves to the document tab, where the passage is lit.
- **Signal we are wrong**: people open the technical details on every report to find the run id; the switch to the
  document tab on « Voir dans le fichier » loses them.

## The report: numbered findings, the codes in the technical details, the other checks in the aside (P4, #321)

- **Findings are numbered** in reading order (what needs a look from 1, blocking before important, then what passed,
  folded and numbered on), in tabular figures in a 2 rem margin column. The signed PDF will number them the same way
  (P13). The margin layout of B2 waits on krizaka-ui#645; until then the number sits in the finding's row.
- **Severity is a word**: Bloquant · Important · À considérer. A failed finding no longer wears a second « Point non
  respecté » chip; « Éléments insuffisants » is kept, because it says something the severity does not.
- **Codes and the method are off the face**: the verdict says « Règles du Québec · en vigueur le … » (no ruleset id), an
  untitled finding is « Règle 3 », and « Détails techniques » lists each finding's number, rule id and method, with the
  run id once.
- A failed finding without a quote says « Aucun passage du document cité » — not « Absent du document », which the engine
  does not claim for every rule.
- **The review note is a footnote** (`Footnotes` of @krizaka/ui) the verdict points to, never a line in the band.
- **The other checks are actions of the aside** (« Revérifier à une autre date », « Examiner le fichier (authenticité) »),
  each opening its form in a `Dialog`: the report no longer ends in forms. A refusal carried in the address opens the
  dialog at once. The aside also holds the facts (collection, file, retention); the way back leads to the collection.

## Plain typography in the app (P5, #322)

- The sans for everything, the mono only for codes and identifiers inside « Détails techniques »: the run id, the
  report's fingerprint and key, each finding's rule id (the report), and the file's SHA-256 (the document tab, now in its
  own folded « Détails techniques »). Filenames, references, a signal's name, the document's text and the run column of
  Vérifications are in the sans (tabular figures where they are numbers).
- `components/console/typography.test.ts` holds the line for the console and the Mac app's components. The Mac app's
  faces come from `blocks.css` under `data-surface="product"` (#317) until krizaka-ui#632 moves them into the brand files.

## « Dossiers »: the applicant files' list and detail (P6, #323)

- `/app/dossiers` (the section map's « Dossiers » now leads there) lists the files of `listApplicantFiles`, newest first:
  the applicant, **the link's state as a line of facts** (`linkState` → « Lien ouvert jusqu'au 7 nov. », « Documents
  envoyés le 22 oct. », « Dossier fermé le … », expired, revoked, erased), the documents in against those asked, and the
  day it was asked. There is no status chip: the decision is P7 (krizaka-ts#89), and the list never sorts by a check's result.
- `/app/dossiers/[id]` lists the documents asked, each with the one received. A row says what becomes of the document
  (deleted after its checks, or kept until the decision with the applicant's consent) and gives its checks in words as
  Sovkora returned them. It leads to the document's report, where the run ids are.
- « Demander des documents » is a dialog on `createKrizakaForm`. It offers only the requestable types: the minimisation
  list (SIN, health card, passport, licence, bank details) is never offered, the form's schema refuses it, and the service
  keeps its 422 `TYPE_NOT_NECESSARY`. The link comes back once and is shown once, to copy. The applicant's page is `/[locale]/dossier/[token]` (#341).
- The empty state has the owl (`empty`), one sentence and the one action.
- The provider screening (`/app/screening`) stays where it is and still belongs to « Dossiers » in the rail, until it
  becomes a section of the file (design § 6).

## The applicant's page for an applicant file (#341)

- `/{locale}/dossier/{token}` answers the link `applicantLink` hands over. Public by token, never indexed, never cached,
  `referrer: no-referrer`, like `/screening/[token]`. `loadApplicantPage` reads it by `fileByToken`, which only knows the
  files: a screening's token (or an unknown one) is a 404, a closed, expired, revoked or erased link opens the page and says so
  (`linkState`, the codes of `applicantFile.error`).
- From top to bottom: the title and the expiry; the notice (folded, its version said); **the consent per purpose** — the
  check, and keeping until the decision — then **the documents asked**, in the request's order, each with « what » and a
  PDF drop (`FileUpload`: `Dropzone`, `UploadList` with its pause and retry); « Envoyer mon dossier »; the erasure on a
  two-press `ConfirmButton`.
- Nothing is offered that the API would refuse: **no drop before the consent to the check** (it says so in place of the
  drop's silence), no « Envoyer » without one document received, no new consent on a closed link. A consent already given
  can be withdrawn, and the file erased, until it is erased. The routes keep their own rules.
- The notice's « {days} days » sentence belongs to the provider screening; the file's notice says only what is proven
  (a document is deleted after its checks unless kept with consent; deletion on request). It is the lawyer's to review.

## B2 home: the binder on top, two columns, the activity strip, the credits (P15, #332)

> **Amended (krizaka-internal#2290, 2026-11-04): for a property manager the applicant files come first.** The home's first block is
> « Dossiers de candidats » (five rows at most, applicant as title, documents received of asked, the state as a badge in words, each
> row opens `/app/dossiers/[id]`; « Demander des documents » is the section's secondary action), then « Mes documents » (the
> collections, compact), then the credits as one muted line. The binder-on-top order below no longer holds. One primary action: the
> header's « Vérifier un document »; the dashed drop zone, its second primary and the « Ou essayez » chips are gone (the first-run
> empty state keeps them). Dropping a file anywhere on the page still checks it. Not built yet: the « À traiter » column and
> « Dernières vérifications ».

- The home is `DashboardLayout` (« Operate »): the `h1` « Bibliothèque » on the left and **today's date on the right** (a `time`, under the
  title on a phone), **one sentence** under it whose figures are links — « Vous avez 6 vérifications à regarder, 2 dossiers à décider
  et 1 lien de dépôt ouvert. » (`leadParts`: the plurals are messages, the list is the locale's `Intl.ListFormat`, a figure at zero is
  left out, all at zero is « Rien à traiter »). Each link opens the view it counts, its filter in the address (`toDoLinks`, P8).
- **Main column:** « Le classeur » — the collections as binder tabs (`Tabs.Nav variant="binder"`) with their file counts; the open
  one is in the address (`?collection=`, the default collection otherwise) and its card is the panel. The tab's colour follows
  its last check, and the name and the count always say it. Then « Dernières vérifications ».
- **Side column** (under the main one on a phone, so the binder is first at 360 px): quick access 2 × 2 (« Demander des documents »
  only with the applicant-file flow, documents, checks, search — never a second « Vérifier un document », the header's one action);
  the activity as **one discreet strip** (checks, to look at, documents added, files received — each the sum of its own
  query over the period, with a sparkline) and the 7 · 30 · 90 d switch (`?period=`, kept with the open tab); the week's bar chart,
  whose table is in the page (« Voir les données »); the credits from the billing state — the meter against the fair-use cap for
  Pro, the audits left otherwise, « incluses » for an account an operator made. No price is shown here.
- The strip and the week are demo-free: they read `analyses`, `documents` and `screenings` (`activityStrip`). Trend words
  (« +12 % ») wait for krizaka-ui#651 (`StatGrid variant="strip"`): the figures are not compared with the previous period until then.

## B2 check flow: the plan strip and the catalogue of checks, the drop and the run (P16, #333, updated krizaka-internal#2292)

- « Vérifier un document » is two columns from `min-[1440px]` (7/12 + 5/12; one on a phone): **the drop zone is always first** — the
  drop zone appears at the top of the left column; the four flow steps (`FlowSteps`) are hidden on a phone (`hidden lg:block`) and
  shown from `lg`. The date header (`Today`) was removed from the page title (krizaka-internal#2292): it was not useful on mobile and
  added visual noise. The catalogue follows on the right column at 1440 px, below the drop on mobile.
- The **plan strip** is a single muted line (`<p className="text-xs text-fg-muted">`) at the **foot** of the section — not above the
  grid. It joins the plan name, its figures and a link to « Crédits et usage » with `·`. No price here.
- The catalogue is **the registry** (`catalogueOf` over `offerOf` of the flows): a row for each ruleset that runs for this person (the
  three leases, the visit notice and the état des lieux of Québec, the supplier's invoice, the service contract) and, when its Studio
  is offered, the file's authenticity. A ruleset the registry does not run is not listed; one without words yet is left out, never
  shown as a raw id. Each row says « Disponible » and has **one action**, « Vérifier », which names the kind in the address
  (`?type=lease|invoice|contract`; the notices and the authenticity are recognised from the file, so the address stays clean) and
  leads to the drop (`#depot`). The kind chosen is said above the drop, with « Changer ».
- **Territory-based ordering** (krizaka-internal#2292): `catalogueOf` accepts an optional `territory` parameter (read from the
  session account, stored as `accounts.territory text DEFAULT 'QC' NOT NULL`). For a QC account the QC lease leads, then
  authenticity, then the rest in GROUPS order. No locale branch: territory is a property of the account, not of the language.
- Search narrows the rows and the counts of the chips (accents and case do not matter; it is ephemeral, not in the address). The chips
  — « Toutes · 6 », « Baux · 3 », « Avis et états · 2 », « Authenticité · 1 » — are `Chip.Group` bound to `?groupe=`: the address is the
  state, and a group the search empties keeps its chip at 0.

## Prices: one catalogue, edited in the administration (ADR-009, #367)

- `admin.verikora.com/config/prices`: one flat `SettingsSection` per entry (amount in dollars, availability, its limits, « À partir du »
  — empty or today is now, a later day is its start, never the past), one save « Planifier le changement »; beside it what the
  processor charges, « Égal » or « Différent » (sales stop while different). Then every change, who and from when. Composed from
  `SettingsSection` / `SettingsRow` until the price-list block exists (krizaka/krizaka-ui#713).
- The paywall and « Abonnement et facturation » say the catalogue's prices (`paywallFigures`, « plus taxes »); no message types an amount.

## Prices on their own page, read from the catalogue, held until the grid is approved (#388, #300)

- **Decision** (2026-10-26): `/pricing` is on the pricing template of `@krizaka/ui`. It reads the catalogue in force
  (`publicCatalogue`, `lib/prices/page.ts`): one document, then the small-business and the firm subscriptions with what they
  include, every price "plus taxes". What is not built (full file, background checks, screening alone) is listed as "soon" with no
  figure. The dedicated API stays an internal entry. The call to action is sign-in and the status line is the home's.
- **Held**: the grid waits for Oussama's OK (#300). `PRICING_PUBLISHED` is `false`: the route answers 404 and the page is in no
  bar, footer, sitemap or `llms.txt` (`lib/listed.ts`). The OK is one line.
- **Refused**: the per-verification overage (#373: not billed, the page says "past the included volume, checks wait until next
  month"); a figure for what is soon; an annual plan; "Start now" while sign-up is closed.
- **Signal we are wrong**: visitors read "soon" as a broken page.
