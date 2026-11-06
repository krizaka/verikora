# Verikora: design direction (October 2026)

Status: **validé (CTO, delegated by Oussama, 2026-10-24)**: direction **B2**, the defaults of § 9, and « Retenu · Non retenu » as the decision words. Phase 1 of [#314](https://github.com/krizaka/verikora/issues/314) (docs only). The Phase 2 cut (§ 8) is filed as
issues, linked from #314.

The October UX review ([`docs/ux/2026-10-full-review.md`](../ux/2026-10-full-review.md) and its Errata) fixed the flows,
and slices Y0 to Y10 shipped most of it. This document sets the **direction of the whole product**: what Verikora looks
like, what moves, how it organises a property manager's work, and what we stop building so that we avoid rework.

Captures, mockups and the prototype are on Bunny, never committed. They live under
`https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/`, written below as `…/314/`.

- `audit/`: www.verikora.com on 2026-10-24 (build `v0.1.0+c085f9c`, @krizaka/ui 3.50), signed out and signed in as
  the persona Éric. Each screen is captured at 1440 px and at 360 px, dark and light, as a full page and as the first
  screen (`-first`). E-mail addresses are masked. `audit.json` holds the per-page numbers (title, `h1`, horizontal
  overflow, height).
- `mockups/`: the key screens, phone (360 px) and desktop (1440 px), both themes.
- `prototype/`: the source of the mockups (`main.tsx`). It is a Vite page built **only from published @krizaka/ui 3.50
  components** on Verikora's brand tokens, rendered by Playwright (`mock.mjs`). The audit script is `audit.mjs`.

---

## 0. The six decisions

These hold for both directions. **A** (§ 5.1 to § 5.4) is calm; **B** (§ 5.5) is bolder, with the same screens and the
same words. Oussama chose **B**, refined as **B2** (§ 5.6, 2026-10-24).

1. **The line between the Cahier and the product is the paper, not the grammar.** Verikora keeps the Cahier's
   *grammar*, which the primitives already carry: matt surfaces, 2 px and 0 radii, a solid offset instead of blur, the
   pen-stroke icons, no tracked capitals, and the ink ease. It adds three habits of a notebook: **numbering**
   (sequences only), **a margin column** (numbers and notes) and **notes** (footnote-style small print). It never wears
   the *paper*: no ruling, no red margin, no Young Serif, no typewriter mono, no specimen tags, and no bird as
   decoration. The decision of 2026-10-22 stands, with one small move, argued in § 3.2: folios and footnotes on the
   **signed PDF**.
2. **One section map on the web, the phone and the Mac**: Bibliothèque · Dossiers · Vérifications · Recherche, with
   « Vérifier un document » as the one action in the header, and the account (profile, settings, billing, language,
   theme, sign out) under the avatar. Today the three apps have three different maps.
3. **The applicant file becomes a first-class object, « Dossiers »**, with two separate axes: the **link's state** (a
   system fact: open, expired, used, closed, erased) and **your decision** (a status set as data, as in krizaka-ts#89:
   à décider → approuvé | refusé). Verikora never proposes, scores or ranks a decision.
4. **The answer first, then the reasons, numbered.** The report opens on one sentence (« 5 règles sur 10 demandent
   votre attention »), then the numbered findings: the quote, the article, and the severity as a word. The passed rules
   are folded, and the engine's facts are folded once. Codes such as `INVOICE-TOTAL-MISMATCH` and the re-run forms leave
   the face.
5. **Motion only says what happened.** It answers a cause the person made (a drop, a toggle, a selection), shows the
   run's real progress, and settles the verdict once, in ink. There is no reveal on scroll, no counting figure and no
   living bird inside the app. Under reduced motion everything is still, and progress is still given in words.
6. **Density follows the platform, not the page.** The web is comfortable (48 px rows), the Mac is compact (ADR-002
   `desktop`: 32 px rows, 13 px text), and a phone uses 56 px touch rows drawn as lists, never label/value cards. One
   sans face is used everywhere. Mono is only for code, and figures are tabular.

---

## 1. The audit (2026-10-24)

What the Y slices fixed holds: one `h1` per page, no horizontal overflow at 360 px on any captured page (`audit.json`:
`overflow 0` everywhere), the product in the header, the account always visible, and the verdict band on a compliance
report. What remains is ranked by its effect on Éric.

