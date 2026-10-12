# Job Radar — Analyse V1 (réponse à la section 45 du README)

> Rédigé le 28/09/2026. Aucune ligne de code n'a encore été écrite.
> Les informations sur les sources ont été vérifiées sur le web à cette date (liens en fin de document).
> Tout ce qui est marqué **À CONFIRMER** doit être vérifié dans le portail officiel au moment de l'inscription.

---

## 1. Contraintes retenues (résumé du README)

| Domaine | Règle |
|---|---|
| Contrat | CDI prioritaire, les autres sont stockés mais pénalisés / masqués du flux principal |
| Expérience | Cible 1–3 ans ; 5+ ans forte pénalité ; 8+ ans ≈ incompatible ; règle configurable |
| Salaire | Cible et minimum réglables dans le profil ; absent = neutre ; **jamais inventé** |
| Lieu | Oise + Paris ; le trajet porte-à-porte compte, calculé à part du score technique |
| Score | 6 sous-scores 0–100, poids configurables, **calcul déterministe** ; le LLM explique, il ne note pas |
| LLM | Ne lit que les offres déjà filtrées/scorées ; n'écrit jamais en base ; résultats en cache |
| Sources | Uniquement accès officiels/autorisés ; sinon `SOURCE_UNAVAILABLE` ; une source en panne ne bloque pas les autres |
| Fréquence | ~5 min visé, mais fréquence propre à chaque source + backoff en cas d'erreur |
| Notifications | Navigateur + email en V1 ; jamais deux fois pour la même offre |
| Données inconnues | `null` / `unknown`, jamais devinées |
| Sécurité | Appli privée, authentification, secrets dans `.env`, point de départ du trajet privé |

---

## 2. Sources : ce qui est réellement accessible

### 2.1 Utilisables en V1

| Source | Statut | Accès | Limites connues | Remarques |
|---|---|---|---|---|
| **France Travail – API Offres d'emploi v2** | ✅ **Source n°1** | Gratuit, inscription sur francetravail.io, OAuth2 « client credentials » | 10 appels/s annoncés sur data.gouv (**À CONFIRMER** dans le portail) ; 150 offres max par page, ~1 150 max par requête | Champs utiles : intitulé, entreprise, contrat, expérience exigée, salaire (texte libre), lieu avec lat/long (souvent le **centre de la commune**, pas l'adresse), date de création, URL d'origine pour les offres partenaires. Filtres : mots-clés, département, commune+distance, type de contrat, date min de création. |
| **Adzuna API** | ✅ Source n°2 possible | Clé gratuite après inscription ; usage « recherche personnelle » autorisé | **25 appels/min, 250/jour, 2 500/mois** | Description **tronquée** ; lat/long fournis ; le salaire peut être une **estimation Adzuna** (`salary_is_predicted`) → à traiter comme *non communiqué* pour respecter « ne jamais inventer un salaire ». Mention « Jobs by Adzuna » obligatoire à l'affichage. Couverture France (`fr`) **À CONFIRMER** au premier appel. |
| **Sites carrières d'entreprises via leur ATS** (Greenhouse, Lever, Ashby, Recruitee, Workable, Personio) | ✅ Source n°3 | Points d'accès publics documentés, sans clé | Non documentées → on reste prudent (1 appel / entreprise / 30 min) | Il faut une **liste d'entreprises cibles** (à remplir à la main dans l'interface). Très utile pour des boîtes précises en Oise/Paris. |

### 2.2 Non intégrables proprement → `SOURCE_UNAVAILABLE`

| Source | Pourquoi |
|---|---|
| **LinkedIn** | L'API « Job Posting » sert à *publier* des offres, réservée aux partenaires ATS. Aucune API de recherche d'offres pour un particulier. |
| **Indeed** | L'API Publisher / Job Search est fermée aux nouveaux développeurs. Les seules API restantes servent aux employeurs/partenaires. |
| **Welcome to the Jungle** | L'API (Welcome Kit) donne accès aux offres **de sa propre organisation**, avec une clé employeur. Pas de recherche globale. |
| **HelloWork** | Le flux JSON proposé est celui du **recruteur pour ses propres offres**. Pas d'API candidat. |
| **Free-Work** | Aucune API publique trouvée. |
| **Services tiers qui revendent LinkedIn/Indeed/HelloWork** (Apify, RolesAPI, JobsPipe…) | Ils reposent sur du scraping de ces sites → contraire aux sections 7 et 36 du README. **Exclus.** |

### 2.3 Cas particuliers

