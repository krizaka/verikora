# Dossier de relecture juridique — Verikora

> Pour une avocate ou un avocat membre du Barreau du Québec. Ticket : krizaka-internal#3231.
> **Dépôt public : ce dossier ne contient que des faits tirés du code.** Chaque section nomme le ou les fichiers qu'elle décrit ;
> ce qui est écrit vient de ces fichiers à la date du 2026-11-13, pas de la mémoire. Quand le code ne répond pas, la ligne dit
> **ce qui manque** et **qui doit répondre**.

Verikora est un produit de Technologies Krizaka Inc. : on y dépose des documents (baux, contrats, factures) qui sont gardés,
lus, vérifiés et cherchés. Chaque analyse est un passage dans Sovkora, le moteur d'analyse de Krizaka (`AGENTS.md` § 2).
Verikora ne décide rien et ne donne pas d'avis juridique.

Deux parcours touchent des renseignements personnels de tiers :

- **le compte** (le gestionnaire ou le propriétaire, qui téléverse ses propres documents) ;
- **le dossier de candidature** (« applicant file » : un gestionnaire demande des documents à une personne candidate à un
  logement ; cette personne consent, téléverse, peut retirer son consentement et tout faire supprimer).

## Table des matières et correspondance avec le ticket #3231

| Exigence du ticket (« Done when ») | Où dans ce dossier |
| :--- | :--- |
| Texte et parcours du consentement de la personne candidate | § 1 |
| Liste par défaut des documents demandés (minimale ; revenu en téléversement volontaire ; guide de la CAI) | § 2 |
| Conservation et purge (et sauvegardes) | § 3 |
| Question de l'article 11 de la Loi 25 (modification du 2026-11-13) | § 3.4 et questions 9 à 11 |
| Évaluation des facteurs relatifs à la vie privée (EFVP), hébergement au Canada | § 4 |
| Ligne « moteur Sovkora » : lieu, conservation, entente intragroupe (modification) | § 4.3 |
| Ligne « fournisseur de modèle » : région et mandat (modification) | § 4.4 |
| Conditions d'utilisation et avis de confidentialité | § 5 |
| Ensemble de règles `qc-residential-lease` : ce qu'il lit, comment il cite le Code civil | § 6 |
| Les questions pour l'avocat, une par ligne | § 7 |
| Chaque élément avec le fichier du code qu'il décrit | « Fichiers » en tête de chaque section |

---

## 1. Le consentement de la personne candidate

**Fichiers**

- `apps/web/lib/applicant-consent.ts` : les finalités, la version de l'avis (`NOTICE_VERSION = "2026-10-30.1"`), l'inscription,
  le retrait et l'effacement du consentement.
- `apps/web/lib/applicant-file-rules.ts` : `CONSENT_PURPOSE` (les quatre finalités), les règles pures du lien.
- `apps/web/lib/screening.ts` : `consent()`, `share()`, `contest()`, `decline()`, `copyForTenant()`, `purgeExpired()`.
- `apps/web/messages/fr.json` et `en.json`, clés `applicant.notice.*`, `applicant.purpose.*`, `applicantFile.page.*` : les mots
  que la personne lit.
- `apps/web/components/applicant/ApplicantFile.tsx` : la page de la personne candidate.

**Ce que fait le code**

1. Le gestionnaire envoie un lien. Le lien est valable 14 jours (`REQUEST_VALID_DAYS`, `apps/web/lib/screening.ts`), peut être révoqué, ne sert qu'une fois
   pour l'envoi du dossier (`linkState`, `assertOpen`).
2. La personne voit l'avis (titre « Comment vos documents et renseignements sont utilisés ») avant tout : ce qui est recueilli,
   pourquoi, qui voit, combien de temps, comment demander la suppression, comment les documents sont examinés, ce qui n'est
   jamais demandé (NAS, carte ou compte bancaire, santé, famille).
3. **Quatre finalités, chacune consentie séparément** : `DOCUMENT_CHECK` (vérifier les documents envoyés), `COURT_RECORDS`
   (historique de location publié), `CREDIT` (rapport de crédit), `DOCUMENT_KEEP` (garder les documents jusqu'à la décision).
   Rien n'est lu ni vérifié avant le consentement (`requireConsent` est appelé dans les services, pas seulement dans une route :
   403 `CONSENT_REQUIRED`).
