# Verikora — full UX review and target design (October 2026)

Status: **proposal, phase 1 (docs only)** — the CTO validates before any implementation. Oussama (2026-10-23): the app is
« trop moche actuellement »; he wants a complete review, not patches, with Sovkora's web client as the reference for
app quality (« le menu, la navigation, la gestion du profil utilisateur, des icônes par défaut »).

This document is the evidence for the Dev preview criterion `ux.ia-review` and frames the work already in flight
(#278 shell, #275 library home, #274 demo data). Nothing here is implemented yet; section 5 is the cut.

Captures (never committed) are on Bunny under `pr-assets/verikora/ux-review-2026-10/` — every screen, signed out and
signed in as the persona Éric, desktop (1440 px) and phone (390 px), dark and light, with personal data masked. The
index is in the appendix; the links below point into it.

---

## 0. The verdict in five lines

1. **The shell is not Sovkora's pattern.** The rail mixes an action (« + Vérifier ») with destinations, its foot holds a
   settings cog and a lone chevron, the header carries the page's title instead of the product's, and no app page has an
   `h1`. The header shows a truncated e-mail address because the persona has no name.
2. **The settings are hand-made and broken on a phone**: five tabs in a row overflow the screen by 167 px at 390 px and
   197 px at 360 px (the whole page scrolls sideways); the avatar picker is a row of loose radios; the language control
   is an unlabelled segmented bar; the save button sits above the pictures. `settings-layout` and `account-settings`
   of @krizaka/ui do all of this already.
3. **The report hides its verdict.** On the document's « Vérifications » tab the engine's metadata (run id, Studio
   version, rule set, dates) comes first, eight finding cards each repeat the run id and `BLOCKING · DETERMINISTIC`, and
   « 8 règles respectées » is 3 900 px lower, after the SHA-256 and the signing key. Éric wants the answer first.
4. **The library does not look like Éric's.** One collection card wearing a stock *person* avatar, called « Mes
   documents », four files named after their filenames (« page », « facture modele krizaka »); the drop zone is
   repeated on three screens with two checkboxes above it; the phone list prints four label/value rows per document.
5. **The public site reads as a skeleton and contradicts itself once signed in.** A 236 px empty band sits above the
   hero at 1440 px (the page's `pt-20` on top of the hero's own offset); the hero is text with an empty right half and
   the sections are text-only; signed in, the bar says « Open the app » beside the raw e-mail while the hero still says
   « Sign in » and « sign-up is closed ». The sign-in's left half is one sentence and a 72 px owl; there is no « Mot de
   passe oublié »; the 404 is Next.js' black English default.

None of this needs a new idea: every target screen below is composed from blocks that exist in @krizaka/ui 3.51
(`rail-nav`, `app-header`, `account-menu`, `page-header`, `detail-layout`, `settings-layout`, `account-settings`,
`choice-grid`, `step-progress`, `drop-overlay`, `upload-queue`, `empty-state`, `error-page`). Four small pieces go to
krizaka-ui (section 5.3).

---

## 1. Scope and method

| | |
| :-- | :-- |
| Site | https://www.verikora.com (dev.verikora.com redirects there), build `v0.1.0+02ea492`, @krizaka/ui 3.50 |
| Accounts | the persona **Éric** (property manager, perspective « travailleur autonome » as seeded), read from `@qa` by key name; signed out for the public pages |
| Viewports | desktop 1440 × 900, phone 390 × 844 (2×), plus a 360 × 780 overflow check without pictures |
| Themes | dark and light, through `kz-theme` |
| Tooling | Playwright (Chromium, headless), one browser at a time; a MutationObserver masks e-mails, phones, postal codes, tax numbers and street numbers in the DOM before every shot; an `audit.json` records per page the title, the `h1`s, the landmarks, unnamed buttons, unlabelled inputs, horizontal overflow and console errors |
| Screens | 10 public pages signed out and 4 of them signed in (the bar's « Open the app » state), the home's **first screen** as the visitor lands (viewport only, both widths), 14 app pages, 2 documents × 4 tabs, 1 collection, the account menu open, keyboard focus after four Tabs, a wrong-password sign-in — about 170 pictures |

**Not reached, and why**

- `admin.verikora.com` — gated by `AUTH_ALLOWED_IPS` and the ADMIN role; Éric is a USER. The console was reviewed on
  2026-10-19 (`docs/UX_DECISIONS.md` § 10) and is out of this review's scope.
- `/app/screening` answers **404** for Éric (the tenant-screening flow is offered to landlords only; his perspective is
  « travailleur autonome »). The public `/screening/<token>` needs an invitation token.
- `/app/bienvenue` redirects to `/app` because Éric's perspective is already chosen; the onboarding chooser was reviewed
  through its twin on the Profile settings (same component, `PerspectiveChooser`).
- Sign-up is **closed on the deployed site** (`/sign-up` says « L'inscription n'est pas encore ouverte »), although
  `AGENTS.md` § 4 records it open since 2026-10-21: either the setting is off on DigitalOcean or the mail variables are
  missing. This is configuration, not design; it is noted because the sign-in's footer and the sign-up page both
  promise something the other denies.
- Loading states were read in the code, not captured (a headless run on a fast link never sees them); the batch
  progress (`BatchProgress`) and the running check were not exercised to avoid paid runs.

---

## 2. The reference: what Sovkora's web client does

Read in `krizaka/sovkora-web` (`src/app/(protected)/layout.tsx`, `components/layout/Sidebar.tsx`,
`Header.tsx`, `features/profile/*`, `docs/ux/information-architecture.md` of the Sovkora workspace):

```
rail (RailNav, desktop) / bottom tabs (phone):   mark · Home · Studios · Chat · Jobs · Packs · Usage  ───  Settings · (Admin)
header (AppHeader):   [mark on phone] Sovkora  [Local · Sovereign chip]            theme · bell · [avatar ▾]
account menu (AccountMenu):   avatar · name · e-mail  │ Profile · Settings │ Language ▸ │ Sign out
settings (SettingsLayout, one route per section):  Account · Appearance · Workspace · Integrations · API keys · Webhooks
default avatars:  @krizaka/ui `Avatar defaultAvatar={{ brand, seed }}` — a generated picture per account, never an initial
home:  a greeting, one primary action (« New chat »), the figures, the recent work — skeletons while it loads
```

Pictures of the reference, signed out (the same tooling, `pr-assets/verikora/ux-review-2026-10-reference-sovkora/`):
[the home's first screen](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10-reference-sovkora/signed-out/home-en-desktop-dark-first.png)
(the real app in a browser frame beside the promise, three measured figures under it),
[the full home](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10-reference-sovkora/signed-out/home-en-desktop-dark.png),
[the sign-in](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10-reference-sovkora/signed-out/login-desktop-dark.png)
(the mark large, the promise, three pillars, « Forgot password? », the language as a labelled pair),
[the phone home](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10-reference-sovkora/signed-out/home-en-phone-dark-first.png).

The rules it follows, which Verikora will follow too:

1. **Where you work on the rail, who you are under the avatar** — nothing in both; no action on the rail.
2. **One list** of sections read by the rail, the drawer and the palette; the active one from the route.
3. **The header names the product**, not the page; the page's `h1` is in the content (`PageHeader`).
4. **Settings are routes** (`/settings/<section>`) on `SettingsLayout`, flat rows, one save per section.
5. **Every state is told**: skeletons, empty states with the bird, errors as alerts in place.

---

## 3. Findings, ranked by impact on Éric

Impact: **A** blocks or misleads the job · **B** slows it or looks unfinished · **C** polish. Each line names its
evidence (a picture of the appendix) and its block in the target.

### A. Shell, navigation, wayfinding

| # | Impact | Finding | Evidence | Target |
| :-- | :-- | :-- | :-- | :-- |
| A1 | A | **An action in the rail.** « + Vérifier » sits between Bibliothèque and Recherche as if it were a place; the `+` icon is unreadable without its tooltip, and the tooltip opens over the page (keyboard shot). Both `/app/verifier` and `/app/verifier/lots` light it. | [library-desktop-dark](#captures), [keyboard-focus](#captures) | the rail holds destinations only; « Vérifier un document » is the header's primary action (§ 4.1) |
| A2 | A | **No `h1` on any app page** (the audit counts 0 on all 14): the page's title is drawn in the `AppHeader` (« Bibliothèque », « Document », « Compte »), so the product's name is nowhere on a desktop, screen readers land on nothing, and the title changes while the frame stays. | audit.json `h1=0`, [check-desktop-dark](#captures) | `AppHeader name="Verikora"` + a `PageHeader` per page |
| A3 | B | **The rail's foot**: a settings cog (a destination that is also in the account menu) and a lone chevron (the expand control with no word). Oussama: « le bas du rail est bizarre ». | [library-desktop-dark](#captures) | foot = the collapse control with its label only; settings in the account menu |
| A4 | B | **The header's account shows a truncated e-mail address** (cut with an ellipsis at 1440 px) because the persona has no name and `showName` falls back on the address. | [library-desktop-dark](#captures) | `showName` only when a name exists; the menu shows the address; the seed data gives Éric a name |
| A5 | B | **The account menu's theme row is a bare moon icon** without a visible label (one of the four unnamed buttons the audit counts on the settings pages comes from the same `ThemeToggle variant="ghost"`). | [account-menu-open](#captures) | a labelled « Thème » row (krizaka-ui K3) |
| A6 | B | **Two primaries on the library** (« Vérifier un document » on the page and, after #279, in the header). | [library-desktop-dark](#captures) | one primary per screen: the header's; the page keeps « Nouvelle collection » (secondary) |
| A7 | C | The DEV build line (« DEV · v0.1.0+02ea492 ») is inside the account menu between the theme and sign out, and again in the rail mark's `title`. | [account-menu-open](#captures) | a chip in the header (`AppHeader chips`), as Sovkora's « sovereign » chip |
| A8 | C | « Bibliothèque » is both the rail's home and the breadcrumb root of a collection; « Recherche » and `/app/search` are two addresses for one place. | [collection-desktop-dark](#captures) | keep one address each; the breadcrumb says « Bibliothèque » |

### B. The library (the home)

| # | Impact | Finding | Evidence | Target |
| :-- | :-- | :-- | :-- | :-- |
| B1 | A | **The collection wears a person.** The default collection avatar is the family's default *account* picture (a bust in a circle): a folder of leases looks like a contact. It appears on the card, the breadcrumb and the collection's title. | [library-desktop-dark](#captures), [collection-desktop-dark](#captures) | place marks (folder, building, people) from `@krizaka/icons` or a `defaultAvatar kind="place"` set (krizaka-ui K4, org library krizaka-com#381) |
| B2 | A | **Documents are named by their filename**: « page », « facture modele krizaka », « contrat de prestation modele krizaka ». The insight already knows « Bail de logement », the rent and the parties, but the title never uses them. | [library-desktop-dark](#captures), [document-infos](#captures) | the title is composed from the insight (kind · party · address), the filename stays as the subtitle |
| B3 | B | **The screen answers « what do I have » but not « what did I check »**: the last check, its result and the report are not on the home; the status chip (Gardé · Vérifié) says the file's state, not the verdict. | [library-desktop-dark](#captures) | « Dernières vérifications » first (#275 / PR #277), result chips (conforme · à regarder · problème) |
| B4 | B | **The drop zone is repeated on three screens** (Vérifier, the collection, the empty library), each time under two checkboxes (« Conserver mes documents », « Ces photos sont les pages d'un seul document ») that make no sense before a file is chosen. | [collection-desktop-dark](#captures), [check-desktop-dark](#captures) | drop anywhere (`DropOverlay` + `UploadQueue`), options asked after the files are known |
| B5 | B | **On a phone each document is a card of four label/value rows** (Type, État, Taille, Ajouté): 1 484 px for four files. Size and date are secondary. | [library-phone-dark](#captures) | `DataTable` column `priority` (title + status only on a phone), as Folioviv's clients table already does |
| B6 | C | The table's filter reads « Rechercher dans « Document » » (the column header injected in a generic label); the facets « Type » and « État » are fine. | [library-desktop-dark](#captures) | « Filtrer par titre » |
| B7 | C | The empty library (new account) is a drop zone and two example links; it does not say what Verikora does nor show the three kinds. | code `LibraryView`, `libraryScreen` | the teaching empty state of #275 with the owl |

### C. Checking a document

| # | Impact | Finding | Evidence | Target |
| :-- | :-- | :-- | :-- | :-- |
| C1 | A | **The kind picker is a tab bar glued to the top** (Automatique · Bail · Contrat · Facture · Autre) with no visible question; the segmented control reads as views of the page. Oussama's remark; also #278. | [check-desktop-dark](#captures) | « Quel document ? » as a `ChoiceGrid` (or `RadioGroup variant="buttons"` as PR #279 does), one line each, Automatique preselected |
| C2 | A | **The order is inverted**: picker, two checkboxes, then the drop zone, then a note on photos, then the batch link. The thing to do (drop a file) is fourth. | [check-desktop-dark](#captures) | drop first and large; the kind under it; options folded (« Options ») |
| C3 | B | **The checkbox « Ces photos sont les pages d'un seul document » is checked by default and shown even when no photo is chosen.** | [check-desktop-dark](#captures) | shown only when two or more images are in the queue |
| C4 | B | **After the upload the person lands on the « Informations » tab**, not on the check; the check needs a second decision on another tab (« Lancer la vérification ») with a nature and a jurisdiction to confirm. | [document-verifications](#captures) | land on the report tab with the run started (or one confirm when the kind is uncertain); `StepProgress` while it runs |
| C5 | B | **The jurisdiction default does not follow the kind**: an invoice (« Une facture de fournisseur ») still shows « Québec — bail de logement (C.c.Q., art. 1851 et suiv.) » as its jurisdiction. | [document-2-verifications](#captures) | the rule set derives from the kind; the person sees one line: « Vérifiée selon les règles du Québec pour une facture, en vigueur le … » |
| C6 | B | **The batch page is under the same header title** (« Vérifier un document ») and the same lit rail item, with its own card-in-a-page. | [check-batches](#captures) | « Lots » is a tab of the Vérifications destination (§ 4.1) |
| C7 | C | The checks tab's lead is a paragraph of jargon: « votre facture au regard des mentions obligatoires du Québec et du format des numéros de TPS et de TVQ, votre contrat de services au regard des règles fédérales sur l'intérêt et le droit d'auteur… ». | [document-verifications](#captures) | one line per kind, said by the choice itself |

### D. The document and its report

| # | Impact | Finding | Evidence | Target |
| :-- | :-- | :-- | :-- | :-- |
| D1 | A | **The verdict comes last.** The « Vérifications » tab of a checked invoice opens on the authenticity card (« Seuls les fichiers PDF… »), then the launch form, then a stepper and six engine facts (run id, Studio version `compliance-check · 1.4.0`, rules `qc-invoice · 2024-06-20`, jurisdiction, dates), then eight finding cards, then the audit report (SHA-256 of the report, signing key), then the sharing form, and only then « Le résultat : les 8 règles vérifiées sont respectées ». 3 938 px on a desktop, 6 110 px on a phone. | [document-2-verifications](#captures) | a verdict band first (`Stat` + tone), the findings next, the engine's facts and hashes in a folded « Détails techniques » |
| D2 | A | **Codes and hashes face a property manager**: `QC-INV-001 · BLOCKING · DETERMINISTIC`, the run id repeated on every card, two SHA-256 and a key. The product's promise (the run id as a trace) is kept by showing it once, folded. | [document-2-verifications](#captures) | severity in words and tone (bloquant · majeur · conseil); codes and hashes in the folded details and the PDF |
| D3 | B | **The « Informations » tab lists « Loyer » twice** (two amounts of the same kind), then a raw list (Fichier, Pages, Taille, Ajouté, SHA-256) under « Où vit ce document » with a lone « Supprimer maintenant » button. | [document-infos](#captures) | one row per amount kind; file facts in `DetailLayout facts`; retention as one sentence with its action |
| D4 | B | **Actions without hierarchy**: « Ouvrir le fichier » (secondary) and « Supprimer » (ghost) in the title row, « Lancer la vérification » (primary) inside a card half-way down, « Télécharger le rapport » lower still. | [document-verifications](#captures) | `DetailLayout actions`: one primary by state (Lancer · Télécharger le rapport), the rest in a menu |
| D5 | B | **Four tabs where two states exist**: Informations · Vérifications · Fichier · Son texte. The file and its text are two views of the same thing; the checks are the point. | [document-infos](#captures) | Rapport · Document (viewer with text), Historique when a second run exists |
| D6 | C | The document page overflows by 3 px at 390 and 33 px at 360 (the run-id code and the hash do not wrap). | audit.json | `break-all` on codes; the folded details solve most of it |
| D7 | C | The « Partager » form (e-mail + date + button) is on the report with no explanation of what the person will see. | [document-2-verifications](#captures) | a side panel « Qui peut voir ce rapport » (`DetailLayout aside`) |

### E. Settings and the account

| # | Impact | Finding | Evidence | Target |
| :-- | :-- | :-- | :-- | :-- |
| E1 | A | **The settings overflow the phone**: five tabs (Profil · Sécurité · Abonnement et facturation · Stockage · Mes données) in one row push the page 167 px past the screen at 390 px and 197 px at 360 px; the header's box stops short and the whole page scrolls sideways. | [settings-profile-phone-dark](#captures) | `SettingsLayout` (chips that wrap, one menu past five) |
| E2 | A | **The profile is hand-made against the documented patterns**: the name field with its own save *above* the pictures; the avatar picker as six loose radios beside six circles (the meta of `account-settings` says « never a row of circles with loose radios »); the language as an unlabelled segmented bar; the perspective as a card with a second disabled save. | [settings-profile-desktop-dark](#captures) | `AccountProfileCard` + `AvatarPicker` + `LanguagePicker` + `ChoiceCards` in one `SettingsSection` with one save, dirty → saved → undo |
| E3 | B | **Billing has two equal secondary buttons** (« Payer cet audit », « Passer à Pro ») and a « Mode test » alert above them; the plan is a label pair. | [settings-billing](#captures) | flat rows: Forfait · Audits restants · one primary (« Passer à Pro ») · the portal link |
| E4 | B | **Storage speaks to an operator**: « Cette installation ne peut pas enregistrer d'identifiants : le stockage S3 personnel est indisponible. » | [settings-storage](#captures) | the unavailable choice is simply not offered, with one plain line |
| E5 | C | No identity header: who is signed in, since when, verified or not, is nowhere on the settings. | [settings-profile-desktop-dark](#captures) | `AccountProfileCard` on top of `SettingsLayout` |

### F. The public site (verikora.com), signed out and signed in

| # | Impact | Finding | Evidence | Target |
| :-- | :-- | :-- | :-- | :-- |
| F0 | A | **Two truths on one screen once signed in** (Oussama's capture of `/en`, confirmed in code): the bar's island (`BarSession`) says « Open the app » beside the avatar **and the raw e-mail** (`name ?? email`), while the static hero still says « Sign in » and the status line « sign-up is closed ». The bar's part is steered on PR #279; the hero is not. | [public-home-en, signed in](#captures) | the hero's action and status line read the same `/api/me` answer as the bar: « Ouvrir l'application » (primary) when signed in, the sign-up line hidden; the bar's name only when a name exists |
| F6 | A | **A 236 px empty band above the hero at 1440 px** (about 190 px on a phone): `main` adds `pt-20` (80 px) on top of the `PageHero`'s own `padding-top: var(--kz-hero-top, clamp(112px, 14vw, 156px))`. The first screen is the bar, the void, a title. | [home-fr first screen](#captures) | remove `pt-20`; set `--kz-hero-top` to the bar's height + 24 px (as krizaka.com's « One frame for every page ») |
| F7 | A | **The product is never shown.** The hero is text with an empty right half; « Ce que ça fait » is three `h3` + paragraphs; the only visual is the mono proof block. A visitor cannot see what the app looks like. | [home-fr-desktop-dark](#captures) | `LandingPage` with the real app as `visual` (`StepShowcase`, `DeviceFrame kind="browser"`: drop → reading → report, recorded on www with Éric), `proofs` from the recorded run (rules, articles, findings), the three things as `ArgumentCard`s with icons and the owl once |
| F8 | B | **The first screen on a phone** (390 × 844) holds the bar, the band, the title, the lead and the button — no product, no proof. | [home-fr-phone first screen](#captures) | the visual directly under the action, inside the first 844 px; the status line folded under it |
| F9 | C | The home's sections have no backdrop or rhythm: three sections on one flat surface, a hairline between two. | [home-fr-desktop-dark](#captures) | `SectionBackdrop` behind the hero (the brand's dome, no grid), `divider` between sections, the closing call as `CtaPanel` |
| F1 | A | **No « Mot de passe oublié »** on the sign-in; the only way back is to write to the team. | [sign-in-desktop-dark](#captures) | the forgot/reset flow (Folioviv has one; share it through `@krizaka/auth`) |
| F2 | B | **The sign-in's left half is empty**: one sentence, a 72 px owl, 900 px of dark. The error state is right (in place, under the password). | [sign-in-desktop-dark](#captures), [sign-in-error](#captures) | the owl large, three proofs under the promise, the same `AuthLayout` |
| F3 | B | **The 404 is Next.js' default** (black page, « This page could not be found. », English only): `not-found.tsx` exists only under `[locale]`, unmatched routes never reach it. | [not-found](#captures) | `ErrorPage` of @krizaka/ui at the root, FR/EN, the owl « lost », back to the library or the home |
| F4 | C | The home's hero is text on the left and 700 px of nothing on the right; « Se connecter » is both the bar's action and the hero's. | [home-fr-desktop-dark](#captures) | the proof block (lease → finding) as the hero's visual; the bar keeps `ProductBarActions` |
| F5 | C | The sign-up page promises « Un audit gratuit, puis payez à l'audit ou abonnez-vous » while saying it is closed. | [sign-up](#captures) | one message, from the setting |

### G. Accessibility (WCAG 2.2 AA, 360 px)

| # | Impact | Finding | Evidence | Target |
| :-- | :-- | :-- | :-- | :-- |
| G1 | A | Horizontal overflow at 360 px on 11 pages (settings 197 px, document 33 px). | audit.json | E1, D6 |
| G2 | A | No `h1` on 14 app pages (A2). | audit.json | A2 |
| G3 | B | Unnamed buttons: 4 on the settings pages (theme toggle, avatar radios), 2 on the check page (the drop zone's internal controls), 1 on the report. Unlabelled input: 1 on the check, batch, collection and storage pages (the hidden file input). | audit.json | labels from the blocks; `FileUpload` gets its `label` |
| G4 | B | Focus: the ring is visible (keyboard shot) and the skip link exists; but the rail tooltip opens on focus and covers the content column. | [keyboard-focus](#captures) | K1 |
| G5 | C | Status is sometimes colour-only on chips (« Vérifié » green vs « Gardé » grey): the words are there, fine; the verdict chips of the report (« Point respecté ») rely on the word too — keep it. | [document-2-verifications](#captures) | tones + words, as today |
| G6 | C | Light theme: correct everywhere captured; the collection avatar's gradient and the owl read well on both. | [library-desktop-light](#captures) | — |

### H. Copy (FR/EN)

| # | Impact | Finding | Target |
| :-- | :-- | :-- | :-- |
| H1 | B | « 1 résultat(s) », « 0 manquement(s) bloquant(s) sur 8 règles » — bracket plurals. | `pluralKey` (already in the repo) |
| H2 | B | The insight's « (confiance élevée) », the report's « Corpus québécois à faire relire par un avocat : un tri de démonstration », « Vérification informative » — honest, keep; but say them once per page. | one disclaimer per page, at the end |
| H3 | C | « Son texte » (tab), « Où vit ce document », « Récents » — fine; « Rechercher dans « Document » » and « Type des prochains documents » are system-speak. | « Filtrer par titre », « Quel document ? » |
| H4 | C | English mirrors are complete (`krizaka-i18n check`); « Kind of the next documents » has the same problem as its French. | same fix |

### I. Consistency

- With **Sovkora**: the rail holds an action (A1), the header holds the page's title (A2), settings are not on
  `SettingsLayout` (E1–E2), no identity card (E5), tabs are not routes-as-tabs (`Tabs.Nav`, krizaka-ui#487 — the
  document's `@ephemeral` note already says so).
- Between **Verikora's own screens**: three drop zones (B4); the collection avatar vs the account avatar (B1); cards
  with `h2`/`h3` of three sizes (`text-lg`, `text-base`, `text-xl`) on the document, the library and the settings; the
  primary button's colour differs between the dark hero (`#8b8cf7`-like token) and the light header — both tokens,
  fine, but the chamfer (`shape="cut"`) is absent on every call to action while krizaka.com uses it everywhere.

---

## 4. The target design

### 4.1 Information architecture

**Who comes:** Éric (property manager: leases, tenants' pay stubs, suppliers' invoices), a tenant checking a lease, a
freelancer checking a service contract. **Their jobs:** check a document and get the answer; find a report again;
keep documents by building or tenant; prove what was checked (the run).

```
rail (RailNav, expandable; phone: bottom tabs)        header (AppHeader)
┌────┐
│ 🦉 │  mark → /app                                   [≡ phone][🦉 phone] Verikora  [DEV · v0.1.0]
│ ▣  │  Bibliothèque      /app                                        [Vérifier un document ▸ primary, shape=cut]  [avatar ▾]
│ ✓  │  Vérifications     /app/verifications   (tabs: Vérifications · Lots)                                      ├ avatar · name · e-mail
│ 🔍 │  Recherche         /app/recherche                                                                         ├ Profil        /app/settings/profil
│    │                                                                                                           ├ Réglages      /app/settings
│ ‹  │  Replier le menu   (the foot: that control only, with its word)                                           ├ Facturation   /app/settings/facturation
└────┘                                                                                                           ├ Langue ▸ · Thème ▸
                                                                                                                 ├ (Administration — admins)
                                                                                                                 └ Se déconnecter
phone tabs:  Bibliothèque · Vérifications · Recherche   (three; the account is in the header on every width, verikora#243)
```

- **Three destinations**, no action on the rail. « Vérifier un document » is the header's primary action on every
  signed-in screen (and the page's primary nowhere else: A6).
- **Vérifications is new as a destination**: the list of every check (document, kind, result, date, run) with « Lots »
  as a second tab. Today `/app/verifier` (the drop page) becomes the task page the header's button opens; it keeps its
  address. `/app/verifier/lots` → `/app/verifications?tab=lots` (308).
- **The account owns the settings** (Sovkora's rule); `/app/settings/<section>` stays.
- **Every page has one `PageHeader`** (`h1`, one line, secondary actions); the `AppHeader` names the product and
  carries the DEV chip.
- **Breadcrumb** on a collection, a folder and a document: Bibliothèque / Collection / Dossier.
- Addresses unchanged otherwise (a document's tabs stay routes: `/app/documents/<id>/<tab>`).

### 4.2 Wireframes

Blocks named in brackets. « P » = primary, « S » = secondary.

#### Library home — populated (`/app`)

```
desktop                                                               phone (390)
┌─rail─┬──────────────────────────────────────────────────────────┐  ┌──────────────────────────────────┐
│ 🦉   │ Verikora · DEV            [Vérifier un document P] [👤▾] │  │ 🦉 Verikora   [Vérifier P] [👤▾] │ [AppHeader]
│ ▣    ├──────────────────────────────────────────────────────────┤  ├──────────────────────────────────┤
│ ✓    │ Bibliothèque                        [Nouvelle collection S]│  │ Bibliothèque                      │ [PageHeader]
│ 🔍   │ Immeubles, locataires, fournisseurs — et chaque rapport.   │  │ [Nouvelle collection S]           │
│      ├──────────────────────────────────────────────────────────┤  ├──────────────────────────────────┤
│      │ Dernières vérifications                   Tout voir →    │  │ Dernières vérifications   Tout →  │ [Section + SectionHeading]
│      │ ● Bail — 4½ Villeray · 2 points à regarder · hier       →│  │ ● Bail — 4½ Villeray             │ [List rows: status dot,
│      │ ● Facture Plomberie Roy · conforme · 21 oct.            →│  │   2 points à regarder · hier      │  title, verdict chip, date]
│      │ ● Fiche de paie — candidat · conforme · 21 oct.         →│  │ ● Facture Plomberie Roy · conforme│
│      ├──────────────────────────────────────────────────────────┤  ├──────────────────────────────────┤
│      │ Collections                                              │  │ Collections                       │
│      │ ┌🏢 Immeuble Rosemont ┐ ┌👥 Candidats 4½ ┐ ┌🧾 Factures ┐ │  │ ┌🏢 Immeuble Rosemont · 6 · ✓ ──┐│ [CardGrid + LinkCard,
│      │ │ 6 fichiers · vérifié│ │ 6 · 2 à regarder│ │ 4 · conforme│ │  │ ┌👥 Candidats 4½ · 6 · ⚠ ────┐│  place mark, count,
│      │ └────────────── … ───┘ └───────────── … ─┘ └─────── … ───┘ │  │ ┌🧾 Factures 2026 · 4 · ✓ ───┐│  last-check chip, ⋯ menu]
│      ├──────────────────────────────────────────────────────────┤  ├──────────────────────────────────┤
│      │ Récents                       [Filtrer par titre] [Type▾] │  │ Récents           [Type▾][État▾] │ [DataTable, column
│      │ Document              Type   Résultat    Ajouté           │  │ Bail — 4½ Villeray    ⚠ à regarder│  priority: title +
│      │ Bail — 4½ Villeray    Bail   ⚠ 2 points  hier             │  │ Facture Plomberie Roy ✓ conforme  │  result on a phone]
│      │ …                                                        │  │ …                                 │
│ ‹    │                                                          │  ├──────────────────────────────────┤
└──────┴──────────────────────────────────────────────────────────┘  │ ▣ Biblio  ✓ Vérif  🔍 Recherche   │ [RailNav tabs]
                                                                     └──────────────────────────────────┘
drop anywhere: [DropOverlay] over the whole window while a file is dragged; [UploadQueue] tray bottom-right.
```

#### Library home — empty (new account)

```
┌──────────────────────────────────────────────┐
│ Bibliothèque                                 │ [PageHeader]
│                                              │
│         🦉 (owl, « welcome », 120 px)        │ [EmptyState, template « library »]
│   Déposez un bail, une fiche de paie ou une  │
│   facture : Verikora le lit selon les règles │
│   du Québec et cite la ligne de chaque constat.│
│   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │ [FileUpload Dropzone — the only one on the page]
│     Déposez un document ici · Choisir        │
│   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
│   Ou essayez : [Un bail] [Une fiche de paie] [Une facture]   │ [ChipRow → examples (#274), dev only « Charger la démo »]
└──────────────────────────────────────────────┘
```

#### Check a document (`/app/verifier`, opened by the header's button)

```
desktop (one column, max 48rem)                         phone
┌──────────────────────────────────────────────┐       ┌──────────────────────────────┐
│ ← Bibliothèque                               │       │ ← Bibliothèque                │
│ Vérifier un document                         │       │ Vérifier un document          │ [PageHeader]
│ Un fichier à la fois ; un lot ? → Lots       │       │                               │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐│       │ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │ [FileUpload, large, first]
│   ⬆  Déposez votre document                  │       │   ⬆  Déposez votre document  │
│   PDF, Word, photo — 10 Mo        [Choisir P]│       │              [Choisir P]      │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘│       │ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
│ Quel document ?                              │       │ Quel document ?               │ [ChoiceGrid, 5 tiles, Automatique ✓]
│ [✓ Automatique] [Bail] [Contrat] [Facture] [Autre]   │ [✓ Automatique][Bail][Contrat]│
│  Verikora reconnaît le type · bail de logement …     │ [Facture][Autre]              │
│ ▸ Options (conserver le document · photos = pages)   │ ▸ Options                     │ [native <details>, shown after files]
│ Vérification informative, pas un avis juridique.     │                               │
└──────────────────────────────────────────────┘       └──────────────────────────────┘
after the drop → the document page opens on « Rapport » with [StepProgress]: Lecture › Contrôle › Règles › Rapport
```

#### Document (`/app/documents/<id>/rapport`)

```
desktop                                                                       phone
┌─────────────────────────────────────────────────────────────────────┐    ┌────────────────────────────┐
│ ← Immeuble Rosemont                                                 │    │ ← Immeuble Rosemont        │ [DetailLayout: back]
│ 📄 Bail — 4½ Villeray, M. Tremblay          [Télécharger le rapport P]│    │ Bail — 4½ Villeray         │  title from the insight
│ Bail de logement · page.pdf · 2 p. · gardé jusqu'au 23 oct.  [⋯]    │    │ ✓ Vérifié · Bail  [⋯]       │  facts · chips · actions
│ ┌ Rapport ┐ Document   Historique                                   │    │ [Télécharger le rapport P] │
├─────────────────────────────────────────────────────────────────────┤    │ Rapport · Document · Hist. │ [Tabs as routes]
│ ┌──────────────────────────────────────────┐ ┌─ Qui peut le voir ─┐ │    ├────────────────────────────┤
│ │ ⚠ 2 points à regarder sur 10 règles      │ │ Vous seul.          │ │    │ ⚠ 2 points à regarder      │ [verdict band: Stat + tone,
│ │ Règles du Québec · bail de logement ·    │ │ [Partager…  S]      │ │    │ sur 10 règles              │  one line of context]
│ │ en vigueur le 23 oct. 2026               │ │                     │ │    ├────────────────────────────┤
│ ├──────────────────────────────────────────┤ │ Ce rapport          │ │    │ ✕ Dépôt de garantie interdit│ [findings: failed first,
│ │ ✕ Dépôt de garantie interdit  · bloquant │ │ en français (règles)│ │    │   « dépôt de sécurité… »   │  each: title, severity
│ │   « dépôt de sécurité de 1 450 $ »       │ │ [FR] [EN]           │ │    │   C.c.Q. art. 1904 · Voir →│  word, quote, rule, link]
│ │   C.c.Q., art. 1904 — Voir dans le fichier│ └────────────────────┘ │    │ ✓ 8 règles respectées  ▸   │ [passed: one folded row]
│ │ ✕ Clause interdisant les enfants · bloquant                      │    │ ▸ Détails techniques       │ [<details>: run id, Studio,
│ │ ✓ 8 règles respectées                                ▸ voir     │    │                            │  rules, hashes, signature]
│ │ ▸ Détails techniques (exécution, version, empreintes)           │    └────────────────────────────┘
│ │ Vérification informative, ce n'est pas un avis juridique.       │
│ └──────────────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
« Document » tab: [SplitView] viewer (DocumentViewer) + the insight (DescriptionList: kind, parties, amounts once each,
dates, language, source) + personal data notice (Alert) + retention (one sentence, one action).
```

#### Vérifications (`/app/verifications`)

```
┌───────────────────────────────────────────────────────────────┐
│ Vérifications                            [Importer un lot S]  │ [PageHeader]
│ ┌ Vérifications ┐  Lots                                       │ [Tabs as routes]
│ [Filtrer] [Résultat ▾] [Type ▾] [Période ▾]      12 résultats │ [FilterBar]
│ Document                 Type     Résultat        Quand   Exéc.│ [DataTable; phone: title + result]
│ Bail — 4½ Villeray       Bail     ⚠ 2 à regarder  hier    ▸    │
│ Facture Plomberie Roy    Facture  ✓ conforme      21 oct. ▸    │
│ (empty: 🦉 « Aucune vérification encore » + [Vérifier un document])  │ [EmptyState]
└───────────────────────────────────────────────────────────────┘
```

#### Settings (`/app/settings/profil`)

```
desktop                                                       phone
┌──────────────────────────────────────────────────────┐     ┌──────────────────────────────┐
│ Réglages                                             │     │ Réglages                     │ [SettingsLayout variant="flat"]
│ ┌ 👤 Éric Tremblay · courriel ✓ vérifié · depuis oct. 2026 ┐ │     │ 👤 Éric Tremblay · courriel ✓│ [AccountProfileCard]
│ Profil      │ Profil                                 │     │ (Profil)(Sécurité)(Abonnement)│ [nav chips, wrapping]
│ Sécurité    │ Nom              [Éric Tremblay      ] │     │ (Stockage)(Mes données)      │
│ Abonnement  │ Photo            ◉ ○ ○ ○ ○ ○  [Téléverser]│     ├──────────────────────────────┤
│ Stockage    │ Langue           (Français)(English)   │     │ Nom        [Éric Tremblay]   │ [SettingsRow × n]
│ Mes données │ Votre rôle       ┌Locataire┐┌Propriétaire┐│     │ Photo      ◉ ○ ○ ○ ○ ○       │ [AvatarPicker]
│             │                  └─────────┘└──────────┘│     │ Langue     (Français)(English)│ [LanguagePicker]
│             │                  ┌Autonome✓┐┌Entreprise┐│     │ Votre rôle [ChoiceCards ×4] │ [ChoiceCards]
│             │ ───────────────────────── [Enregistrer P]│     │        [Enregistrer P] saved ✓│ [one save, status, undo]
└──────────────────────────────────────────────────────┘     └──────────────────────────────┘
Sécurité: rows (adresse · changer par lien · mot de passe · appareils connectés) · Abonnement: Forfait · Audits restants ·
[Passer à Pro P] · portail (link) · Stockage: ChoiceCards (rien · Krizaka · le vôtre, if offered) · Mes données: export
(button) · supprimer (ConfirmButton).
```

#### Sign-in (`/sign-in`)

```
┌─────────────────────────────┬───────────────────────────────┐
│ 🦉 Verikora                 │                               │ [AuthLayout]
│                             │ Connexion                     │
│ Vos documents, lus et       │ Courriel      [            ]  │ [form.TextField]
│ vérifiés par Verikora.      │ Mot de passe  [            ]  │
│                             │               Mot de passe oublié ? │ [link → /forgot-password]
│   🦉 (owl « welcome », 160) │ [Se connecter P, shimmer]     │
│ ✓ Chaque constat cite sa    │ Pas de compte ? Créer un compte│ [from the setting; closed → one line]
│   règle et sa ligne         │                               │
│ ✓ Vos documents restent     │ En vous connectant… avis de   │
│   au Canada                 │ confidentialité.              │
│ ✓ Rapport en français et    │                               │
│   en anglais                │                               │
└─────────────────────────────┴───────────────────────────────┘
phone: the form first, the owl and the three lines under it.
```

#### 404

```
🦉 (owl « lost »)   Cette page n'existe pas.   [Retour à la bibliothèque P] [Accueil S]      [ErrorPage, FR/EN by the address]
```

#### Public home (`/fr`, `/en`) — the first screen, signed out and signed in

```
desktop 1440 × 900 (what the visitor sees before scrolling)                        [NavBar + ProductBarActions]
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 🦉 Verikora   Ce que ça fait · Une vraie vérification · Confidentialité   ⌥ ☾ fr  [Se connecter P]     │ signed out
│                                                                 … signed in:  [Ouvrir l'application P] [👤▾] (name only if set)
├──────────────────────────────────────────────────────────────────────────────────┤
│  (SectionBackdrop: the indigo dome, no grid)                                      │ [LandingPage]
│  Lisez avant de signer.                       ┌─ browser frame ──────────────────┐│  eyebrow: « Québec · baux, contrats, factures »
│  Déposez un bail, un contrat ou une facture.  │ 🦉 Verikora  Bibliothèque … [👤] ││  visual: StepShowcase (DeviceFrame browser)
│  Verikora le lit selon les règles en vigueur  │ ⚠ 2 points à regarder sur 10     ││   step 1 « Déposez »  step 2 « Il lit »
│  et montre la ligne derrière chaque constat.  │ ✕ Dépôt de garantie interdit     ││   step 3 « Le rapport cite la ligne »
│  [Se connecter P, shimmer]  ou  [Ouvrir l'application P] when signed in          ││  (recorded on www with Éric's data)
│  En développement — comptes sur invitation.   │ ✓ 8 règles respectées            ││  status line only when signed out
│                                               └──────────────────────────────────┘│
│  10 règles vérifiées · 4 articles cités · 1 constat   (proofs, from the recorded run)   │ [proofs → Stat row]
└──────────────────────────────────────────────────────────────────────────────────┘
below the fold:  « Ce que ça fait » as three ArgumentCards (icon · hook ≤ 90 chars · one fact · « Voir la vérification → »)
                 « Une vraie vérification » = BeforeAfter (kept) + its run line, the owl once (MascotQuote callout)
                 « Pour qui » as a Facts row (locataire · propriétaire · travailleur autonome · entreprise)
                 closing CtaPanel: « Se connecter » / « Lire l'avis de confidentialité » · footer

phone 390 × 844 (first screen)
┌──────────────────────────┐
│ 🦉 Verikora         [≡]  │
│ Lisez avant de signer.   │
│ Déposez un bail …        │
│ [Se connecter P]         │  (signed in: [Ouvrir l'application P])
│ ┌ browser frame ───────┐ │  the visual inside the first screen,
│ │ ⚠ 2 points à regarder│ │  poster painted at once (LCP), loop on scroll
│ │ ✕ Dépôt de garantie …│ │
│ └──────────────────────┘ │
│ 10 règles · 4 articles   │
└──────────────────────────┘
```

### 4.3 Visual direction

- **Hue**: Verikora's indigo (`@krizaka/tokens brands/yomizaka.css`, `.brand-verikora`), the owl's. Every surface,
  text and border is a `--kz-*` role; no page-local colour. Verdicts use the semantic tones only: `success`
  (conforme), `warning` (à regarder), `danger` (bloquant), `neutral` (gardé, en lecture).
- **Density**: comfortable. Table rows 48 px on a desktop, 56 px touch targets on a phone, 16 px gutters, sections
  32 px apart, one column up to 48 rem for task pages (check, settings), full width for lists.
- **Typography roles** (from `@krizaka/fonts` through the tokens): display for the one `h1` of a page (2xl, 700);
  section `h2` lg 700; card titles base 600; body md; meta sm `text-fg-secondary`; mono **only** for codes inside the
  folded technical details, never in a title or a chip.
- **Marks and icons**: `YomizakaLogo` once per width (rail on a desktop, header on a phone); `@krizaka/icons` for
  destinations (library, check, search), places (folder, building, people, receipt) and verdicts (check, alert,
  cross). No emoji, no third-party icon.
- **Illustration**: the owl only (`Mascot bird="owl"`), one per screen at most, in its moods — `welcome` (sign-in,
  first library), `empty` (empty lists), `thinking` (search without result, a running check), `success` (a clean
  report, in the band, small), `error` (a failed run, the 404 as « lost »). Sizes: 160 on an auth page, 120 on an empty
  page, 72 inline. Default collection marks and the owl states come from the org media library once it exists
  (krizaka-com#381); until then the icon set.
- **Dark and light**: both first-class; the capture set has both for every screen, the light set shows no regression.
  The chamfer (`shape="cut"`) on every call to action, as the family's sites.

### 4.4 What changes, screen by screen

| Screen | Today | Target |
| :-- | :-- | :-- |
| Shell (all app pages) | rail: Bibliothèque · + Vérifier · Recherche; foot: cog + chevron; header: page title + e-mail | rail: Bibliothèque · Vérifications · Recherche; foot: collapse with its word; header: Verikora + DEV chip + « Vérifier un document » (P) + avatar menu (Profil · Réglages · Facturation · Langue · Thème · Se déconnecter) |
| Library `/app` | actions row, « Collections » (person avatar), « Récents » table | PageHeader; Dernières vérifications; collections as LinkCards with place marks and result chips; Récents (priority columns); DropOverlay + UploadQueue; teaching empty state |
| Collection `/app/bibliotheque/…` | breadcrumb with avatar, folder cards, table, checkboxes + drop zone | breadcrumb; PageHeader (place mark, counts, « Ajouter des documents » S, ⋯); folders as a chip row; FilterBar + DataTable; DropOverlay |
| Vérifier `/app/verifier` | segmented kinds, two checkboxes, drop zone, note, batch link | PageHeader; drop first; ChoiceGrid « Quel document ? »; folded options; the run starts on upload |
| Vérifications `/app/verifications` | — (batches at `/app/verifier/lots`) | list of checks + « Lots » tab; empty state |
| Document `/app/documents/<id>` | title = filename; 4 tabs; verdict last; codes and hashes on the face | DetailLayout; title from the insight; Rapport · Document · Historique; verdict band; findings; technical details folded; side panel for sharing |
| Recherche | field + « 1 résultat(s) » + cards | PageHeader; SearchField; proper plurals; result list with the highlight; owl when empty |
| Réglages | hand-made tabs (overflow), loose radios, two saves | SettingsLayout flat + account-settings blocks; one save per section; identity card |
| Sign-in / sign-up | half-empty aside; no forgot password | AuthLayout with the owl large and three proofs; « Mot de passe oublié ? »; one message from the sign-up setting |
| 404 | Next default | ErrorPage with the owl |
| Public home | a 236 px band, a text hero with an empty right half, text-only sections; signed in, « Open the app » + raw e-mail in the bar while the hero says « Sign in » | `LandingPage` on `SectionBackdrop`: the real app in a browser frame (`StepShowcase`, three recorded steps), proofs from the recorded run, three `ArgumentCard`s, the kept `BeforeAfter`, a `CtaPanel`; the hero's action and status follow the session like the bar; no band; the product inside the phone's first screen |
| Privacy · Terms · Download (public) | correct on `PageHero` + `Page`; signed in they keep the same bar state as the home | same bar fix (F0); nothing else |

---

## 5. The implementation cut

One pull request each, in this order; every one ships its tests (`node:test`/vitest for logic, a render test for the
screen, a 360 px overflow test where a layout changes) and its before/after captures on Bunny. Each names the screens
it covers so the captures of this review serve as the « before ».

| # | Issue (title) | Scope | Acceptance | Screens |
| :-- | :-- | :-- | :-- | :-- |
| Y0 | **demo: Éric's data set** (#274, PR #276) | the generator and the seed — lands first so every later capture shows a real library; add a `name` to the persona (A4) | PR #276's tests; the seeded account has a name and three collections | all signed-in |
| Y1 | **shell: Sovkora's pattern** (#278, PR #279 + the rest) | rail destinations only (Bibliothèque · Vérifications · Recherche), foot = collapse with its word, `AppHeader name="Verikora"` + DEV chip + primary « Vérifier un document » (`shape="cut"`), account menu entries, no « Ouvrir la plateforme », `PageHeader` with the `h1` on every page, `/app/verifier/lots` → `/app/verifications?tab=lots` | tests of #278 + « every app page has exactly one h1 » + the header's action visible at 360 px + no horizontal overflow on any app page at 360 px | all signed-in |
| Y2 | **settings on SettingsLayout + account-settings** | `SettingsLayout variant="flat"` with the five sections as routes; `AccountProfileCard`, `AvatarPicker`, `LanguagePicker`, `ChoiceCards` (perspective) in one section with one save; billing / storage / data as rows; the storage choice not offered when unavailable | E1 (no overflow at 360), E2 (one save, saved/undo), unnamed buttons = 0 on the settings pages | settings-* |
| Y3 | **library home** (#275, PR #277 + the rest) | PageHeader; « Dernières vérifications » (PR #277); collections as `LinkCard`s with place marks and the last-check chip (PR #277's chip); `DataTable` column priority; `DropOverlay` + `UploadQueue`; the teaching empty state | #275's tests + the phone list shows title and result only + a drop on the page opens the queue | library-fr/en (desktop, phone), empty |
| Y4 | **check flow** | drop first, `ChoiceGrid` « Quel document ? », options folded and shown after files, photo grouping only with ≥ 2 images, the run started on upload for a confident kind (confirm otherwise), `StepProgress` on the document while it runs; jurisdiction follows the kind | tests: default kind, options hidden before files, grouping rule, the kind → rule-set map, the landing tab | check, document-verifications |
| Y5 | **document on DetailLayout, verdict first** | title from the insight (fallback filename); Rapport · Document · Historique as routes (`Tabs.Nav` once krizaka-ui#487 lands, the current route tabs until then); verdict band; findings (failed first, passed folded); technical details in `<details>`; the sharing side panel; amounts once per kind; no overflow at 360 | tests: title composition, finding order, one occurrence of the run id on the face, 360 px | document-*, document-2-* |
| Y6 | **Vérifications destination** | the list of checks (+ Lots tab) on `FilterBar` + `DataTable`, its empty state | tests: rows from the fixtures, filters in the address, empty state | check-batches → vérifications |
| Y7 | **collection, search** | collection on PageHeader + FilterBar + DropOverlay, folders as chips; search plurals, highlight, owl | tests: plurals, breadcrumb, 360 px | collection, search-* |
| Y8 | **sign-in, sign-up, forgot password** | the aside content; « Mot de passe oublié ? » with the reset flow shared through `@krizaka/auth` (Folioviv has it); one message from the sign-up setting; error tests | tests: the link present, the reset round trip, the closed/open messages | sign-in-*, sign-up |
| Y9 | **public home: the session, the band, the product on screen** | the hero's action and status line read the bar's `/api/me` answer (F0); drop `main.pt-20` and set `--kz-hero-top` (F6); `LandingPage` + `SectionBackdrop` with the real app as `visual` — `StepShowcase` of three steps recorded on www with Éric's data by a `scripts/record-web-steps.mjs` like Sovkora's (stills from this review's captures until the recording exists), `proofs` from the recorded run, three `ArgumentCard`s, the kept `BeforeAfter`, a `CtaPanel`; the visual inside the phone's first screen | tests: the hero says « Ouvrir l'application » when `/api/me` answers and « Se connecter » otherwise (render test on `BarActionsView`'s twin); the hero's top offset equals the bar's height + 24 px; the home's first screen at 390 × 844 contains the visual (Playwright); LCP = the poster | home-*, public-home-* (signed in), first screens |
| Y10 | **404** | `ErrorPage` at the root (`app/not-found.tsx`), FR/EN by the address, the owl « lost » | tests: `/fr/nope` renders the owl page in French with a 404 status | not-found |

Order rationale: Y0 gives the data every capture needs; Y1 and Y2 remove what Oussama named first; Y3–Y5 are the
product's core loop (drop → report); Y6–Y8 finish the app's map; Y9 is the public site Oussama looked at last (it can
run in parallel with Y3–Y5: different files); Y10 is small.

### 5.1 The in-flight pull requests against the target

| PR | Fits as is | Needs |
| :-- | :-- | :-- |
| **#279** shell (Copilot, #278) | the rail's three items, the header's primary, the menu's entries, the picker as a labelled `RadioGroup variant="buttons"`; the public bar's signed-in state (name only when set) is being steered there | the `AppHeader` still names the page (A2): name the product and add `PageHeader` per page (Y1); the foot's collapse label; a 360 px test (the PR says its tests read the source, not a rendered width); the DEV chip; the picker moves under the drop zone in Y4 (keep its component); the hero's session-aware action (F0) is Y9, not #279 — unless the same island is reused there, which is the right move |
| **#277** library (Copilot, #275) | the localised default name, the last-check chip, « Dernières vérifications » | the latest checks must not be « the first five of the 20 recent documents » (PR note): a query over checks (shared with Y6); the person avatar stays (B1); no empty state, no drop-anywhere (Y3 finishes it); run its tests (the PR says they were not run) |
| **#276** demo data (Copilot, #274) | the generator, the seed, the tests | add a display name for Éric (A4); seeded reports should carry a verdict so the chips of Y3 have something to show (they do: `complianceReport` shapes) |
| **#227** account settings (Oussama, older) | its intent is exactly Y2 (« Sovkora-style flat sections, one save each ») | it predates `account-settings` (3.5x) and the perspective chooser; rebase on main and on the blocks, or close it in favour of Y2 |
| **#247** report FR/EN | the toggle belongs in the side panel of Y5's wireframe | place it there when rebasing |
| **#269 / #270** (apps) | not UI of the web app | — |

### 5.2 Ready-to-file krizaka-ui issues

```
K1 — rail-nav: tooltip placement and the collapse control's word
Why: in Verikora the item tooltips open over the content column (keyboard focus shot); the expandable rail's foot shows a
bare chevron. Oussama: « le tooltip recouvre la page », « un chevron tout seul ».
Ask: `tooltipSide` (default "right") with collision handling that never covers the Body; `expandLabels` rendered as the
control's visible word when the rail is expanded (today only the accessible name). Tests: the tooltip's box never
intersects `RailNav.Body`; the expanded foot shows the word.
```

```
K2 — app-header: a primary action slot that survives 360 px
Why: the family's apps put the screen's one action in the header (verikora#278, folioviv « Nouvelle facture »). Today
`actions` is a free slot; at 360 px a labelled `Button lg` pushes the avatar off screen.
Ask: `primary={{ label, icon, onSelect | href }}` drawn as a labelled Button from `sm` and as an icon button with the
label as tooltip/aria-label under it; the avatar never clipped. Test at 360 and 1440.
```

```
K3 — account-menu: a labelled theme row
Why: Verikora and Folioviv drop a `ThemeToggle variant="ghost"` into the menu's children: a lone moon icon with no
visible label (counted as an unnamed button by the audit).
Ask: a `theme` prop like `language` ({ label, value, options, onChange }) rendered as a labelled row or submenu, keyboard
reachable; `ThemeToggle` stays for headers.
```

```
K4 — avatar: default marks for places (collections, shops, buildings)
Why: Verikora's collections wear the account's default picture (a person): a folder of leases looks like a contact.
Folioviv will need shop marks. The org media library (krizaka-com#381) will host them.
Ask: `defaultAvatar={{ kind: "place" | "person", brand, seed }}` where `place` draws from a set of generated marks
(folder, building, people, receipt, briefcase) in the brand's hue, exported by `tools/export-brand.mjs` like the person
set; `Avatar` keeps today's API for persons.
```

```
K5 — blocks: a verdict band and a finding list (report pattern)
Why: Verikora's report (and Sovkora's compliance Studio output, Folioviv's tax working papers later) needs the same
shape: a verdict first, the findings next (failed first, passed folded), the engine's facts folded.
Ask: `VerdictBand` (tone, headline figure, one line of context, optional mascot) and `FindingList` / `FindingItem`
(title, severity word + tone, quote, source line, one action), with a `<details>` for the technical facts. Examples:
compliance report, authenticity report. Until it ships, Y5 composes it from `Stat`, `List` and `Alert`.
```

Also depends on krizaka-ui#487 (`Tabs.Nav`, routes as tabs) for Y5's document tabs — not blocking.

### 5.3 What this review does not change

Sovkora does the analysis (AGENTS § 2): nothing above touches the engine, the run ids or the report's content; the
report is *shown* differently, as Sovkora returned it. The three public pages stay three (UX_DECISIONS § 9). The
addresses stay (one 308 for the batches).

---

## 6. Questions only Oussama can decide

1. **Vérifications as a destination** — the rail becomes Bibliothèque · Vérifications · Recherche, where
   « Vérifications » is the list of every check (and the batches). Default if no answer: yes (it is what #278/#279 chose
   for the second item).
2. **Start the check on the drop** — when the kind is recognised with high confidence, the run starts without a
   second click (one less step; a wrong file still costs a run). Default: start automatically, confirm when uncertain.
3. **« Mot de passe oublié »** — ship the reset flow now (shared with Folioviv through `@krizaka/auth`) or wait until
   sign-up really opens? Default: now; a closed sign-up still has people who forget.

---

## Appendix — captures

Base: `https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/`. Pattern:
`<state>/<screen>-<desktop|phone>-<dark|light>.png`. `audit.json` sits at the root with the per-page numbers.

<a id="captures"></a>

| Screen | Desktop dark | Desktop light | Phone dark | Phone light |
| :-- | :-- | :-- | :-- | :-- |
| Home (FR) | [home-fr-desktop-dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/home-fr-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/home-fr-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/home-fr-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/home-fr-phone-light.png) |
| Home (EN) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/home-en-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/home-en-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/home-en-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/home-en-phone-light.png) |
| Home — **first screen** (viewport only) | [home-fr first screen](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/home-fr-desktop-dark-first.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/home-fr-desktop-light-first.png) | [home-fr-phone first screen](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/home-fr-phone-dark-first.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/home-fr-phone-light-first.png) |
| Home — **signed in** (FR · EN) | [public-home-fr](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/public-home-fr-desktop-dark.png) · [public-home-en, signed in](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/public-home-en-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/public-home-en-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/public-home-en-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/public-home-en-phone-light.png) |
| Privacy · Download — signed in | [privacy](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/public-privacy-desktop-dark.png) · [download](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/public-download-desktop-dark.png) | same, `-light` | same, `-phone-dark` | same, `-phone-light` |
| Sign-in (FR) | [sign-in-desktop-dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/sign-in-fr-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/sign-in-fr-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/sign-in-fr-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/sign-in-fr-phone-light.png) |
| Sign-in, wrong password | [sign-in-error](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/sign-in-error-desktop-dark.png) | — | — | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/sign-in-error-phone-light.png) |
| Sign-up | [sign-up](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/sign-up-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/sign-up-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/sign-up-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/sign-up-phone-light.png) |
| Privacy · Terms · Download | [privacy](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/privacy-desktop-dark.png) · [terms](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/terms-desktop-dark.png) · [download](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/download-desktop-dark.png) | same, `-light` | same, `-phone-dark` | same, `-phone-light` |
| 404 | [not-found](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/not-found-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/not-found-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/not-found-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-out/not-found-phone-light.png) |
| Library (FR) | [library-desktop-dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/library-fr-desktop-dark.png) | [library-desktop-light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/library-fr-desktop-light.png) | [library-phone-dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/library-fr-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/library-fr-phone-light.png) |
| Library (EN) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/library-en-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/library-en-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/library-en-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/library-en-phone-light.png) |
| Account menu open · keyboard focus | [account-menu-open](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/account-menu-open-desktop-dark.png) · [keyboard-focus](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/keyboard-focus-desktop-dark.png) | — | — | [menu, phone](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/account-menu-open-phone-light.png) |
| Vérifier | [check-desktop-dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/check-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/check-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/check-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/check-phone-light.png) |
| Lots (batches) | [check-batches](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/check-batches-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/check-batches-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/check-batches-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/check-batches-phone-light.png) |
| Recherche (empty · results) | [search](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/search-desktop-dark.png) · [search-results](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/search-results-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/search-results-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/search-results-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/search-results-phone-light.png) |
| Collection | [collection-desktop-dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/collection-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/collection-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/collection-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/collection-phone-light.png) |
| Document — Informations | [document-infos](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-infos-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-infos-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-infos-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-infos-phone-light.png) |
| Document — Vérifications (lease, not run) | [document-verifications](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-verifications-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-verifications-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-verifications-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-verifications-phone-light.png) |
| Document — Fichier · Son texte | [fichier](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-fichier-desktop-dark.png) · [texte](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-texte-desktop-dark.png) | same, `-light` | same, `-phone-dark` | same, `-phone-light` |
| Document 2 — report (invoice, 8 rules) | [document-2-verifications](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-2-verifications-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-2-verifications-desktop-light.png) | [dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-2-verifications-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/document-2-verifications-phone-light.png) |
| Réglages — Profil | [settings-profile-desktop-dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/settings-profile-desktop-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/settings-profile-desktop-light.png) | [settings-profile-phone-dark](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/settings-profile-phone-dark.png) | [light](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/settings-profile-phone-light.png) |
| Réglages — Sécurité · Abonnement · Stockage · Mes données | [securite](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/settings-security-desktop-dark.png) · [settings-billing](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/settings-billing-desktop-dark.png) · [settings-storage](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/settings-storage-desktop-dark.png) · [donnees](https://krizaka-assets.b-cdn.net/pr-assets/verikora/ux-review-2026-10/signed-in/settings-data-desktop-dark.png) | same, `-light` | same, `-phone-dark` | same, `-phone-light` |

Audit numbers quoted in section 3 (horizontal overflow, `h1` counts, unnamed buttons, page heights) are in
`audit.json` at the same base.

## Errata (from the review of this document, 2026-10-23): these override the sections above
1. **Y1 and Y6:** `/app/verifier/lots` redirects to `/app/verifications?tab=lots` only once Y6 ships the Lots tab. Until then the old address keeps working.
2. **Y5:** existing document links (`/app/documents/<id>`) keep working. The new tabs (`/rapport`, `/document`, `/historique`) are sub-routes, and the bare address opens « Rapport ». A test covers the old links.
3. **Public copy (Y9):** no unconditional « hébergé au Canada ». The residency claim follows the storage choice (ADR-0007): Canadian by default, and the customer's own endpoint when they choose one. Say exactly that.
4. **Public copy (Y9):** don't promise an English report beyond what runs. Today the finding titles and explanations come from Sovkora unchanged, so « report in English » is claimed only for the parts that are translated, until verikora#247 ships.
5. **Labels (Y3, Y5, Y6):** never an unqualified « conforme ». The success chip says what was checked (« Aucun problème trouvé sur les règles vérifiées »), matching `needsAttention()`. A clean result is never a legal certificate.
6. **Y4:** when a recognised kind starts the run on the drop, the retention and photo-grouping choices are asked **before** the upload (a short step), never after. Otherwise the defaults apply and the user is told which.