| Source | Statut |
|---|---|
| **La Bonne Boîte v2** | Accessible (même inscription France Travail, 2 appels/s) mais elle donne des **entreprises susceptibles d'embaucher**, pas des offres. → Pas un connecteur d'offres. Idée pour plus tard : un onglet « candidatures spontanées » (phase 5). |
| **Jooble** | Clé délivrée sur formulaire, destinée aux propriétaires de sites. Obtention incertaine pour un usage privé → à demander, non bloquant. |
| **Indeed via Claude** | Un connecteur Indeed existe dans Claude (Cowork). Il ne peut pas être appelé par l'application, mais peut servir **à la main** pour compléter une recherche ponctuelle. |

### 2.4 Services pour le trajet

| Besoin | Service | Statut |
|---|---|---|
| Adresse → coordonnées | **API Géoplateforme – Géocodage** (`data.geopf.fr/geocodage`) | ✅ Gratuit, sans clé, 50 requêtes/s par IP |
| Temps de trajet en transports | **PRIM Île-de-France Mobilités** (moteur Navitia) | ✅ Gratuit avec compte ; nouveaux comptes : **5 appels/s, 1 000/jour** ; couvre les réseaux d'Île-de-France. Les trajets depuis/vers l'Oise (TER Hauts-de-France, bus Oise) ne sont **pas garantis** → **À TESTER** avec le vrai point de départ. |
| Alternative si PRIM ne couvre pas l'Oise | navitia.io (Hove) ou un calculateur auto-hébergé nourri par les données GTFS de transport.data.gouv.fr | Phase 5, **À CONFIRMER** |

**Conséquence :** le trajet sera calculé par commune de destination (mise en cache), avec un indicateur de précision (`address` / `city_centroid` / `unknown`). Si rien n'est calculable → `travelTime = null`, sous-score transport neutre.

---

## 3. Faisable immédiatement en V1

- Collecte France Travail (plusieurs recherches : Vue.js, Java Spring, React TypeScript, Node.js, Full Stack, .NET) sur Oise (60) + Paris (75) + départements proches configurables.
- Normalisation, déduplication, historique des états.
- Score déterministe complet sauf transport (neutre tant que le trajet n'est pas branché).
- Dashboard, page détail, filtres, bouton Actualiser.
- Planificateur par source, notifications email + navigateur.
- Adzuna et sites carrières en 2ᵉ/3ᵉ source dès la phase 3.

---

## 4. Architecture proposée

```text
┌──────────────┐   REST (JSON)   ┌───────────────────────────────┐
│  apps/web    │ ───────────────▶ │  apps/api  (Fastify + Zod)    │
│  Vue 3 + TS  │ ◀─────────────── │  auth · profil · jobs · refresh│
│  Vite · PWA  │   Web Push       └──────────────┬────────────────┘
└──────────────┘                                 │ ajoute des tâches
                                                 ▼
                                   ┌──────────────────────────────┐
                                   │ Redis + BullMQ (file d'attente)│
                                   └──────────────┬───────────────┘
                                                  ▼
                                   ┌──────────────────────────────┐
                                   │ apps/worker                   │
                                   │ collect → normalize → dedup   │
                                   │ → score → (LLM) → notify      │
                                   └──────────────┬───────────────┘
                                                  ▼
                                          PostgreSQL (Prisma)
```

### Choix techniques et raisons

| Choix | Raison |
|---|---|
| **Fastify** plutôt que NestJS | Plus léger, TypeScript natif, validation rapide ; suffisant pour un projet solo. Un seul framework backend. |
| **Zod** | Un seul schéma pour valider les entrées de l'API, le profil et la sortie du LLM. Partagé front/back via `packages/shared`. |
| **Prisma + PostgreSQL** | Imposés par le README. |
| **BullMQ + Redis** | Donne gratuitement : une fréquence par source, le verrou « un seul refresh à la fois », les réessais avec backoff. |
| **Worker séparé** | La collecte ne ralentit pas l'API ; un plantage de collecte ne coupe pas le site. Même code, autre point d'entrée. |
| **pnpm workspaces** | Monorepo simple, sans outil supplémentaire. |
| **Vitest** | Tests unitaires pour le front et le back avec le même outil. |
| **Nodemailer** (SMTP) + **web-push** (VAPID) | Les deux canaux V1 ; interface `Notifier` pour ajouter Discord/Telegram plus tard. |
| **LLM derrière une interface** `AiAnalyzer` | Pas de dépendance à un seul fournisseur ; sortie validée par Zod ; cache par empreinte du texte de l'offre. |
| Auth : un seul utilisateur, mot de passe haché (argon2), cookie de session `httpOnly` | Appli privée ; pas besoin d'un système de comptes complet. |

### Pipeline d'une collecte

```text
1. SourceScheduler : la source est-elle due ? (nextRunAt, backoff)
2. Connector.search() pour chaque recherche du profil → RawJob[]
3. Normalizer → Job normalisé (champs inconnus = null)
4. Dedup → rattache à une offre existante ou en crée une (JobSourceLink)
5. Si nouvelle ou modifiée (hash du contenu) :
     scoring déterministe (version des règles enregistrée)
6. Si score ≥ seuil d'analyse : analyse LLM (cache par hash)
7. Si score ≥ seuil de notif ET jamais notifiée : notification
8. Enregistrement du SourceRun (statut, durée, nb offres, erreur)
```

---

## 5. Schéma PostgreSQL (Prisma)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
  profile      Profile?
  sessions     Session[]
  pushSubs     PushSubscription[]
}