4. Le consentement enregistre : la finalité, **la version de l'avis montrée**, le moyen (`web-form`), la date, le prix des
   vérifications sous cette finalité et qui paie. Si l'avis a changé depuis que la personne l'a lu, le consentement est refusé
   (409 `NOTICE_CHANGED`). Chaque octroi est écrit au journal d'audit sans nom ni adresse.
5. La personne peut, à tout moment : retirer un consentement (les vérifications qui en dépendent s'arrêtent ; un résultat déjà
   détenu pour cette finalité est supprimé), **supprimer ses documents et le résultat** (« Supprimer mes documents » ; il ne reste
   qu'un enregistrement sans renseignement personnel), obtenir une copie de son résultat en texte (accès), le contester
   (commentaire de 500 caractères au plus ; le propriétaire voit seulement « contesté »), ou refuser la demande.
6. Le résultat n'est transmis au propriétaire que lorsque **la personne le partage** (`share`) ; avant, elle seule le voit.
7. Les mots « [À RELIRE PAR L'AVOCAT] » figurent encore dans l'avis aux rubriques « Qui le voit » et « Combien de temps »
   (`applicant.notice.who`, `applicant.notice.howLong`, `applicantFile.page.howLong`).

**À savoir**

- Les consentements des personnes candidates sont dans la table `application_consents`, qui n'est pas encore passée au module
  `@krizaka/privacy` (`AGENTS.md` § 4, « Consents… »).
- L'avis dit que le propriétaire « ne décide pas par une machine » : un rapport ne contient que des constats avec passage cité.

## 2. La liste par défaut des documents demandés

**Fichiers**

- `apps/web/lib/applicant-file-rules.ts` : `SEED_DOCUMENT_TYPES`, `SEED_FIELDS`, `NOT_NECESSARY_TYPES`, `requestedTypes`,
  `isRefusedField`, `MAX_DOCUMENTS_PER_FILE` (12).
- `apps/web/lib/config-seed.ts` (les types de documents sont des lignes de base de données, semées par code).

**Ce que le code demande par défaut aujourd'hui** (catalogue de départ, quatre types) :

| Type | Champs lus | Ce que le guide de la CAI et du TAL dit |
| :--- | :--- | :--- |
| `pay-stub` (talon de paie) | employeur, période de paie | Le propriétaire ne peut exiger ni l'emploi, ni l'employeur, ni l'ancienneté, ni le salaire. **Notre défaut diffère.** |
| `bank-statement` (relevé bancaire) | période du relevé | Pas dans la liste de ce qu'on peut demander ; on parle plutôt de preuves ciblées des habitudes de paiement. **Notre défaut diffère (à juger).** |
| `employment-letter` (lettre d'emploi) | employeur, poste, date d'entrée | Même point que le talon de paie. **Notre défaut diffère.** |
| `identity-document` (pièce d'identité téléversée) | nom complet | Le propriétaire peut la voir pour vérifier l'identité, mais ne peut ni la photocopier, ni la photographier, ni en garder une copie. **Notre défaut diffère : nous recevons et gardons un fichier.** |

**Ce que le code refuse de demander, quel que soit le catalogue** (`NOT_NECESSARY_TYPES`, 422 `TYPE_NOT_NECESSARY`) : NAS,
carte d'assurance maladie, passeport, permis de conduire, chèque annulé, coordonnées bancaires. Aucun champ de type NAS, santé,
passeport, permis ou compte bancaire n'est lu (`isRefusedField`).

**Ce que le code ne fait pas encore** : il n'existe pas de revenu « en téléversement volontaire » ni de catalogue minimal par
défaut ; le gestionnaire choisit ce qu'il demande parmi les quatre types, au moins un. Le défaut vit dans les lignes semées,
donc le changer est un changement de données et de code de semence, pas un déploiement d'une nouvelle fonction.

**Recommandation du CTO (2026-11-13), à trancher par l'avocat** : retirer la pièce d'identité du défaut ; garder l'employeur et le
relevé seulement si c'est jugé nécessaire ; présenter le revenu comme un téléversement volontaire (attestation de crédit, lettre
d'un ancien propriétaire, extraits du dossier de crédit : les exemples de la CAI et du TAL). Voir les questions 1 à 4.

**Sources** (lues par un outil de recherche, pas encore relues sur la page principale : à confirmer par l'avocat) :
CAI, « Le bail » <https://www.cai.gouv.qc.ca/questions-frequentes/le-bail/> ; TAL, « Bail et protection des renseignements
personnels » <https://www.tal.gouv.qc.ca/fr/signature-d-un-bail/bail-et-protection-des-renseignements-personnels>.

## 3. Conservation et purge

**Fichiers**

- `apps/web/lib/retention.ts` (`purgeDocument`, la tâche de balayage), `apps/web/lib/applicant-file-rules.ts` (`retentionOf`,
  `RetentionPolicy`), `apps/web/lib/deletion-receipt.ts` (le reçu de suppression), `apps/web/lib/screening.ts` (`purgeExpired`).
- `apps/web/lib/env.ts` : `APP_PURGE_AFTER_HOURS` (24 par défaut, entre 1 et 720).
- `apps/web/lib/migrations.ts` : politiques de conservation (lignes de données).
- Documents existants : [`docs/privacy/retention.md`](../privacy/retention.md), [`docs/DISASTER_RECOVERY.md`](../DISASTER_RECOVERY.md).

### 3.1 Par défaut : purger

| Quoi | Règle par défaut | Gardé plus longtemps seulement si |
| :--- | :--- | :--- |
| Un document (fichier et texte extrait) | purgé **dès que sa vérification est faite** ; jamais vérifié : après 24 h (réglage) | la personne choisit « conserver » (jour noté dans `documents.keep_consent_at`) |
| Document d'un dossier de candidature | purgé après la vérification | la personne a consenti à `DOCUMENT_KEEP` **et** le type permet « après la décision » : alors **jamais au-delà de la décision du gestionnaire** |
| Résultat de vérification d'une candidature et ce que les vérifications ont gardé | supprimé **30 jours** après le consentement (`RETENTION_DAYS`, règle `screening-result`) | jamais ; la personne peut l'effacer avant |
| Rapport, empreinte SHA-256 du fichier, certificat signé | **restent** après une purge (le rapport signé est la trace de la décision) | — |
| Journal d'audit (`audit.entry`) | aucune durée dans le code | à décider (question 12) |

Une purge écrit une ligne d'audit (`document.purged`, `screening.purged`) et un **reçu de suppression signé** : ce qui a été
supprimé (par empreintes), quand, sous quelle règle (après la vérification, après le délai, à la décision, un an après, à la
demande de la personne) ; sans nom, adresse ni nom de fichier.

### 3.2 Sauvegardes

- Les sauvegardes du fournisseur de base de données gardent une copie jusqu'à leur propre rotation ; une restauration peut
  ramener un fichier purgé tant que la purge n'a pas repassé (`docs/privacy/retention.md`). La durée est celle du fournisseur
  (réponse attendue : DigitalOcean, via la page des sauvegardes du service géré — personne responsable de l'infrastructure).
- Notre copie nocturne (`deploy/backup`, `docs/DISASTER_RECOVERY.md`) : chiffrée avant de quitter le serveur (clé publique age,
  clé privée hors ligne), stockée au Canada, **30 jours** (les 7 plus récentes toujours gardées), **sans octets de documents**
  mais avec les métadonnées et le texte extrait. Après toute restauration, on repasse la purge avant de rouvrir le service.
- L'avis de confidentialité dit déjà : « Ce qui est purgé peut rester dans les sauvegardes jusqu'à leur rotation. »

### 3.3 Où vit un document gardé

Voir § 4.2 : base de données à Toronto ; stockage de fichiers chiffré avant l'envoi.

### 3.4 La question de l'article 11 (Loi 25)

- Le texte (LégisQuébec, <https://www.legisquebec.gouv.qc.ca/fr/version/lc/P-39.1?code=se:11>, à confirmer par l'avocat) : les
  renseignements utilisés pour prendre une décision au sujet d'une personne sont conservés **au moins un an** après la décision.
- Notre règle : **purger par défaut** et « jamais au-delà de la décision ». C'est en tension avec ce minimum d'un an si le
  gestionnaire de dossier est tenu de le respecter pour un dossier de candidature.
- Ce que le code offre déjà, **sans changer le défaut** : à la fermeture d'un dossier, le gestionnaire peut choisir la classe
  `one-year-after-decision` (ligne de politique, `purge_on = after-decision-days`, au moins 365 jours, jamais moins ; seuls les
  documents que la politique en vigueur laisse garder après la vérification sont prolongés). Fichiers : `docs/privacy/retention.md`
  § « One year after the decision », `apps/web/lib/applicant-file.integration.test.ts`.
- L'avis dit cela en toutes lettres (`applicant.notice.howLong`).
- **À décider par l'avocat** : qui porte l'obligation (Verikora, qui ne décide rien, ou le gestionnaire qui décide) ; si le rapport
  signé et l'empreinte suffisent comme « renseignements utilisés » ; quelle durée par défaut en découle. **Tant que l'avocat n'a pas
  répondu, « purger par défaut » reste.** Question 9, 10 et 11.

## 4. L'évaluation des facteurs relatifs à la vie privée (EFVP)

**Fichiers**

- [`docs/privacy/efvp.md`](../privacy/efvp.md) : la carte des données, les risques, la revue (**non faite** : « à consigner »).
- [`docs/privacy/transfers.md`](../privacy/transfers.md) et [`docs/privacy/transfers.json`](../privacy/transfers.json) : le registre des
  communications hors Québec (article 17), vérifié par `scripts/privacy-register.test.mjs`.
- [`docs/privacy/production-store-canada.md`](../privacy/production-store-canada.md) : le stockage de production au Canada.
- `deploy/digitalocean/dev.app.yaml` (le déploiement), `apps/web/lib/env.ts` (la configuration, dont `productionProblems`).

> Note : `docs/privacy/efvp.md` a été écrit avant plusieurs changements (modules `@krizaka/privacy`, `@krizaka/audit`, `@krizaka/credits`,
> journal `audit.entry`). Sa carte des données doit être remise à jour avant la signature de l'EFVP (travail du CTO, avant l'envoi à l'avocat de la version finale).

### 4.1 Application et base de données

- L'application tourne sur DigitalOcean App Platform, région `tor` (Toronto). La base PostgreSQL gérée est à Toronto
  (cluster `krizaka-dev-pg`) : **dans le Canada, hors Québec** (article 17 s'applique).
- Mesures vues dans le code : certificat du serveur vérifié (`DATABASE_CA_CERT`), mots de passe, jetons de session et secrets
  d'API stockés en empreintes, administration limitée à une liste d'adresses (`AUTH_ALLOWED_IPS`, vide en production = personne),
  serveur de production qui refuse de démarrer sans ses secrets.

### 4.2 Stockage des fichiers gardés

- Les fichiers gardés passent par `@krizaka/storage` (`apps/web/lib/storage/adapter.ts`), chiffrés (AES-256-GCM) **avant** de
  quitter le serveur : le fournisseur ne détient que du texte chiffré. Liens signés de 15 minutes au plus.
- **Production** : DigitalOcean Spaces `tor1` (Toronto). Le code refuse en production un fournisseur dont la région n'a pas été
  testée et trouvée canadienne (409 `STORAGE_NOT_IN_CANADA`) et refuse Bunny (`productionProblems`).
- **Développement** : le fichier de déploiement importe encore Bunny (New York ; `MEDIA_DOCUMENTS_PROVIDER` = `bunny`,
  `deploy/digitalocean/dev.app.yaml`), données fictives seulement. **La décision du fondateur du 2026-11-13 (ticket #3424) fait de
  la zone privée de Toronto le stockage par défaut sur dev, avant tout vrai dossier pilote** ; elle se fait par l'écran
  d'administration (registre de fournisseurs), pas par le code : l'état réel de l'écran est à confirmer à la fermeture de #3424.
  Tant qu'il n'est pas confirmé, la page de confidentialité dit encore « un stockage de développement aux États-Unis, prévu pour
  des données fictives ».
- Un fichier supprimé garde 30 jours une version antérieure dans le seau (versionnement, règle de cycle de vie) : à divulguer dans
  l'avis (`production-store-canada.md` § 4).
- Le cloud personnel (Dropbox, Google Drive, OneDrive), si la personne le connecte : lieu choisi par la personne, la clé de
  renouvellement scellée reste chez nous.

### 4.3 Ligne « moteur Sovkora » (où il traite un document)

Ce que le code et la documentation de Sovkora établissent :

| Point | Fait | Source |
| :--- | :--- | :--- |
| Ce qui part de Verikora | **le texte** du document (couche de texte ; pour une photo, le texte reconnu localement) et le type, la juridiction, la date ; le numéro d'exécution revient et est gardé | `apps/web/lib/sovkora.ts` (seul client), `AGENTS.md` § 2 |
| Appel | HTTPS, `AI_API_URL` = `https://dev.sovkora.com/edge`, clé de service `oz_…` (secret DigitalOcean) | `apps/web/lib/env.ts`, `AGENTS.md` § 2 |
| Lieu de traitement, développement | DigitalOcean App Platform, projet `sovkora-dev`, Toronto | Sovkora `docs/DEPLOY_DEV.md` |
| Lieu de traitement, production | VPC de production `tor1` (Toronto), courtier de messages dans ce VPC ; hôte `api.sovkora.com` | Sovkora `docs/DEPLOY_PROD.md` |
| Classe de données | pack `document-validation` déclaré `regulatoryClass: SENSITIVE` : durée de conservation raccourcie, audit sans détail, garde de périmètre (refuse de donner un conseil juridique) | Sovkora `packs/document-validation/pack.yaml` |
| Conservation des exécutions | `retention.sensitive-run-days` = **30 jours** par défaut (une installation peut la baisser, jamais la monter) ; le répertoire d'un travail SENSITIVE est supprimé, puis sa ligne, à l'état terminal ; un test (Sovkora #693) vérifie qu'aucun texte de document ne reste dans une table ou un journal après la fin d'une exécution | Sovkora `infra/migrations/2026-09-06-sensitive-controls.sql`, `ProtectedJobRetentionIT` |
| Entente intragroupe Verikora ↔ Sovkora | **n'existe pas encore** (« à écrire » dans `transfers.md`) | `docs/privacy/transfers.md` |

À obtenir, avec qui répond :

1. L'entente écrite entre Technologies Krizaka Inc. (Verikora) et le moteur Sovkora (mandat, finalité, mesures de sécurité,
   avis d'incident, retour ou destruction) : **le CTO la rédige, l'avocat la relit** (question 6).
2. Le lieu exact de traitement **en production** au moment de l'ouverture (le VPC `tor1` est décrit, mais Sovkora n'est pas
   encore déployé en production publique) : **la voie Sovkora confirme**, par une ligne dans `transfers.json`.
3. Que le texte envoyé au moteur n'est jamais écrit dans un journal : preuve par le test #693 ; **la voie Sovkora la renouvelle à
   chaque version du pack**.

### 4.4 Ligne « fournisseur de modèle » (région et mandat)

- Verikora n'appelle jamais de modèle (`AGENTS.md` § 2). C'est le moteur Sovkora qui, **pour les seules questions de jugement**,
  appelle un modèle par une étape de plan : les règles `QC-LEASE-010` et `QC-LEASE-011` (questions consultatives), et le choix du
  type de document en cas d'égalité (Sovkora `packs/document-validation/README.md` : « Deterministic first, model second »). La
  vérification d'authenticité d'un PDF n'appelle **aucun** modèle. Les autres règles du bail sont déterministes.
- Fournisseur configuré en développement : **DigitalOcean serverless inference** (`https://inference.do-ai.run`, compatible OpenAI),
  modèle de discussion par défaut `mistral-3-14B`, clé détenue comme secret `AI_INFERENCE_KEY` (Sovkora `docs/DEPLOY_DEV.md`,
  § « Routing is data »). Le routage est une donnée (`infra/deploy/dev-data.sql`) : le fournisseur peut changer sans déploiement.
- Le rapport signé dit « Modèle : choisi par le Studio, non rapporté par l'exécution : le Studio et sa version sont la trace »
  (`report.modelValue`).
- Ce que ni le code ni la documentation ne permettent d'écrire, et **qui répond** :
  - la **région** où DigitalOcean exécute l'inférence : **le CTO** la demande par écrit à DigitalOcean (le code ne la porte pas) ;
  - le **mandat** (finalité limitée, pas d'entraînement sur les textes, durée de conservation côté fournisseur) : **le CTO** relève
    les conditions de DigitalOcean ; **l'avocat** dit si elles suffisent (articles 17 et 18.3) ;
  - le fournisseur choisi pour la production (la spécification de production de Sovkora n'embarque pas la route de discussion de développement) : **la voie Sovkora** précise lequel avant l'ouverture.
  - La page de confidentialité affirme « jamais utilisés pour entraîner un modèle » : cette phrase n'est vraie que si le mandat du
    fournisseur de modèle le garantit (question 7).

### 4.5 Autres fournisseurs (registre `transfers.json`)

| Id | Quoi | Fournisseur | Lieu | Hors Canada |
| :--- | :--- | :--- | :--- | :--- |
| `database` | comptes, enregistrements, analyses, audit, dossiers | DigitalOcean PostgreSQL | Toronto | non |
| `documents-s3` | fichiers gardés (production) | DigitalOcean Spaces | Toronto `tor1` | non |
| `documents-bunny` | fichiers gardés en développement, fictifs | Bunny Storage (+ CDN) | New York | oui |
| `documents-user-cloud` | documents que la personne choisit de garder chez elle | Dropbox, Google, Microsoft | choix de la personne | oui (hors de notre contrôle) |
| `mail` | adresse et message des courriels de confirmation | Mailgun | `api.mailgun.net` ; localisation des serveurs : **à obtenir du contrat Mailgun (le CTO)** | à confirmer |
| `payments` | courriel du compte, forfait, événements de paiement | Stripe | **à obtenir du contrat Stripe (le CTO)** | à confirmer |
| `engine` | texte du document, numéro d'exécution | Sovkora | Toronto (§ 4.3) | non |

Les ententes écrites (articles 17 et 18.3) avec DigitalOcean, Mailgun et Stripe sont « à lier et à relire » dans `transfers.md` ;
les copies signées restent dans le dossier privé de l'entreprise, jamais dans git.

## 5. Conditions d'utilisation et avis de confidentialité

**Fichiers**

| Page publique | Fichier de la page | Texte |
| :--- | :--- | :--- |
| `/terms` (conditions) | `apps/web/app/[locale]/terms/page.tsx` ; version `TERMS_VERSION = "2026-10-27-draft"` (`apps/web/lib/signup.ts`) | `apps/web/messages/fr.json` (clé `terms`, le français fait foi) et `en.json` |
| `/privacy` (confidentialité) | `apps/web/app/[locale]/privacy/page.tsx` ; date `PRIVACY_UPDATED = "2026-11-13"` (`apps/web/lib/site.ts`) | clé `privacy` des mêmes fichiers |
| Avis de la personne candidate | voir § 1 | `applicant.notice` |

**Conditions** : la page porte `data-lawyer-review="pending"` et un bandeau « rédigée de bonne foi, en attente de relecture par
l'avocat ; la politique de remboursement d'un audit à l'unité n'est pas définitive ». Sections : ce qu'est Verikora (vérification
informative, pas un avis juridique), le compte (un audit gratuit par compte), prix et taxes (TPS/TVQ, Stripe), remboursements
(**ébauche**), vos documents, propriété intellectuelle, usages interdits, marques, limitation de responsabilité (12 mois de
sommes payées ; exclusions des art. 1474 C.c.Q. et 10 L.p.c. ; art. 1435 à 1437 C.c.Q.), droit applicable (Montréal ; art. 3149
C.c.Q. et 33 C.p.c.), langue (art. 55 de la Charte).

**Confidentialité** : responsable nommé en tête de page (le titre seulement : « Président, Technologies Krizaka Inc. » ; le
courriel du responsable est la seule adresse publique permise, `PRIVACY_OFFICER_EMAIL`). Sections : qui est responsable, ce que
nous recueillons, où c'est gardé, qui traite, combien de temps, dossiers de candidature, reçu de suppression, hors du Québec,
aucune décision par une machine seule (art. 12.1), vos droits, incidents, nous joindre.

**Écarts que le code laisse voir** (à corriger ou à trancher) :

- La section « où » dit que le stockage de développement est aux États-Unis ; la décision #3424 (§ 4.2) la rendra fausse une fois
  appliquée : le texte doit suivre l'état réel.
- La section « hors du Québec » dit que le lieu de traitement de Sovkora « n'est pas encore indiqué dans notre registre des
  transferts » : à mettre à jour dès que § 4.3, point 2, est confirmé.
- La section « conservation » ne parle pas de la version antérieure de 30 jours dans le seau (§ 4.2).
- L'EFVP exigée avant une communication hors Québec est « en préparation » (c'est ce dossier).

## 6. L'ensemble de règles `qc-residential-lease`

**Fichiers** (dépôt Sovkora, `packs/document-validation/rulesets/qc-residential-lease/`)

- `2024-02-21.json` : l'ensemble (révision 5, `reviewStatus: TO_REVIEW_BY_LAWYER`).
- `SOURCES.md` : les sources et leurs licences (vérification du 2026-11-12).
- `packs/document-validation/README.md` : le fonctionnement du pack ; `studios/compliance-check`.
- Côté Verikora : `apps/web/lib/sovkora.ts` (l'appel), `packages/core` `reportOf` (le rapport tel que rendu), le PDF signé
  (`apps/web/lib/pdf-layout.ts`).

**Ce qu'il lit** : le **texte** d'un bail de logement résidentiel au Québec (couche de texte du PDF), à une date d'application
(`asOf`), contre 16 règles. Une règle est un enregistrement (identifiant, gravité, verdict, extrait, explication), jamais de la
prose. Verdicts : exigence respectée, non respectée, preuve insuffisante, non applicable.

**Comment il cite le Code civil** : chaque règle porte son article ; le rapport montre l'article cité et le passage du
document. Les citations renvoient par numéro d'article, sans reproduire le texte de la loi.

| Règle | Article cité | Objet |
| :--- | :--- | :--- |
| QC-LEASE-001, 002 | C.c.Q. 1895 ; règlement T-15.01, r. 3 | identification du locateur et du locataire |
| 003 | 1855, 1903 | montant du loyer |
| 004 | 1904 al. 1 | dépôt de garantie interdit (premier mois seulement) |
| 005 | 1904 al. 2 | chèques postdatés interdits |
| 006 | 1899 | refus des enfants, sans effet |
| 007 | 1936, 1893 | renonciation au maintien dans les lieux, sans effet |
| 008 | 1896 ; règlement | avis du loyer le plus bas des douze derniers mois |
| 009 | 1942, 1943, 1945, 1893 | renonciation anticipée aux règles d'augmentation, sans effet |
| 010 | 1901 | peines et frais de retard (**question au modèle, consultative**) |
| 011 | 1894 | règlement d'immeuble remis avant la conclusion (**question au modèle, consultative**) |
| 012 | 1901, 1931 et s. | visites et hébergement d'un tiers |
| 013 | 1971, 1893 | résiliation de plein droit pour un seul retard |
| 014 | 1895 ; règlement | mention du formulaire obligatoire |
| 020 | 1901 | clause abusive (consultative) |
| QC-LANG-001 | Charte de la langue française, art. 55 ; C.c.Q. 1897 | langue française (informative : jamais un échec pour cette seule raison) |

(Identifiants complets : `QC-LEASE-001` à `QC-LEASE-014`, `QC-LEASE-020` et `QC-LANG-001`, soit 16 règles. Gravités : BLOCKING, MAJOR ou ADVISORY, lues dans le fichier JSON.)

**Garde-fous** : le rapport n'est montré que si chaque passage cité est dans le document et sans mot de verdict refusé
(« fraude », « falsifié »…) ; le pack refuse de répondre à une demande de conseil juridique (`scopeGuard`) ; le rapport signé
porte « Vérification informative, ce n'est pas un avis juridique » et ne dit jamais « conforme » comme une garantie
(`AGENTS.md` § 4, `report.disclaimer`, `report.guarantees`, `report.notGuaranteed`). Le rapport dit aussi ce qu'il n'a pas vérifié
(droit de résiliation, art. 2125 C.c.Q. et suivants sur les contrats de service : `report.notCheckedServiceContract`).

**Ce qui est encore ouvert, par le fichier lui-même** : l'ensemble est marqué « à faire relire par un avocat avant tout usage
autre que la démonstration » ; les délais de l'avis de modification et la mention de la section F du bail obligatoire **ne sont pas
encodés** (texte non vérifié à la source) ; `SOURCES.md` pose six questions sur les licences des sources (question 14).

## 7. Questions pour l'avocat

Une par ligne. Entre crochets : la section où se trouvent les faits.

**Documents demandés (§ 2)**

1. Le catalogue par défaut peut-il demander un talon de paie, avec le nom de l'employeur, alors que le guide de la CAI et du TAL
   dit que le propriétaire ne peut exiger ni l'emploi, ni l'employeur, ni le salaire ? Sinon, le talon et la lettre d'emploi
   doivent-ils n'exister que comme téléversement volontaire du revenu ?
2. Un relevé bancaire peut-il être demandé par défaut, ou seulement offert comme preuve ciblée des habitudes de paiement choisie
   par la personne ?
3. Notre outil peut-il recevoir et garder (même purgé après la vérification) un fichier de pièce d'identité, alors que la CAI dit
   que le propriétaire peut la voir mais ne peut ni la copier, ni la photographier, ni en garder une copie ? Retirer cette pièce du
   défaut suffit-il ?
4. Quelle liste par défaut recommandez-vous (identité, habitudes de paiement, revenu volontaire) et quels mots doit employer
   l'écran qui la propose au gestionnaire pour ne pas l'inciter à demander plus que ce qui est permis ?

**Consentement (§ 1)**

5. Le consentement par finalité (quatre cases, version de l'avis, date, moyen) respecte-t-il l'article 14 de la Loi (manifeste,
   libre, éclairé, distinct) ? Les deux mentions « à relire » (« Qui le voit », « Combien de temps ») disent-elles ce qu'il faut ?

**Hébergement, transferts, fournisseurs (§ 4)**

6. Une entente intragroupe entre Technologies Krizaka Inc. (Verikora) et le moteur Sovkora suffit-elle comme entente écrite des
   articles 17 et 18.3, et que doit-elle contenir ?
7. Les conditions de DigitalOcean (inférence, hébergement, stockage), de Mailgun et de Stripe suffisent-elles comme mandat écrit
   (articles 17 et 18.3) ? Peut-on écrire « jamais utilisés pour entraîner un modèle » sans garantie écrite du fournisseur du modèle ?
8. Un point de présence CDN hors du Canada est-il une communication hors du Québec ? Toronto, hors Québec, impose-t-il l'EFVP de
   l'article 17 pour la base, les fichiers et le moteur, et le dossier actuel (EFVP + registre) la satisfait-il ? Qui, au sein de
   Technologies Krizaka Inc., signe comme responsable de la protection des renseignements personnels et à quelle date ?

**Conservation et article 11 (§ 3)**

9. L'article 11 de la Loi (conserver au moins un an les renseignements utilisés pour décider d'une personne) s'applique-t-il à
   Verikora, qui ne décide rien, ou au gestionnaire qui décide ?
10. Le rapport signé et l'empreinte du fichier (conservés après la purge) suffisent-ils comme « renseignements utilisés » ? Sinon,
    que faut-il garder et pour qui ?
11. Quelle conservation par défaut en découle pour un dossier de candidature (purger à la décision, un an après la décision, ou
    laisser le gestionnaire choisir) ? Tant que vous n'avez pas répondu, « purger par défaut » reste.
12. Quelle durée de conservation pour le journal d'audit et les événements de pré-vérification (aucune durée n'est écrite) ?
13. Que doit dire l'avis sur les sauvegardes (rotation du fournisseur, notre copie de 30 jours, la version de 30 jours dans le
    seau) pour que « purgé » ne soit pas trompeur ?

**Règles et conditions (§ 5 et 6)**

14. Les citations et les extraits de la loi dans les rapports sont-ils permis, étant donné les conditions de LégisQuébec et la
    licence CC BY-NC-ND des données ouvertes (`SOURCES.md`, Q1 à Q6) ? Que doit dire un rapport sur la valeur non officielle d'une
    codification administrative ?
15. L'ensemble `qc-residential-lease` (révision 5) peut-il quitter la mention « à faire relire » ? Quelles règles retirer, nuancer
    ou ajouter, notamment les délais de l'avis de modification et la section F du bail obligatoire ?
16. La formule « Vérification informative, ce n'est pas un avis juridique » et la garde de périmètre du moteur suffisent-elles à
    ne pas exercer la profession d'avocat (Loi sur le Barreau) ?
17. Les conditions d'utilisation (limitation de responsabilité de 12 mois, droit applicable, usages interdits, langue) sont-elles
    valides pour un contrat d'adhésion et pour un consommateur ? Quelle politique de remboursement d'un audit à l'unité ?
18. Le texte « aucune décision par une machine seule » (article 12.1) est-il exact pour un rapport qui pourrait, dans les faits,
    guider un refus de location ?

## Hors périmètre de ce dossier

Choisir et payer l'avocat est une étape du fondateur, séparée. Ce dossier s'arrête à « le dossier est prêt ». Aucune mention de
personne, d'adresse ou de numéro personnel ne figure ici.