| # | Finding | Evidence | Direction |
| :-- | :-- | :-- | :-- |
| 1 | **The kind picker of « Vérifier un document » is unstyled**: icons, names and hints are glued together (« AutomatiqueVerikora le reconnaît »), with bare check marks. `ChoiceGrid`'s styles ship only in `story.css`, which a product does not import. | [desktop](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/check-desktop-dark.png) · [phone](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/check-phone-light.png) | `ChoiceCards` (a form control, not a story block), asked only when the kind is uncertain (§ 5.4) |
| 2 | **The Mac app wears the Cahier's faces.** `apps/desktop` imports the tokens but not `blocks.css`, where the plain product faces live, so its headings fall back to `"Young Serif", Georgia` and its codes to Courier New. The prototype showed the same thing until `blocks.css` was added. | `apps/desktop/src/styles.css`; `--kz-font-display` in `@krizaka/tokens` 3.50 | The plain faces move into the brand tokens (upstream U1, krizaka-ui#632) |
| 3 | **Mono labels on the face**: the report's eyebrow (`Facture · facture-2026-04-total-faux.pdf` in accent mono), finding codes (`INVOICE-TOTAL-MISMATCH`, `DOCUMENT-EXPIRED`), « Ce que la chouette promet » on the home, and run ids as a whole table column on Vérifications. In a pro app, mono reads as raw data. | [report](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/report-1-desktop-light.png) · [checks](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/verifications-desktop-dark.png) | Mono only for code, inside « Détails techniques » (upstream U2, krizaka-ui#633) |
| 4 | **The report ends in two forms**: « Traces de modification » (an issuer field and a button) and « Au regard de la loi » (kind, date and a second button) sit under the findings, with two « Lancer la vérification » buttons, one primary. The header's « À regarder » chip and the finding's « Incohérent » chip disagree in tone. | [invoice report](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/report-1-desktop-light.png) · [phone](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/report-2-phone-dark.png) · [lease](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/report-lease-desktop-dark.png) | The other checks become actions in the aside, and one tone vocabulary is used (§ 3.4) |
| 5 | **Applicant files exist only as a collection.** The API of #307 is complete (link, consent, uploads, close), but « the screens are not built ». The demo fakes a file with the collection « Candidats — 4½ Villeray », whose pay stubs and letters are typed « Autre », and `/app/screening` is a 404 for Éric. | [collection](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/collection-desktop-dark.png) · [library](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/library-desktop-dark.png) | The « Dossiers » destination (§ 4) |
| 6 | **Phone lists are boxes in a box**: Vérifications prints four label/value rows per check, so four checks fill a 360 px screen. | [phone](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/verifications-phone-light.png) | List rows on a phone (upstream U5, krizaka-ui#636) |
| 7 | **The library home is three lists stacked**: the latest checks, four collection cards whose descriptions repeat « Dernière vérification », then a 20-row « Récents » table with paging, 2 206 px tall. Nothing says what needs Éric today. | [desktop](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/library-desktop-dark.png) · [phone](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/library-phone-light-first.png) | « À traiter » first; the full table goes to the collections and search (§ 5.1) |
| 8 | **Three section maps.** Web: Bibliothèque · Vérifications · Recherche. Phone (`apps/mobile`): Vérifier · Bibliothèque · Réglages, with the settings as a tab. Mac (`apps/desktop`): Library · Batches · Reports. | `ConsoleShell.tsx`, `apps/mobile/app/[locale]/app/_layout.tsx`, `apps/desktop/src/App.tsx` | One map in `packages/core` (§ 3.6) |
| 9 | **One glyph, two meanings**: the lease is `HomeIcon` (the library's icon too), « Autre » is `MoreIcon` (also « more actions »), the contract is a pencil, and the collections wear a bookmark. | [check](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/check-desktop-dark.png) | Document and place icons (upstream U6, krizaka-ui#637) |
| 10 | **The public home still carries Cahier tells**: a red mono eyebrow (« Québec · baux, contrats, factures »), the figures row under the hero (a tell ADR-004 retired), a 2 + 1 orphan card grid, and a mono bird caption. Its blocks are hidden until they are scrolled to (`data-reveal`, opacity 0), so a full-page capture shows a 700 px void. | [first screen](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/home-desktop-light-first.png) · [scrolled](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/home-desktop-light-scrolled.png) | Plain, as a product (§ 3.2) |
| 11 | **Sign-up says closed** on the deployed site (« L'inscription est fermée »), while `AGENTS.md` § 4 records it open since 2026-10-21. This is configuration, not design; it is noted again because both pages promise something. | [sign-in](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/sign-in-phone-light-first.png) · [sign-up](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/sign-up-desktop-dark.png) | Not in this direction |
| 12 | **Billing is correct and bare**: plan, paid audits left, a test-mode alert, « Passer à Pro » and « Payer cet audit ». It needs no redesign, only the shared figures style (tabular). | [billing](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/audit/billing-desktop-dark.png) | Unchanged |

Every audit capture: `…/314/audit/<screen>-<desktop|phone>-<dark|light>[-first].png`. The screens are `home`,
`sign-in`, `sign-up`, `forgot-password`, `library`, `verifications`, `check`, `batches`, `search`, `billing`,
`screening`, `collection`, `report-1` (invoice), `report-2` (employment letter) and `report-lease-desktop-dark`.

---

## 2. Who and what

Éric manages buildings in Montréal. He checks leases before he signs them, the pay stubs and letters an applicant hands
him, and suppliers' invoices. His jobs: **get the answer on a document**, **decide on an applicant**, **find a report
again**, and **prove what was checked** (the run, the signed PDF). The direction serves these four jobs and nothing
else. Verikora is a professional tool he opens between visits, often on his phone, sometimes on his Mac with a folder of
scans.

---

## 3. The direction

### 3.1 The brand

- **Colour**: Verikora's indigo (`brands/verikora.css`, hue 240; the accent text is 4.5:1 in both themes) is the
  colour of **the one action and the current place**: the header's « Vérifier un document », the active rail item, the
  selected row, links and focus rings. It is never a surface wash, a gradient section or a status. Verdicts keep the
  semantic tones (§ 3.4).
- **The mark**: `VerikoraLogo` once per width, still (`animated={false}`): on the rail on a desktop and in the header on a
  phone.
- **The bird**: the owl « reads and knows every face ». In the app it appears **only where the person has nothing to
  read**: an empty list (`empty`), a search without results (`thinking`), a failed run or the 404 (`error` / `lost`,
  krizaka-ui#599), and the sign-in (`welcome`, large). That is one owl per screen at most, never beside a report, a
  table or a form. A report is Sovkora's answer, and a bird there would turn evidence into decoration.
- **The voice**: short, plain French first. It says what was checked and never « conforme » as a guarantee (Errata 5).
  Every report and footer note says « Vérification informative, ce n'est pas un avis juridique ».

### 3.2 The Cahier inside a professional app: where the line is

The decision of 2026-10-22: the products stay professional Krizaka UI, and the artistic Cahier belongs to the sites
(krizaka.com, the blog, the tool sites) and to Folioviv's public shop pages (folioviv#236). Here is the line, exactly:

| The Cahier's… | In Verikora (app, Mac, phone, public site) | Only on the Cahier sites |
| :-- | :-- | :-- |
| **Grammar** (in the primitives, ADR-004) | **Yes**: matt surfaces, 2 px controls and 0 radius on cards, a solid offset shadow, no blur or glass, no tracked capitals, the 1.5 pen stroke, the ink underline on the current tab, the pen's ease `cubic-bezier(0.45, 0, 0.2, 1)` | |
| **Order** (how a notebook organises) | **Yes, three habits.** **Numbering**: only for *sequences*, the findings of a report (1, 2, 3…) and the steps of a flow, in tabular figures. Page sections are not numbered (no `§`). **A margin column**: a fixed 2 rem column at the left of a numbered list holds the numbers, so the text lines up. **Notes**: legal, demo and provenance lines are small print at the foot of the content (`¹ …`, `text-xs`, above a hairline), never a banner box. Quiet hierarchy: one `h1`, `h2` at `lg`, no eyebrow above every heading. | |
| **Paper** | **No** | Seyès ruling, the red margin rule, folios, `§` section numbers, kraft and dot-grid papers |
| **Faces** | **No**: Atkinson Hyperlegible Next for everything, display included; a system mono only for code | Young Serif, Courier Prime, Krizaka Cahier |
| **Specimens** | **No** | specimen tags, bird plates, anatomy plates, taped photos, stamps, doodles, the retro pieces |
| **Birds** | as states only (§ 3.1) | as the specimens the page is organised around |

**The public site (www.verikora.com) is on the product side of the line.** It is the product's site, not a Cahier
site. Its red mono eyebrow, figures row and mono captions go (finding 10). It may keep what the product has: the real
report in a frame, the owl once, and the indigo.

**Should the line move?** I argue it should stay, with one small move:

- *Against moving it into the app.* A verification tool is trusted for its sobriety. Ruled paper and a serif under a
  legal finding would look like a school exercise, the opposite of « a professional read your lease ». The Cahier's
  papers also cost density, and Éric's screens are dense (tables, reports). ADR-004 itself says the ruling is « never
  forced under a dense app screen ». Finally, the family's apps (Sovkora, Folioviv's back office) stay plain, and one
  plain app grammar is what lets a person move between them.
- *For one move: the signed PDF.* The signed report is **paper**: it is printed, filed and handed to an owner. There, the
  Cahier's print grammar is typography, not art. It means **folios** (« 2 / 4 » at the foot of each page), **numbered
  findings** matching the screen, and **footnotes** for the legal and review notes. No ruling, no serif, no birds. This
  makes the paper report read like the screen and costs one template change in the PDF renderer. Default: yes, unless
  Oussama declines (§ 9).

### 3.3 Motion: what moves and why

One system: `MotionObserver` and the ink ease of `@krizaka/ui/motion` (ADR-004), the guides of Krizaka Motion
(`/list-arrival`, `/button-feedback`, `/page-transition`). Nothing local, no library and no permanent animation frame.

| Moves | Why | How |
| :-- | :-- | :-- |
| A dropped file, a queue row appearing, a chip toggling, a row selected, the BulkBar arriving | the person caused it; the screen confirms it within 100 ms | 150 to 200 ms, ink ease, opacity and transform only, no travel over 4 px |
| The run's progress | a check takes seconds; the person must see it is working and where | `UploadQueue` rows say the stage in words and fill a bar, fed by Sovkora's events (#208, sovkora#189); a `Badge` dot pulses **only while running** |
| The verdict arriving | the one moment of the product | the band settles once (`data-reveal="ink"`, written left to right), when the run ends on screen, never on a revisit |
| List → document (web optional, Mac default) | keeps the place | `PageTransition` / view transitions, the title as the shared element |

**Does not move in the app**: reveal on scroll (it stays on the public pages, and never on the first screen), counting
figures (`NumberTicker`: a figure in the app is a fact, shown at once), the owl's life, hover lifts on cards, shimmer,
magnetic buttons, and any loop. **Under `prefers-reduced-motion`** all of the above is still, and progress stays in
words (« lecture des clauses, 2 sur 3 »). Nothing waits on an animation. Every animation can be interrupted and never
blocks input.

### 3.4 Density, typography and tone

| | Web | Mac (`AppShell desktop`, ADR-002) | Phone (web at 360 px, `apps/mobile`) |
| :-- | :-- | :-- | :-- |
| Rows | 48 px | 32 px | 56 px touch, as `List` rows |
| Body | 15 to 16 px | 13 px | 16 px |
| Gutters | 24 px | 20 px | 16 px |
| Task pages (check, settings) | one column, ≤ 48 rem | same | full width |
| Lists | full width, priority columns (they leave the row instead of scrolling sideways) | same, more columns | title · one line of facts · status |

- **Faces**: the sans of `@krizaka/fonts` for display and text, on every platform. The `h1` is 2xl/700, the `h2` lg/700,
  a card title base/600, the body md, and the meta sm in `text-fg-secondary`.
- **Mono** only for code and identifiers: the run id, the hashes and the ruleset id, inside « Détails techniques ».
  Never a filename, a kind, a place or a label (finding 3).
- **Figures** tabular (`font-variant-numeric: tabular-nums`): amounts, counts, dates in tables, and finding numbers.
- **No capitals** for emphasis, and no emoji.
- **One tone vocabulary**, each with its written word:

| Meaning | Tone | Words (FR) |
| :-- | :-- | :-- |
| needs a look (a check's result) | `warning` | « 1 point à regarder », « 3 signaux » |
| a blocking point (a finding's severity) | `danger` | « Bloquant » |
| nothing found on the rules checked | `success` | « Aucun problème trouvé sur les règles vérifiées » (never « conforme », Errata 5) |
| kept, unchecked, closed, refused by you | `neutral` | « Gardé », « Pas vérifié », « Refusé » |
| waiting on someone else | `accent` | « Documents attendus » |

A person's *decision* never wears `danger`: « Refusé » is the manager's word, not a fault, so it is `neutral`. A tag
never wears a status tone (§ 4).

### 3.5 Empty, loading, error and the in-between

Every state is told, in place ([the three states](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/states-desktop-light.png)):

- **Empty**: the owl (`empty`), one sentence that says what the list is for, and one action. « Aucun dossier pour
  l'instant · Envoyez un lien à un candidat : il dépose ses documents, Verikora les vérifie, vous décidez. ·
  [Demander des documents] ». For a first library, the demo set (#274) is offered as one quiet link, never pre-filled.
  The mascot slot needs krizaka-ui#623, because today it renders small.
- **Loading**: a skeleton of the page's own shape (rows, the verdict band, the aside) when it takes more than 300 ms,
  never a centred spinner. A spinner is allowed inside a button only (`Button loading`).
- **Running**: the queue row in words, with progress (§ 3.3). The person can leave the page; the `TaskTray` keeps it.
- **Error**: an `Alert` in place with the cause and the way back (« Le moteur ne répond pas · La vérification n'a pas
  abouti. Le document est gardé ; réessayez dans un instant. · [Réessayer] »), never a toast for a failure the person
  must act on. The rest of the page stays usable.
- **Partial**: a check that could not run says why, with its next step. `NO_TEXT`: « Ce PDF n'a pas de couche texte : la
  vérification au regard de la loi n'a pas pu lire ses clauses. » The authenticity check still runs.
- **Demo and seeded data**: a note at the foot (« Jeu de démonstration… aucun appel au moteur »), not a full-width info
  box above the report.
- **Offline (Mac, phone)**: the library on the device stays readable, and a check waits with « en attente de
  connexion ».

### 3.6 Mobile and macOS parity

**One section map, one set of words**, kept in `packages/core` (beside `CHECK_KINDS`) and read by the three apps, with
their labels from the same message keys:

| | Web | Phone (`apps/mobile`) | Mac (`apps/desktop`) |
| :-- | :-- | :-- | :-- |
| Destinations | rail · bottom tabs at 360 px | tab bar | sidebar (folds with ⌘B) |
| Bibliothèque · Dossiers¹ · Vérifications · Recherche | ✓ | ✓ (replaces Vérifier · Bibliothèque · Réglages) | ✓ (replaces Library · Batches · Reports); ⌘1 to ⌘4 |
| « Vérifier un document » | header primary (`shape="cut"`) | header « + » | header button and ⌘N; dropping files on the window |
| Batches (« Lots ») | a tab of Vérifications | same | same (today a destination) |
| Account | avatar menu | avatar in the header (#269) | avatar menu and the app menu |
| ⌘K palette | `AppShell.Search` (later) | none | from the first release |

¹ « Dossiers » appears for the perspectives that are offered the applicant-file flow (`lib/flows.ts`); the others see
three destinations.

What differs is only what each platform owns: Finder folders and a watched folder on the Mac, the camera and the photo
library on the phone (`MediaCapture`), and the browser's drop on the web. A screen added to one platform is added to the
map and to the other two in the same slice, or the slice says why not (the `parity` field of the krizaka-ui metas).

---

## 4. Organisation: applicant files and documents (krizaka-ts#89)

Verikora is #89's pilot (confirmed 2026-10-24). This is the product side; the shared API is #89's ADR. See
[the list](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/files-desktop-dark.png),
[with a selection](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/files-bulk-desktop-light.png) and
[on a phone](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/files-phone-dark.png).

**The applicant file** (a `screenings` row with `flow = 'file'`, #307) has **two axes, never merged into one chip**:

| Axis | Who sets it | Values | Shown as |
| :-- | :-- | :-- | :-- |
| The link's state | the system (`linkState`, `lib/applicant-file-rules.ts`) | open (until a date), expired, used (sent), closed, erased | a line of facts: « 4½ Villeray · lien utilisé le 22 oct. » |
| **Your decision** | the manager, through #89's status set (data, admin-configured) | **À décider → Retenu \| Non retenu** | `StatusChip`, column « Votre décision » |

- **« Documents attendus » is a view, not a status**: the link is open and fewer documents are in than asked.
- **Deciding closes the file.** Today's API (`close`) already purges every document and keeps the reports. So « Refuser
  et fermer » and « Approuver » close the file, and the action says so: « Fermer un dossier efface ses documents ; ses
  rapports restent. » It is armed in two presses. It cannot be undone, because the documents are gone (Loi 25
  minimisation, #125).
- **No score, no ranking, no suggestion.** Verikora never pre-fills a decision, never sorts « best first », and never
  turns signals into a grade. The decision column sorts by the set's order, not by any check result.
- **No free-text reason in v1.** A free note on why a person was refused invites a discriminatory remark, and it is
  personal information. If a reason is ever needed, it is a short list kept as data and read by the lawyer first
  (#303).
- **Tags** (krizaka-ts#89 § 1): a neutral chip with a small square marker from a **closed palette** of the tokens (8
  markers, ≥ 3:1 in both themes, distinct from the status tones and from the indigo). The word is always written, never
  colour alone. The admin sets the default tags (the buildings, « Garant »); the manager adds their own if the admin
  allows it. Tags apply to files **and** documents.
- **Documents get no user status in v1.** A document already carries a fact from Sovkora (« À regarder », « Aucun
  problème trouvé… », « Pas vérifié »). A second, user-made status on the same row would compete with it. Documents are
  organised by collection and tags.
- **Saved views**: the system's views (Tous · À décider · Documents attendus · Fermés), then the person's (« Enregistrer
  la vue »). The address holds the state (filters, sort, view). On a phone, a menu button replaces the chip row (the
  prototype shows why: three wrapped lines). Views are shared inside a workspace later, with #126.
- **Bulk actions** (selection of `DataTable` / `List`): Étiqueter, Retirer l'étiquette, Approuver, Refuser et fermer
  (two presses), and Tout désélectionner. There is one audit line per file (`@krizaka/audit`), and the decision may fire
  a webhook (`@krizaka/webhooks`) as #89 says. Undo exists for tags only.
- **Collections stay places** (buildings, « Factures 2026 »), with the place marks of krizaka-ui#590 instead of a
  person's avatar. An applicant file is **not** a collection. The demo seeds one as a file (#274 follow-up), not as
  « Candidats — 4½ Villeray ».

---

## 5. The key screens

Each screen has four mockups: `…/314/mockups/<screen>-<desktop|phone>-<dark|light>.png`. Everything on them exists in
@krizaka/ui 3.50, or is a composition of existing primitives marked **proposed** (StatusChip, TagChip, SavedViews,
BulkBar, the verdict band and the numbered findings). The words describe what runs. The decision column and the views
are #89, not built yet.

### 5.1 Home: « Bibliothèque »

[desktop dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/home-desktop-dark.png) ·
[desktop light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/home-desktop-light.png) ·
[phone dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/home-phone-dark.png) ·
[phone light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/home-phone-light.png)

- **« À traiter »** comes first: three figures, and **each is a door** to its saved view (« Vérifications à regarder 6 »,
  « Dossiers à décider 2 », « Liens de dépôt ouverts 1 · expire le 7 nov. »). They are computed by queries, not
  counters, and drawn as `StatGrid divided`. When everything is at zero the section says « Rien à traiter » in one line.
- **« Dernières vérifications »** as `List` rows (the title, then the place and date, and the result chip), with
  « Tout voir » leading to Vérifications.
- **« Collections »** as `List` rows (a place mark once krizaka-ui#590 ships).
- The 20-row « Récents » table **leaves the home**. All documents are in their collections and in Recherche (a « Tous les
  documents » view of the library).

### 5.2 A list: « Dossiers de candidats »

[desktop dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/files-desktop-dark.png) ·
[desktop light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/files-desktop-light.png) ·
[phone dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/files-phone-dark.png) ·
[phone light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/files-phone-light.png) ·
with a selection: [desktop](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/files-bulk-desktop-light.png) ·
[phone](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/files-bulk-phone-dark.png)

- The `PageHeader` has one secondary action, « Demander des documents » (`POST /api/applications`). The header keeps the
  global primary.
- The saved views, then the `FilterBar` (Étiquette, Décision) with the active filters as removable chips and the count.
- The `DataTable` is selectable. Its columns are Candidat, Votre décision, Vérifications (the facts from Sovkora: « 3
  signaux » / « Aucun signal »), Logement et lien, Documents (« 4 sur 4 »), Étiquettes and Mis à jour, with priorities so
  nothing scrolls sideways.
- The BulkBar is sticky under the header and says how many are selected.
- The phone mockup shows today's card form (boxes in a box). The target is a list row (upstream U5, krizaka-ui#636).

### 5.3 A detail: the report

[desktop dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/report-desktop-dark.png) ·
[desktop light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/report-desktop-light.png) ·
[phone dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/report-phone-dark.png) ·
[phone light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/report-phone-light.png)

The content is **the recorded run** of `content/recorded-runs/tenant.json` (run `131934f7-…`, `compliance-check` 1.2.0,
`qc-residential-lease` 2024-02-21), shown as Sovkora returned it.

- `DetailLayout`: the way back to the collection, the kind and filename as a sans eyebrow, the title from the insight,
  the status chip, one `MetaRow` (the ruleset version, the date in force, the date checked), and one action: « Rapport
  signé (PDF) ». The tabs are routes: Rapport · Document · Historique (`Tabs.Nav`, Errata 2).
- **The verdict band**: « 5 règles sur 10 demandent votre attention · dont 3 bloquantes ».
- **Numbered findings** in the margin column. Each has its title, its severity as a word (Bloquant · Important · À
  considérer, from `severity`), the exact quote (or « Absent du document »), the explanation, the citation and « Voir
  dans le document » (to `DocumentViewer`'s highlight). The rule id and the method stay in the technical details.
- « 5 règles sans problème trouvé », folded; « Détails techniques », folded, with the run id appearing **once**.
- The review note as a footnote (`¹ Corpus rédigé à partir du texte public… À faire relire par un avocat…`).
- **The aside**: the facts (collection, file, retention), then « Autres vérifications » as actions (« Examiner le
  fichier (authenticité) », « Revérifier à une autre date »). Their fields (issuer, date) open in a dialog. The report
  no longer ends in two forms. The FR/EN toggle of #247 goes here when it ships. On a phone the aside goes under the
  content.

### 5.4 A creation flow: « Vérifier un document »

[desktop dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/check-desktop-dark.png) ·
[desktop light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/check-desktop-light.png) ·
[phone dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/check-phone-dark.png) ·
[phone light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups/check-phone-light.png)

The flow is three numbered steps on one page, ≤ 48 rem:

1. **Avant le dépôt**: the defaults said in one line, with « Modifier » (« Effacé après la vérification · Règles du
   Québec en vigueur aujourd'hui · dans « Mes documents » »). This is Errata 6: the choices come before the upload, and
   otherwise the defaults apply and are named.
2. **Le document**: the `Dropzone`, and the whole window as the drop target (`DropOverlay`, shipped in Y3).
3. **La vérification**: an `UploadQueue` row per file, saying the stage in words with its progress. A confident kind
   starts on the drop (the review's question 2). An uncertain one asks « Quel document ? » with `ChoiceCards`, for that
   file only. A finished row ends in its result chip and opens the report.

### 5.5 Direction B: bolder, for the same four screens

The CTO's review found A to read as a clean generic admin: the brand barely shows, « À traiter » is three boxes of one
number each, and the type scale is flat. **B** draws the same four screens from the same components, tokens and words,
and changes only the expression. **Oussama chooses A or B on the images**; § 3 holds for both, except where the table
below says otherwise.

- **Home**: [desktop dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/home-desktop-dark.png) · [desktop light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/home-desktop-light.png) · [phone dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/home-phone-dark.png) · [phone light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/home-phone-light.png)
- **Files, with a selection**: [desktop dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/files-desktop-dark.png) · [desktop light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/files-desktop-light.png) · [phone dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/files-phone-dark.png) · [phone light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/files-phone-light.png)
- **The report**: [desktop dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/report-desktop-dark.png) · [desktop light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/report-desktop-light.png) · [phone dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/report-phone-dark.png) · [phone light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/report-phone-light.png). The verdict, written in ink (`data-reveal="ink"` with `MotionObserver`, 0.7 s, once): [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/report-verdict-motion-dark.webm) · [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/report-verdict-motion-light.webm)
- **The check flow**: [desktop dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/check-desktop-dark.png) · [desktop light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/check-desktop-light.png) · [phone dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/check-phone-dark.png) · [phone light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/check-phone-light.png)
- **The empty state**, with the owl at 120 px: [desktop dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/empty-desktop-dark.png) · [desktop light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/empty-desktop-light.png) · [phone dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/empty-phone-dark.png) · [phone light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b/empty-phone-light.png)

Prototype source: `…/314/prototype/b.tsx` (rendered by `mock-b.mjs`).

What B does:

- **The indigo with intent**: it marks only what to act on. That is the phrases of the summary (accent, underlined),
  the one primary button of the screen, the selection bar (`accent-soft` with a 4 px accent rule), the verdict band, the
  numbers of the findings and steps, and the rail's badge (« 2 dossiers à décider »). Surfaces stay matt.
- **A confident type scale**: `h1` at 4xl/5xl (« Bonjour Éric. »), the summary at xl/2xl, the verdict figure at 6xl, the
  section `h2` at xl, and the body at base, with the meta smaller. A uses 2xl, lg, base and sm.
- **« À traiter » as one sentence**: « Aujourd'hui, **6 vérifications** attendent votre regard, **2 dossiers** une
  décision, et **1 lien de dépôt** reste ouvert jusqu'au 7 novembre. » Each figure is a link to its view, and the
  screen's one primary action follows: « Décider des 2 dossiers ».
- **The owl where it means something**: in the verdict (`thinking`, « la chouette a lu le bail »), in the running check
  (« Lecture de bail-saint-denis.pdf, étape 2 sur 3 »), and in the empty state at 120 px. Never on a list, a table or a
  form.
- **The Cahier's order made visible**: large numbers (3xl, accent, tabular) in a left margin for the findings and steps,
  and a **right margin of notes** on a desktop (the article cited and « Voir dans le document » beside each finding; the
  closing rule beside the files). On a phone the notes go under their paragraph, above a hairline. There is still no
  paper, serif or `§`.
- **A bar of the ten rules** under the verdict: one segment per rule, in the severity's tone, with the counts written
  under it and the whole bar given a text alternative.
- **Motion on the verdict**: the band is written left to right once when the run ends (still under reduced motion). The
  views use the ink underline of `Tabs.Nav` instead of a chip row.

| | A (calm) | B (bolder) |
| :-- | :-- | :-- |
| What changes | `PageHeader` on every page; « À traiter » as three `Stat`s; findings numbered small; the article inline under the explanation; the facts and other checks in the aside; views as chips | A greeting and a summary sentence on the home; the numbers large in an accent margin; the law in a right margin of notes; a rules bar; the owl in the verdict and the running check; views as underlined tabs; the selection bar in accent |
| Phase 2 cost | The cut of § 8 as written | **+2 slices, about 1 to 2 days**: a `Margin` layout (numbers and notes), to file in krizaka-ui as part of #210 / #635 rather than build here; the summary sentence (built from the same queries as P8, with plurals in the messages, both languages). The rules bar is a small presentational piece (also krizaka-ui #210). The rest is classes on existing blocks. |
| Risk | Reads generic: the brand barely shows, and Oussama asked to « moderniser » | **The sentence** must stay true at every count (zero, one, many) in FR and EN, with tests per plural. **The owl** in the verdict must not read as the one judging; its title says it read the lease, and the band's words stay Sovkora's figures. **Accent use** can creep: the rule is « only what to act on », and a test can count accent surfaces per page. **Right margin notes** need ≥ 64 rem of content width; under that they fold under the paragraph, as the phone shows. |
| Accessibility | as § 3 | Same contrast (the accent text is 4.5:1 in both themes); the underlined phrases are links with full names; the bar has a text alternative and the counts written; the ink reveal is off under reduced motion |

### 5.6 B2: the chosen direction (Oussama, 2026-10-24)

Oussama chose **B**, with refinements ([the decision on #315](https://github.com/krizaka/verikora/pull/315)). **B2**
applies them to the same four screens. This is the direction to implement once it is « validé ». A and B stay above as
the record.

- **Home (dashboard)**: [desktop dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/home-desktop-dark.png) · [desktop light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/home-desktop-light.png) · [phone dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/home-phone-dark.png) · [phone light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/home-phone-light.png)
- **Files**: [desktop dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/files-desktop-dark.png) · [desktop light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/files-desktop-light.png) · [phone dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/files-phone-dark.png) · [phone light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/files-phone-light.png)
- **The report**: [desktop dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/report-desktop-dark.png) · [desktop light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/report-desktop-light.png) · [phone dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/report-phone-dark.png) · [phone light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/report-phone-light.png)
- **The check flow**: [desktop dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/check-desktop-dark.png) · [desktop light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/check-desktop-light.png) · [phone dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/check-phone-dark.png) · [phone light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/314/mockups-b2/check-phone-light.png)

Prototype source: `…/314/prototype/b2.tsx` (@krizaka/ui 3.50 and @krizaka/charts, rendered by `mock-b2.mjs`). The figures
on the home are demo data and are labelled as such.

| Refinement | In B2 | Built on |
| :-- | :-- | :-- |
| More content, charts, quick access | **Home layout (Oussama's last adjustment):** the heading and its sentence, then **two columns on a desktop**. The **main** column holds **« Le classeur »** (the binder, right under the heading) and then the latest checks. The **side** column (26 rem) holds the quick access (2 × 2), the **activity as one discreet strip** (four compact figures in one row with sparklines and the 7 · 30 · 90 d switch), the weekly chart in that column, and the credits meter. On a phone it is one column, in that order. The report adds the run's figures (10 rules, 11 articles, 11.5 s, from the recorded run). | `DashboardLayout` + `Widget`, proposed `StatStrip` [krizaka-ui#651](https://github.com/krizaka/krizaka-ui/issues/651), `Sparkline` and `BarChart` (@krizaka/charts), `Meter`, `RadioGroup` segmented |
| No date strip; today's date on the right | Each heading has the `h1` on the left and `<time>` on the right (under it on a phone) | proposed `DashboardLayout` `date`, [krizaka-ui#644](https://github.com/krizaka/krizaka-ui/issues/644) |
| ⌘K search in the top bar; navigation revisited | Top bar: search field with `⌘K` · FR · notifications with a count · « Vérifier un document » (gradient, cut) · the avatar with the name. Rail: **Accueil · Dossiers (count) · Documents · Vérifications**; Recherche leaves the rail for ⌘K; « Crédits et usage » is under the avatar and on the home. Phone: the same four tabs, and search as an icon in the header. | proposed `AppHeader` slots, [krizaka-ui#640](https://github.com/krizaka/krizaka-ui/issues/640); `CommandDialog` |
| Binder tab dividers | « Le classeur » on the home (collections as coloured tabs with counts); on Dossiers, the decision states as tabs (À décider · Documents attendus · Approuvés · Refusés · Tous), the tags as chips with counts | proposed `BinderTabs`, [krizaka-ui#643](https://github.com/krizaka/krizaka-ui/issues/643), marker palette [krizaka-ui#635](https://github.com/krizaka/krizaka-ui/issues/635) |
| the family's top bar | as above. **Messages are not shown**: Verikora has no messaging, and the slot stays empty until a product feature exists (no invented feature). Notifications need `@krizaka/notifications` (krizaka-ts#60): « vérification terminée », « dossier reçu ». | [krizaka-ui#640](https://github.com/krizaka/krizaka-ui/issues/640) |
| The org avatar set and banner | The avatar comes from the family set (#598). The banner belongs to the account page and to an applicant file's header; it is not on these four screens. | krizaka-ui#598, [krizaka-ui#646](https://github.com/krizaka/krizaka-ui/issues/646) |
| Sovkora's Studios catalogue | The check flow lists the checks Verikora runs (bail, facture, contrat de service, authenticité), with a plan strip (plan, meter, « Crédits et usage »), search, chips with counts, and rows with « Disponible » and « Vérifier » | proposed catalogue template, [krizaka-ui#642](https://github.com/krizaka/krizaka-ui/issues/642) |
| Sovkora's Credits & usage | The balance meter, the period switch and the tiles with sparklines on the home; the full page « Crédits et usage » follows the same blocks | proposed usage blocks, [krizaka-ui#641](https://github.com/krizaka/krizaka-ui/issues/641) |
| The nicer primary buttons | `Button variant="gradient" shape="cut"` (accent → accent-2) for the one action of a screen: « Vérifier un document », « Demander des documents », « Approuver », « Rapport signé (PDF) ». It already exists in @krizaka/ui. | `Button` |
| The Cahier's grammar | B's numbered findings and margin of notes stay | proposed `MarginLayout`, [krizaka-ui#645](https://github.com/krizaka/krizaka-ui/issues/645) |
| Templates | Home → dashboard (« Operate »); Dossiers → admin console (« Operate », bulk actions); report → detail (« Show »); check → catalogue plus a task (« Act ») | the #622 audit and the issues above |

**What B2 drops from B**: the « Bibliothèque · vendredi… » line above the title (the date strip), and the separate
« Collections » list (now the binder).

**Known gaps in the mockups**: the fixed header and tab bar appear mid-page in the full-page phone captures (a capture
artefact of sticky bars). The DataTable phone rows are still the card form until [krizaka-ui#636](https://github.com/krizaka/krizaka-ui/issues/636) ships.

---

## 6. What we stop or change

This is the anti-rework part. Each line says what happens to a current or planned UI slice.

| Item | Decision | Why |
| :-- | :-- | :-- |
| `ChoiceGrid` on `/app/verifier` (`CheckView.tsx`, Y4) | **Change** → `ChoiceCards`, only for an uncertain kind | Unstyled in production, and it is a story block (finding 1) |
| [#31](https://github.com/krizaka/verikora/issues/31) « Elevate Trust Cockpit… Motion Animations » | **Stop** (close as superseded) | Decorative motion is out (§ 3.3); its report part is § 5.3 |
| [#203](https://github.com/krizaka/verikora/issues/203) epic « modern UX pass on the library » | **Reshape**: keep drop anywhere and the upload queue (shipped), and the ⌘K palette (Mac first). **Stop the split view on the web library**: documents are pages with addresses (deep links, Errata 2). The first-run demo becomes the empty state's link (§ 3.5). | One way to open a document |
| [#206](https://github.com/krizaka/verikora/issues/206) collection avatar (set or uploaded image) | **Change**: place marks (krizaka-ui#590) and a tag marker; **no uploaded images for collections** | A building is not a person; storage and moderation for no gain |
| [#208](https://github.com/krizaka/verikora/issues/208) check progress as streamed steps | **Keep, placed**: on the queue rows of § 5.4 and the document's running state | It is the motion that matters (§ 3.3) |
| [#192](https://github.com/krizaka/verikora/issues/192) settings on the account-settings blocks | **Close**: done by Y2 (#282) | Shipped |
| [PR #227](https://github.com/krizaka/verikora/pull/227) account settings (older) | **Close** in favour of #282 | Superseded (the review's § 5.1) |
| [#285](https://github.com/krizaka/verikora/issues/285) to [#290](https://github.com/krizaka/verikora/issues/290) (Y5 to Y10) | **Close** the shipped ones (#291, #292, #293, #294, #297, #298 merged); what is left of Y5 and Y9 moves into the cut (P4, P10) | Keep the board true |
| The library home's « Récents » table | **Change**: it leaves the home (§ 5.1) | The home says what needs Éric |
| The demo's collection « Candidats — 4½ Villeray » | **Change**: seeded as an applicant file (#274 follow-up) | A file is not a collection (§ 4) |
| `/app/screening` and `LandlordScreening` ([#79](https://github.com/krizaka/verikora/issues/79), [#132](https://github.com/krizaka/verikora/issues/132), [#134](https://github.com/krizaka/verikora/issues/134)) | **Reshape**: there is one applicant-file object under « Dossiers »; a screening provider's result becomes a section of the file, not a separate page | One place per applicant |
| The UI follow-up of [#307](https://github.com/krizaka/verikora/pull/307) (« the screens are not built ») | **This is** « Dossiers » (§ 4, § 5.2), cut as P6 and P7 | |
| [#126](https://github.com/krizaka/verikora/issues/126) workspaces (firm, owners, buildings) | **Reshape**: buildings are collections with place marks; organisation is #89; sharing views and per-owner access come after the pilot | Do not build a second organisation model |
| [#128](https://github.com/krizaka/verikora/issues/128) shareable report for the owner | **Keep, placed**: « Partager » in the report's aside, next to « Rapport signé (PDF) » | |
| [PR #247](https://github.com/krizaka/verikora/pull/247) report FR/EN | **Keep, placed**: the toggle in the aside | |
| [#158](https://github.com/krizaka/verikora/issues/158) « poser une question à son document » | **Not in this direction.** If it comes, it is a side panel of the report, never a chat home | The report is the answer |
| [#110](https://github.com/krizaka/verikora/issues/110) decompose `DocumentView` | **Keep, first**: before the report changes (P3) | The report work lands on smaller parts |
| The mobile tabs (Vérifier · Bibliothèque · Réglages) and the Mac's Library · Batches · Reports | **Change** to the one map (§ 3.6) | Parity |
| [PR #300](https://github.com/krizaka/verikora/pull/300) prices page and launch copy | **Check before merge** against § 3.2: no red mono eyebrow, no figures row, no mono captions | The public site is on the product side |
| [#289](https://github.com/krizaka/verikora/issues/289) Y9 public home | **Follow-up** P10: remove the Cahier tells; the 2 + 1 grid becomes three in a row or a list | Finding 10 |
| [#245](https://github.com/krizaka/verikora/issues/245), [#100](https://github.com/krizaka/verikora/issues/100) to [#104](https://github.com/krizaka/verikora/issues/104) | **Unchanged**: engine or API work; when one gets a screen, it follows this document | |

---

## 7. Upstream needs

Each need is filed upstream, never copied here (« Krizaka first »).

| # | Issue | Need |
| :-- | :-- | :-- |
| U1 | [krizaka-ui#632](https://github.com/krizaka/krizaka-ui/issues/632) | The plain product faces in the brand files, not in `blocks.css` (finding 2) |
| U2 | [krizaka-ui#633](https://github.com/krizaka/krizaka-ui/issues/633) | Product surfaces: eyebrows, `DataTable` subtitles and `MascotQuote` captions in sans; mono only for ids (finding 3) |
| U3 | [krizaka-ui#634](https://github.com/krizaka/krizaka-ui/issues/634) | `ChoiceGrid` needs `story.css`, so say it (meta, docs, test) (finding 1) |
| U4 | [krizaka-ui#635](https://github.com/krizaka/krizaka-ui/issues/635) | Organisation surfaces for #89: `StatusChip`, `TagChip` with a closed marker palette, `SavedViews`, `BulkBar`, the admin editors, on web and native |
| U5 | [krizaka-ui#636](https://github.com/krizaka/krizaka-ui/issues/636) | `DataTable` phone rows as list rows, not cards in a box (finding 6) |
| U6 | [krizaka-ui#637](https://github.com/krizaka/krizaka-ui/issues/637) | Document kinds and places (finding 9) |
| — | [krizaka-ui#210](https://github.com/krizaka/krizaka-ui/issues/210#issuecomment-6388393343) `AnalysisReport` | Commented: the report shape of § 5.3 (numbered findings, severity word, no code on the face, the passed ones folded, the run id once) |
| — | [krizaka-ts#89](https://github.com/krizaka/krizaka-ts/issues/89#issuecomment-6388393483) | Commented: the pilot's needs (§ 4: the two axes, deciding closes and purges, no score, no free-text reason, documents without a user status) |
| U7 | [krizaka-ui#640](https://github.com/krizaka/krizaka-ui/issues/640) | The family's top bar: ⌘K search, language, messages, notifications with a count, the account (#515) |
| U8 | [krizaka-ui#641](https://github.com/krizaka/krizaka-ui/issues/641) | Credits & usage blocks: meter, period switch, tiles with sparklines, charts (from Sovkora, #515) |
| U9 | [krizaka-ui#642](https://github.com/krizaka/krizaka-ui/issues/642) | Catalogue template: plan strip, search, chips with counts, rows with a status and an action (#622) |
| U10 | [krizaka-ui#643](https://github.com/krizaka/krizaka-ui/issues/643) | `BinderTabs`, the coloured tab dividers |
| U11 | [krizaka-ui#644](https://github.com/krizaka/krizaka-ui/issues/644) | Dashboard heading: the date on the right, a lead sentence, quick access (#622) |
| U12 | [krizaka-ui#645](https://github.com/krizaka/krizaka-ui/issues/645) | `MarginLayout`: numbers and margin notes |
| U14 | [krizaka-ui#651](https://github.com/krizaka/krizaka-ui/issues/651) | `StatStrip`: four compact figures in one row with sparklines |
| U13 | [krizaka-ui#646](https://github.com/krizaka/krizaka-ui/issues/646) | `ProfileBanner` with the org avatar set (#598, #515) |
| — | already filed | krizaka-ui#588 (header primary at 360 px), #589 (theme row), #590 (place marks), #599 (owl « lost »), #623 (mascot in `EmptyState`), #487 (`Tabs.Nav`) |

**Krizaka Motion: no new primitive is needed.** Everything in § 3.3 exists (`MotionObserver`, `data-reveal="ink"`,
`PageTransition`, `Button` feedback, `UploadQueue` progress). The run's streamed stages wait on Sovkora's events
(sovkora#189), not on motion.

---

## 8. The Phase 2 cut (not filed before « validé »)

One pull request each, in order, test-first, with before and after captures at 360 and 1440 px in both themes on
`pr-assets/verikora/<pr>/`.

| # | Slice | Acceptance |
| :-- | :-- | :-- |
| P1 | **The kind picker**: `ChoiceGrid` → `ChoiceCards` on `/app/verifier`, asked only for an uncertain kind (the styling bug is fixed by #317) | Render test: each kind has its title and hint as separate text, `role="radiogroup"` labelled; captures show no glued text |
| P2 | **One section map** in `packages/core`, read by the web, the phone and the Mac; « Dossiers » gated by the flow; the phone's settings under the avatar; the Mac's ⌘1 to ⌘4 | A unit test that the three apps import the same list; phone tabs = the map; Mac menu built from it; Vérifications ⊃ Lots on all three |
| P3 | **Decompose `DocumentView`** (#110), with no visible change | The existing tests stay green and the captures match the « before » |
| P4 | **The report** (§ 5.3): numbered findings, severity as a word, codes and the method off the face, the passed rules folded, the run id once, the other checks as aside actions (dialog), the review note as a footnote, the breadcrumb to the collection | Tests: finding order (failed by severity, then passed folded), numbering, exactly one run id outside the details, no `form` in the main column, the 360 px capture |
| P5 | **Plain typography** in the app: no mono outside « Détails techniques »; the Mac app on the plain faces (U1, or `blocks.css` imported until it ships) | A test over `components/console`: `font-mono` only under the technical details; a Mac capture with sans headings |
| P6 | **« Dossiers »: list and detail** on the existing API (#307): link states, documents asked and received, their checks, « Demander des documents »; empty state; no decision yet | Tests: rows from `listForLandlord`, the link label from `linkState`, the request flow refuses SIN-like types (existing rule), and the empty state |
| P7 | **Organisation pilot** (after #89's ADR is validated and U4 ships): the decision set, tags with markers, saved views and bulk actions on « Dossiers »; deciding closes the file | #89's tests; two presses to refuse, one audit line per file, the address holds the view, no sort by check result |
| P8 | **The home's data**: the queries behind « À traiter » (checks to look at, files to decide, open links), the latest checks, and the per-period activity; « Récents » off the home (B2's presentation is P15) | Tests: each figure from its query and its link carries the view's filter; the zero state is one line |
| P9 | **The check flow's logic** (§ 5.4; B2's presentation is P16): the defaults before the drop, the queue rows with stages (#208 when sovkora#189 lands, the request's stages until then), and an uncertain kind asked per file | Tests: defaults named before upload (Errata 6), confident kind starts on drop, uncertain kind asks, reduced motion keeps words |
| P10 | **The public site, plain**: no red mono eyebrow, no figures row, no mono captions, the grid without orphans; the leftovers of Y9 | A test over the public components (no `font-mono` and no margin-red text outside code); first-screen captures |
| P11 | **The states pass**: a `loading.tsx` skeleton per app segment in the page's shape, errors in place with recovery, the `NO_TEXT` partial state, the demo note at the foot | Tests: each segment has a loading and an error boundary; the `NO_TEXT` copy; no spinner outside buttons |
| P12 | **Phone lists** (after U5): Vérifications, Dossiers and collections as list rows at 360 px | A 360 px test: one line of facts per row, no `dl` per row |
| P14 | **B2 shell**: the rail Accueil · Dossiers · Documents · Vérifications, the top bar on [krizaka-ui#640](https://github.com/krizaka/krizaka-ui/issues/640) (⌘K, FR, notifications, gradient primary, the avatar with the name), the phone's four tabs | Tests: the one section map (P2) feeds the rail, tabs and Mac menu; ⌘K opens the palette; the bar at 360 px is not clipped; the messages slot is absent |
| P15 | **B2 home** (§ 5.6) on [krizaka-ui#644](https://github.com/krizaka/krizaka-ui/issues/644), [krizaka-ui#651](https://github.com/krizaka/krizaka-ui/issues/651) and [krizaka-ui#643](https://github.com/krizaka/krizaka-ui/issues/643): the heading with the date on the right and the summary sentence, then two columns. Main: « Le classeur » (binder tabs), then the latest checks. Side: quick access, the activity strip (7 · 30 · 90 d), the weekly chart, the credits. One column on a phone. | Tests: every figure comes from a query over the chosen period; the sentence's plurals in FR and EN at 0, 1 and many; the period in the address; the chart's table alternative; the column order at 360 px (binder first) |
| P16 | **B2 check flow** on [krizaka-ui#642](https://github.com/krizaka/krizaka-ui/issues/642): the plan strip, the catalogue of checks, the drop and the run | Tests: the catalogue lists only the rulesets that run (from the registry), the counts per chip, the plan strip's numbers from the billing state |
| P17 | **B2 Dossiers**: decision states as binder tabs, the tags as chips with counts, the gradient bulk action (with P7) | #89's tests, plus the tabs' counts match the views |
| P13 | **The signed PDF** (if § 3.2's move is accepted): folios, findings numbered as on screen, footnotes | Tests on the renderer: folio on each page, the numbering matches the screen order |

**With B2**, P14 to P17 replace the A-styled parts of P2, P5, P8 and P9 (same logic, the B2 presentation). P4 takes B's
verdict and margin ([krizaka-ui#645](https://github.com/krizaka/krizaka-ui/issues/645)). P1 is shipped in #317. Every proposed piece waits on its krizaka-ui issue and is never
copied here.

The order: P1 is a live bug. P2 decides the map every later screen hangs on. P3 and P4 are the core loop. P5 is cheap
and visible. P6 and P7 are the new object, P7 waiting on #89. P8 to P13 finish the picture, and can run in parallel
where files do not overlap (P10 with P6).

---

## 9. Questions only Oussama can decide

1. **« Dossiers » as a fourth destination** for the perspectives offered the applicant-file flow. Default: yes.
2. **The decision words**: « À décider · Approuvé · Refusé » (#89's words) or « Retenu · Non retenu » (softer, less
   weight on a person). **Decided (CTO, delegated): « À décider · Retenu · Non retenu »**, under « Votre décision ». The
   status ids stay `pending · approved · rejected` (#89); only the words change.
3. **Deciding closes the file and purges its documents** (today's `close`). Default: yes, said on the action.
4. **The line's one move**: folios, numbering and footnotes on the signed PDF only (§ 3.2). Default: yes.