model Session {
  id        String   @id            // jeton aléatoire
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
}

model Profile {
  id                  String  @id @default(cuid())
  userId              String  @unique
  user                User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  contracts           String[]          // ["CDI"]
  experienceMin       Int
  experienceMax       Int
  salaryTarget        Int?
  salaryMinimum       Int?
  locations           Json              // [{label:"Oise", dept:"60"}, {label:"Paris", dept:"75"}]
  preferredTechs      Json              // [{name:"Vue.js", weight:1.0}, ...]
  searches            Json              // ["Développeur Vue.js", ...]
  scoringWeights      Json              // {technical:0.35, experience:0.20, ...}
  scoringRules        Json              // seuils expérience/salaire configurables
  homeLat             Float?            // point de départ privé
  homeLng             Float?
  homeLabel           String?
  minScoreForAnalysis Int     @default(55)
  minScoreForNotif    Int     @default(70)
  updatedAt           DateTime @updatedAt
}

enum RemoteType { remote hybrid onsite unknown }
enum JobStatus  { NEW SEEN SAVED APPLIED REJECTED EXPIRED IGNORED }
enum LocationPrecision { address city_centroid unknown }

model Job {
  id               String   @id @default(cuid())
  fingerprint      String   @unique   // entreprise+titre+ville normalisés
  contentHash      String             // pour savoir si l'offre a changé
  title            String
  company          String?
  description      String
  contractType     String?
  experienceText   String?
  experienceMinYrs Int?
  experienceMaxYrs Int?
  salaryMin        Int?
  salaryMax        Int?
  salaryPeriod     String?
  salaryText       String?
  city             String?
  postalCode       String?
  department       String?
  address          String?
  latitude         Float?
  longitude        Float?
  locationPrecision LocationPrecision @default(unknown)
  remoteType       RemoteType @default(unknown)
  technologies     String[]           // telles qu'écrites dans l'annonce
  publishedAt      DateTime?
  firstSeenAt      DateTime @default(now())
  lastSeenAt       DateTime @default(now())
  status           JobStatus @default(NEW)
  notifiedAt       DateTime?          // garde-fou anti double notification
  sources          JobSourceLink[]
  scores           JobScore[]
  analyses         JobAnalysis[]
  events           JobEvent[]
  travel           TravelEstimate?
  @@index([status, lastSeenAt])
  @@index([department])
}

model JobSourceLink {
  id           String   @id @default(cuid())
  jobId        String
  job          Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  source       String             // "france-travail", "adzuna", "ats:greenhouse:acme"
  sourceJobId  String
  sourceUrl    String
  canonicalUrl String?
  rawData      Json?
  firstSeenAt  DateTime @default(now())
  lastSeenAt   DateTime @default(now())
  @@unique([source, sourceJobId])
  @@index([canonicalUrl])
}

model JobScore {
  id            String   @id @default(cuid())
  jobId         String
  job           Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  rulesVersion  String             // change uniquement si les règles changent
  profileHash   String             // recalcul si le profil change
  final         Int
  technical     Int
  experience    Int
  contract      Int
  salary        Int
  location      Int
  transport     Int
  reasons       Json               // points positifs (déterministes)
  warnings      Json               // points de vigilance (déterministes)
  createdAt     DateTime @default(now())
  @@unique([jobId, rulesVersion, profileHash])
}

model JobAnalysis {
  id            String   @id @default(cuid())
  jobId         String
  job           Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  inputHash     String             // contentHash + profileHash
  model         String
  summary       String
  matchedSkills String[]
  missingSkills String[]
  risks         String[]
  createdAt     DateTime @default(now())
  @@unique([jobId, inputHash])
}

model JobEvent {                   // historique
  id        String   @id @default(cuid())
  jobId     String
  job       Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  type      String                  // STATUS_CHANGED, UPDATED, RESEEN, NOTIFIED...
  fromValue String?
  toValue   String?
  createdAt DateTime @default(now())
}

model TravelEstimate {
  jobId      String   @id
  job        Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  minutes    Int?                   // null si non calculable
  provider   String?
  precision  LocationPrecision
  computedAt DateTime @default(now())
}

model CollectionRun {
  id          String    @id @default(cuid())
  trigger     String                // "manual" | "scheduler"
  status      String                // running | done | partial | failed
  startedAt   DateTime  @default(now())
  finishedAt  DateTime?
  fetched     Int       @default(0)
  created     Int       @default(0)
  duplicates  Int       @default(0)
  aiCalls     Int       @default(0)
  sourceRuns  SourceRun[]
}

model SourceRun {
  id         String   @id @default(cuid())
  runId      String
  run        CollectionRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  source     String
  status     String                 // OK | ERROR | SKIPPED | SOURCE_UNAVAILABLE
  error      String?
  durationMs Int?
  fetched    Int      @default(0)
  createdAt  DateTime @default(now())
}

model SourceState {                // fréquence + backoff par source
  source          String   @id
  enabled         Boolean  @default(true)
  intervalMinutes Int
  failures        Int      @default(0)
  nextRunAt       DateTime @default(now())
  lastSuccessAt   DateTime?
}

model CompanyTarget {              // pour les connecteurs ATS
  id       String  @id @default(cuid())
  name     String
  ats      String                    // greenhouse | lever | ashby | recruitee | workable | personio
  boardKey String
  enabled  Boolean @default(true)
  @@unique([ats, boardKey])
}

model Notification {
  id        String   @id @default(cuid())
  jobId     String
  channel   String                   // email | webpush
  status    String                   // sent | failed
  error     String?
  createdAt DateTime @default(now())
  @@unique([jobId, channel])         // une seule notif par offre et par canal
}

model PushSubscription {
  id       String @id @default(cuid())
  userId   String
  user     User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  endpoint String @unique
  keys     Json
}

model NotificationSettings {
  id           String  @id @default("singleton")
  emailEnabled Boolean @default(true)
  pushEnabled  Boolean @default(true)
  emailTo      String?
}

model GeocodeCache {
  query     String   @id              // texte normalisé
  lat       Float?
  lng       Float?
  precision LocationPrecision
  createdAt DateTime @default(now())
}

model TravelCache {
  key       String   @id              // origine arrondie + destination arrondie + provider
  minutes   Int?
  createdAt DateTime @default(now())
}
```

> **Mis à jour à l'étape 2 :** dans le schéma réel (`packages/db/prisma/schema.prisma`), le profil est stocké dans une seule colonne `data` (JSON validé par `ProfileSchema` de `@job-radar/shared`) + les coordonnées privées du domicile. Prisma 7 : l'URL de la base est dans `packages/db/prisma.config.ts`.

**Pourquoi un `Job` + plusieurs `JobSourceLink` :** une même offre vue sur France Travail et Adzuna reste **une seule carte** dans l'interface, avec ses deux liens.

---

## 6. Découpage des packages

```text
job-radar/
├── apps/
│   ├── web/                 Vue 3 + Vite + TS (dashboard, détail, profil, sources)
│   ├── api/                 Fastify : routes REST, auth, ajout des tâches
│   └── worker/              BullMQ : collecte planifiée, pipeline, notifications
├── packages/
│   ├── shared/              types Job/Profile, schémas Zod, constantes
│   ├── scoring/             fonctions pures, 0 dépendance réseau, testées à 100 %
│   ├── job-normalizer/      RawJob → Job, parsing salaire/expérience/contrat, dédup
│   ├── skills/              dictionnaire de compétences + synonymes (Vue ≠ React)
│   ├── source-connectors/   france-travail, adzuna, ats/*, interface JobSource + rate limiter
│   ├── ai/                  interface AiAnalyzer + implémentation + cache
│   ├── routing/             interface RoutingService + géocodage + PRIM
│   └── notifications/       interface Notifier + email + webpush
├── prisma/  schema.prisma, migrations/
├── docker/  Dockerfiles
├── docs/    00-analyse-v1.md (ce fichier), décisions
├── .env.example · docker-compose.yml · pnpm-workspace.yaml
```

Règle : `scoring`, `job-normalizer` et `skills` ne font **aucun appel réseau ni base** → tests rapides et score reproductible.

---

## 7. Plan d'implémentation

Chaque étape se termine par : projet qui démarre + tests verts + commit.

| # | Étape | Livrable vérifiable |
|---|---|---|
| 1 | Socle monorepo (pnpm, TS strict, ESLint, Vitest), Docker Compose Postgres + Redis | `pnpm test` passe, `docker compose up` lance la base |
| 2 | Prisma : schéma ci-dessus + première migration + seed (utilisateur + profil par défaut) | Tables créées |
| 3 | API : auth, `GET/PUT /api/profile` | Connexion + modification du profil |
| 4 | `packages/skills` + `packages/scoring` + tests des 6 cas du README (parfaite, acceptable, trop senior, salaire faible, trop loin, non-CDI) | Scores figés par des tests |
| 5 | Front : login, dashboard, détail, profil (sur données de test) | Interface navigable |
| 6 | Connecteur France Travail (OAuth2, rate limiter, `healthCheck`) | Vraies offres récupérées |
| 7 | Normalisation (salaire, expérience, contrat, techno) + déduplication | Pas de doublons en base |
| 8 | `POST /api/jobs/refresh` + verrou + suivi du run | Bouton Actualiser fonctionnel |
| 9 | Worker + planificateur par source + backoff | Collecte auto toutes les X min |
| 10 | Notifications email + navigateur, anti-doublon | Notif reçue une seule fois |
| 11 | Connecteurs Adzuna + ATS, filtres avancés | 2ᵉ et 3ᵉ source |
| 12 | Analyse IA (seulement offres ≥ seuil, cache) | Résumé + compétences manquantes |
| 13 | Géocodage + trajet PRIM + test Oise | Sous-score transport réel |
| 14 | Observabilité (page « Sources »), tests d'intégration, doc de lancement | Critères de réussite du README cochés |

---

## 8. Ce dont j'ai besoin de toi

1. **Créer un compte sur francetravail.io**, créer une application, y ajouter l'API « Offres d'emploi v2 », et me donner (dans le `.env`, jamais dans le chat) l'identifiant client et la clé secrète.
2. Plus tard (étape 11) : une clé **Adzuna** (developer.adzuna.com).
3. Plus tard (étape 13) : un compte **PRIM Île-de-France Mobilités** et ta **gare / commune de départ** (reste privée, stockée seulement dans ta base locale).
4. Vérifier sur ton PC : Node.js 20+ (idéalement 22), pnpm, Docker Desktop.

---

## Sources vérifiées

- [API Offres d'emploi – data.gouv.fr](https://www.data.gouv.fr/dataservices/api-offres-demploi)
- [Wrapper Python api-offres-emploi (limites de pagination)](https://github.com/etiennekintzler/api-offres-emploi)
- [API La Bonne Boîte – data.gouv.fr](https://www.data.gouv.fr/dataservices/api-la-bonne-boite)
- [Adzuna – Overview](https://developer.adzuna.com/overview) · [Search](https://developer.adzuna.com/docs/search) · [Terms of Service](https://developer.adzuna.com/docs/terms_of_service)
- [LinkedIn Job Posting API – Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview?view=li-lts-2026-03)
- [Indeed : fin de l'API Publisher](https://rolesapi.com/blog/does-indeed-have-an-api/)
- [Welcome to the Jungle Solutions API – List jobs](https://developers.welcomekit.co/jobs-api/jobs/list-jobs)
- [HelloWork – Intégrer les offres sur mon site](https://recruteur-help.hellowork.com/hc/fr/articles/26596557142161-Int%C3%A9grer-les-offres-sur-mon-site-web)
- [Jooble REST API](https://jooble.org/api/about)
- [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html) · [ATS avec API publiques](https://fantastic.jobs/article/ats-with-api)
- [API Géoplateforme – Géocodage](https://www.data.gouv.fr/dataservices/api-geoplateforme-geocodage)
- [PRIM – Calculateur IDFM](https://prim.iledefrance-mobilites.fr/en/apis/idfm-navitia-general-v2)

---

## Décisions prises en cours de route

- **Étape 4 (28/09/2026) : score technique = pourcentage.** Note technique = compétences de l'offre présentes dans `profile.skills` ÷ compétences détectées dans l'offre (outils compris). Les mots-clés absents sont listés (« à ajouter au CV si tu les maîtrises »). `preferredTechs` sert aux recherches et à départager.
- **Plafonds conservés uniquement pour les critères non corrigeables par le CV :** expérience (≥ 5 ans → 55 %, ≥ 8 ans → 35 %), contrat hors profil → 0 % (et offre masquée), hors zone → 50 %, trajet > 75 min → 60 %. Le salaire est une simple note, sans plafond. Règles version `2026-10-03.2`.
