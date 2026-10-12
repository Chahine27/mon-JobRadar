# Job Radar — Agent IA personnel de recherche d'emploi

> V1 — cahier des charges / README de référence pour Claude Cowork.
>
> Projet personnel et privé destiné à automatiser la recherche d'emploi de Chahine, centraliser les offres provenant de plusieurs sources, les normaliser, les dédoublonner, les filtrer selon ses contraintes et estimer leur compatibilité avec son profil.

## 1. Objectif

Construire un site privé qui joue le rôle d'un agent de recherche d'emploi.

Pipeline cible :

```text
Sources → Collecte → Normalisation → Déduplication
→ Filtres → Scoring → Analyse IA → Notification → Interface
```

Le système doit pouvoir :
- rechercher automatiquement des offres ;
- agréger plusieurs sources dans un pool commun ;
- éviter les doublons ;
- conserver la source originale ;
- analyser chaque offre par rapport au profil ;
- calculer une compatibilité ;
- expliquer le score ;
- intégrer la localisation et le transport ;
- détecter les nouvelles offres ;
- notifier dès qu'une offre pertinente apparaît ;
- proposer un bouton Refresh ;
- conserver l'historique.

## 2. Profil cible

### Situation
- Recherche : CDI
- Profil : développeur informatique / frontend / full-stack
- Mastère Architecture Logicielle, titre RNCP niveau 7
- Environ 2 ans et demi d'expérience en alternance chez LUSIS
- Cible : junior à intermédiaire
- Éviter les postes explicitement senior, lead ou demandant une expérience nettement incompatible.

### Compétences
Expérience professionnelle notamment :
- Vue.js 2 / Vue.js 3
- Java
- Spring Boot
- API REST
- frontend / backend
- Git / GitLab
- migration Vue 2 → Vue 3
- applications web métier

Projets personnels/académiques :
- C#
- .NET 8
- JavaScript
- TypeScript
- React
- Node.js
- API REST
- bases de données
- Docker
- Clean Architecture
- CQRS
- Python
- C / C++
- DevOps

### Technologies à favoriser
1. Vue.js
2. Java / Spring Boot
3. React / TypeScript
4. Node.js
5. .NET / C#
6. Full-stack web
7. JavaScript / TypeScript

## 3. Contraintes

### Contrat
Priorité : CDI.

Les autres contrats peuvent être stockés mais doivent être fortement pénalisés ou exclus du flux principal.

### Expérience
Cible : 1 à 3 ans.

Repères :
- 0–3 ans : très compatible
- junior : compatible
- 1–3 ans : compatible
- 2 ans : compatible
- 3 ans : potentiellement compatible
- 5+ ans : forte pénalité
- 8+ ans : généralement incompatible
- senior / lead / expert senior : forte pénalité ou exclusion

Une exigence supérieure ne doit pas automatiquement rendre une annonce impossible : règle configurable.

### Salaire
Objectif : salaire cible et salaire minimum réglables dans le profil.

Repères :
- non communiqué : neutre
- maximum sous le minimum réglé : pénalité

Ne jamais inventer un salaire absent.

### Localisation
Zone principale :
- Oise
- Paris si le trajet reste raisonnable

Le lieu exact de l'entreprise est important. Une annonce indiquant seulement « Paris » ne suffit pas pour calculer correctement le trajet.

À récupérer si possible :
- adresse
- arrondissement
- ville
- transport proche
- coordonnées géographiques

### Transport
Le temps porte-à-porte est important. Le calcul doit être séparé du scoring technique.

Une localisation parisienne impliquant un trajet particulièrement fatigant doit recevoir une pénalité.

## 4. Scoring

Note technique (stack principale de l'offre, titre compté triple, technos « à apprendre » à moitié sur un poste junior ou avec formation) ramenée sur 80 points, plus des bonus/malus en points : techno préférée, junior, salaire, trajet, expérience, fonction voisine, et tes propres règles (Profil ou « Pas pour moi »). Détail : `docs/DESCRIPTIF.md` §6.

Un contrat explicitement hors profil donne un score nul et masque l'offre du flux principal ; un contrat inconnu reste neutre.

Le scoring principal doit être déterministe. Le LLM ne doit pas décider seul du score numérique.

## 5. Rôle de l'IA

L'IA sert à :
- comprendre la description ;
- extraire les technologies ;
- identifier les exigences ;
- déterminer frontend/backend/full-stack ;
- identifier le niveau d'expérience ;
- résumer ;
- détecter les synonymes ;
- expliquer la compatibilité.

Exemple de sortie :

```json
{
  "summary": "...",
  "matchedSkills": ["React", "Node.js"],
  "missingSkills": ["..."],
  "risks": ["..."]
}
```

Le LLM ne doit pas écrire directement en base.

## 6. Affichage du score

Exemple :

```text
Compatibilité : 82 %

Technique       91
Expérience      95
Contrat        100
Salaire         70
Localisation    85
Transport       72
```

Puis :

### Pourquoi ça correspond
- TypeScript présent
- React présent
- API REST
- niveau junior/intermédiaire
- CDI

### Points de vigilance
- demande 3 ans d'expérience
- salaire non communiqué
- présence sur site
- trajet estimé à X minutes

Une estimation ne doit jamais être présentée comme un fait.

## 7. Sources

### Priorité
Utiliser d'abord les sources ayant un mécanisme officiel, documenté ou autorisé :
- France Travail
- La Bonne Boîte / services France Travail lorsqu'un accès exploitable existe
- APIs officielles
- flux RSS / XML / JSON officiels
- sites carrières d'entreprises lorsque leur accès est autorisé

### Sources à traiter avec prudence
Notamment :
- LinkedIn
- Indeed

Ne pas contourner :
- Cloudflare
- CAPTCHA
- authentification
- limitations
- conditions d'utilisation

Si une source n'offre pas de moyen d'accès autorisé :

```text
SOURCE_UNAVAILABLE
```

Ne pas inventer un contournement.

## 8. Architecture des connecteurs

Chaque source est indépendante :

```text
sources/
├── france-travail/
├── la-bonne-boite/
├── linkedin/
├── indeed/
├── company-careers/
└── ...
```

Interface commune :

```ts
interface JobSource {
  name: string;
  search(params: SearchParams): Promise<RawJob[]>;
  healthCheck(): Promise<SourceHealth>;
}
```

## 9. Modèle Job

```ts
type Job = {
  id: string;
  source: string;
  sourceJobId?: string;

  title: string;
  company: string;
  description: string;

  contractType?: string;
  experienceLevel?: string;

  salaryMin?: number;
  salaryMax?: number;
  salaryPeriod?: string;

  city?: string;
  postalCode?: string;
  address?: string;
  latitude?: number;
  longitude?: number;

  remoteType?: "remote" | "hybrid" | "onsite" | "unknown";

  technologies: string[];

  sourceUrl: string;

  publishedAt?: Date;
  collectedAt: Date;

  rawData?: unknown;
};
```

## 10. Normalisation et déduplication

Une même offre peut apparaître sur plusieurs plateformes.

Priorité de déduplication :
1. identifiant source ;
2. URL canonique ;
3. entreprise + titre + localisation ;
4. similarité du contenu.

L'interface doit regrouper les sources d'une même offre au lieu d'afficher plusieurs doublons.

## 11. Historique

États possibles :

```text
NEW
SEEN
SAVED
APPLIED
REJECTED
EXPIRED
IGNORED
```

Une offre déjà notifiée ne doit pas déclencher une nouvelle notification simplement parce qu'elle est retrouvée.

## 12. Collecte périodique

Objectif utilisateur : environ toutes les 5 minutes.

Mais ne pas appeler toutes les sources toutes les 5 minutes sans tenir compte de leurs limites.

Exemple :

```text
France Travail      5 min
Source X             15 min
Source Y             30 min
```

Le système doit respecter les limites propres à chaque source.

## 13. Bouton Refresh

Interface :

```text
Dernière recherche :
Il y a 3 minutes

[ Actualiser maintenant ]
```

Endpoint :

```http
POST /api/jobs/refresh
```

Comportement :
1. empêcher plusieurs refresh simultanés ;
2. lancer la collecte ;
3. normaliser ;
4. dédupliquer ;
5. calculer le score ;
6. analyser les offres pertinentes ;
7. notifier ;
8. enregistrer le résultat.

Retour :

```json
{
  "status": "started",
  "runId": "..."
}
```

## 14. Notifications

Priorité V1 :
- notification navigateur ;
- email.

Prévoir une architecture extensible pour Discord / Telegram plus tard.

Exemple :

```text
🟢 Nouvelle offre compatible

Développeur Full Stack JavaScript
Entreprise X
Compiègne

Compatibilité : 87 %

CDI · 40–45k · 2 jours TT
Vue / TypeScript / Node.js

[Voir l'offre]
```

Avec un polling de 5 minutes, « instantanément » signifie : à la prochaine collecte, puis analyse et notification.

Ne pas faire du polling à la seconde.

## 15. Architecture

```text
                ┌────────────────────┐
                │      Frontend      │
                │      Vue 3         │
                └─────────┬──────────┘
                          │ REST
                          ▼
                ┌────────────────────┐
                │      Backend       │
                │     Node.js        │
                └─────────┬──────────┘
                          │
          ┌───────────────┼────────────────┐
          │               │                │
          ▼               ▼                ▼
      Collectors       Scoring          Notifications
          │               │                │
          ▼               ▼                ▼
      Job sources      AI service       Email/Web Push
          │
          ▼
                ┌────────────────────┐
                │    PostgreSQL      │
                └────────────────────┘
```

## 16. Stack V1

Frontend :
```text
Vue 3
TypeScript
Vite
```

Optionnel :
```text
Tailwind CSS
```

Backend :
```text
Node.js
TypeScript
```

Choisir proprement entre NestJS ou Express/Fastify et ne pas multiplier les frameworks.

Base :
```text
PostgreSQL
Prisma
```

Queue/tâches si nécessaire :
```text
Redis
BullMQ
```

Conteneurs :
```text
Docker
Docker Compose
```

## 17. Profil configurable

Ne pas hardcoder le profil.

Exemple :

```json
{
  "contract": ["CDI"],
  "experienceMin": 1,
  "experienceMax": 3,
  "salaryTarget": 40000,
  "locations": ["Oise", "Paris"],
  "preferredTechnologies": [
    "Vue.js",
    "Java",
    "Spring Boot",
    "React",
    "TypeScript",
    "Node.js",
    ".NET",
    "C#"
  ]
}
```

Le profil doit être modifiable depuis l'interface.

## 18. Recherche

Supporter :
- mots-clés ;
- technologies ;
- localisations ;
- contrat ;
- expérience ;
- salaire ;
- remote.

Exemples de recherches :
```text
Développeur Vue.js
Développeur Java Spring
Développeur React TypeScript
Développeur Node.js
Développeur Full Stack
Développeur .NET
```

Fusionner ensuite les résultats.

## 19. Filtres

- score minimum ;
- salaire minimum ;
- technologie ;
- contrat ;
- localisation ;
- remote/hybride/sur site ;
- expérience ;
- source ;
- date de publication ;
- non vues uniquement.

Exemple :
```text
Compatibilité ≥ 60 %
CDI
Publié depuis < 24h
Oise ou Paris
```

## 20. Dashboard

```text
JOB RADAR

Dernière collecte : il y a 2 min
Nouvelles offres : 4

91 % — Développeur Vue.js
Entreprise X — Compiègne
CDI — 40–45k
Vue · TypeScript · Node.js

83 % — Développeur Full Stack
Entreprise Y — Paris
CDI — hybride
React · Node · PostgreSQL

[Actualiser]
```

## 21. Page détail

Afficher :
- titre ;
- entreprise ;
- localisation ;
- salaire ;
- contrat ;
- expérience ;
- télétravail ;
- technologies ;
- description ;
- source ;
- dates ;
- URL originale ;
- score ;
- sous-scores ;
- raisons positives ;
- points de vigilance ;
- trajet ;
- bouton Voir l'offre ;
- Sauvegarder ;
- Marquer comme postulé.

## 22. Transport

Abstraction :

```ts
interface RoutingService {
  estimateTravelTime(
    origin: Location,
    destination: Location
  ): Promise<TravelEstimate>;
}
```

Ne pas coupler l'application à un fournisseur unique.

Le point de départ doit être configurable et privé.

Si le trajet n'est pas calculable :

```text
travelTime = null
```

Ne pas inventer une durée.

## 23. Pipeline IA

```text
Raw Job
 ↓
Extraction
 ↓
Normalisation
 ↓
Technologies / Experience / Salary / Location
 ↓
Score déterministe
 ↓
LLM explanation
```

Ne pas envoyer chaque annonce au LLM inutilement.

Exemple d'optimisation :

```text
1000 offres
↓ filtres
200
↓ déduplication
120
↓ scoring
40 pertinentes
↓ LLM
40 analyses
```

## 24. Cache

Mettre en cache :
- résultats API ;
- géocodage ;
- temps de trajet ;
- analyses LLM ;
- données normalisées.

Ne pas recalculer une offre inchangée.

## 25. Rate limiting

Chaque connecteur possède sa propre configuration.

```ts
{
  minDelayMs: 1000,
  maxRequestsPerMinute: 30
}
```

Les valeurs réelles doivent venir des règles documentées de la source.

Respecter quotas, authentification, rate limits et conditions d'utilisation.

## 26. Sécurité

Prévoir :
- authentification ;
- sessions sécurisées ;
- secrets dans `.env` ;
- aucun token dans Git ;
- HTTPS en production ;
- validation des entrées ;
- protection CSRF si nécessaire ;
- protection SSRF ;
- sanitation ;
- contrôle des URLs ;
- rate limiting ;
- logs sans secrets.

## 27. Configuration

`.env.example` :

```env
DATABASE_URL=
REDIS_URL=

FRANCE_TRAVAIL_CLIENT_ID=
FRANCE_TRAVAIL_CLIENT_SECRET=

LLM_API_KEY=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=

APP_URL=

CRON_INTERVAL_MINUTES=5
MIN_JOB_SCORE_FOR_NOTIFICATION=70
```

Ne jamais commit `.env`.

## 28. API backend

Minimum :

```http
GET /api/jobs
GET /api/jobs/:id
POST /api/jobs/refresh

GET /api/profile
PUT /api/profile

GET /api/searches
GET /api/searches/:id

POST /api/jobs/:id/save
POST /api/jobs/:id/apply
POST /api/jobs/:id/ignore

GET /api/notifications
PUT /api/notifications/settings
```

## 29. Scheduler

Logique :

```text
every 5 minutes:
    if no collection running:
        launch collection
```

À terme, préférer un système de jobs/queue permettant une fréquence indépendante par source.

## 30. Gestion des erreurs

Une source en erreur ne doit pas bloquer les autres.

Exemple :

```text
France Travail      OK
Source B             OK
Source C             ERROR
Site entreprise      OK
```

Enregistrer :
- source ;
- statut ;
- erreur ;
- durée ;
- timestamp.

## 31. Observabilité

Afficher :
- dernière collecte ;
- sources OK ;
- sources en erreur ;
- offres récupérées ;
- nouvelles offres ;
- doublons ;
- durée ;
- appels IA.

## 32. Tests

### Unit tests
Tester :
- normalisation ;
- déduplication ;
- scoring ;
- salaire ;
- expérience ;
- contrat ;
- technologies.

### Integration tests
Tester :

```text
source → normalizer → database
```

### Cas de scoring
- offre parfaite ;
- offre acceptable ;
- offre trop senior ;
- salaire faible ;
- trop éloignée ;
- non-CDI.

Le score ne doit pas changer sans modification explicite des règles.

## 33. Monorepo

```text
job-radar/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── shared/
│   ├── scoring/
│   ├── job-normalizer/
│   └── source-connectors/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── docker/
├── docs/
├── .env.example
├── docker-compose.yml
├── package.json
└── README.md
```

## 34. Phases V1

### Phase 1
- monorepo ;
- frontend ;
- backend ;
- PostgreSQL ;
- modèle Job ;
- profil ;
- scoring ;
- dashboard.

### Phase 2
- premier connecteur officiel exploitable ;
- normalisation ;
- déduplication ;
- historique ;
- refresh manuel.

### Phase 3
- scheduler ;
- notifications ;
- deuxième source ;
- filtres.

### Phase 4
- IA ;
- explications ;
- analyse avancée.

### Phase 5
- transport ;
- optimisation du scoring ;
- nouvelles sources autorisées.

## 35. Critères de réussite

- [ ] profil configurable ;
- [ ] une source officielle connectée ;
- [ ] stockage PostgreSQL ;
- [ ] déduplication ;
- [ ] scoring ;
- [ ] dashboard ;
- [ ] Refresh ;
- [ ] scheduler ;
- [ ] notification d'une nouvelle offre pertinente ;
- [ ] aucune double notification inutile ;
- [ ] une source en erreur n'arrête pas les autres ;
- [ ] secrets absents de Git ;
- [ ] limites des sources respectées.

## 36. Ce qu'il ne faut pas faire

Ne pas :
- appeler un site toutes les secondes ;
- contourner Cloudflare ;
- contourner CAPTCHA ;
- contourner une authentification ;
- contourner une limitation volontaire ;
- automatiser un compte utilisateur sans autorisation ;
- redistribuer massivement une base protégée.

Ne pas laisser un LLM décider seul du score.

Ne jamais inventer :
- salaire ;
- adresse ;
- temps de trajet ;
- technologie ;
- expérience.

Donnée inconnue = `null` ou `unknown`.

## 37. Stratégie plateformes

Vision long terme :

```text
France Travail
LinkedIn
Indeed
La Bonne Boîte
Welcome to the Jungle
HelloWork
Free-Work
etc.
```

Mais l'architecture doit fonctionner même si certaines plateformes ne peuvent pas être intégrées proprement.

Architecture :

```text
JobSource interface
        │
 ┌──────┼──────┐
 ↓      ↓      ↓
FT    Source B Source C
 └──────┼──────┘
        ↓
 Normalisation
```

et non :

```text
Frontend → scraping de tous les sites
```

## 38. Recherche quasi temps réel

Besoin :

```text
offre publiée
↓
prochaine collecte
↓
analyse
↓
notification
```

Cible : environ 5 minutes.

Si une source impose une fréquence plus faible, respecter cette fréquence.

La fréquence doit donc être configurable par source.

## 39. Collecte adaptative

À terme :
- source très active → fréquence élevée ;
- source peu active → fréquence faible ;
- source limitée → fréquence imposée ;
- source en erreur → backoff.

Exemple de backoff :

```text
5 min
10 min
20 min
40 min
```

Après succès : reset.

## 40. Priorisation technique

Reconnaître les relations entre technologies sans les considérer identiques.

Exemple :
```text
Vue.js ≠ React
```

mais :
```text
Vue.js + JavaScript
```
reste pertinent pour un profil frontend JavaScript.

Créer à terme un dictionnaire de compétences, par exemple :

```text
JavaScript
├── TypeScript
├── React
├── Vue.js
├── Angular
└── Node.js
```

Conserver néanmoins les technologies exactes de l'annonce.

## 41. Données personnelles

Le système contient les données personnelles du candidat.

Donc :
- base privée ;
- authentification ;
- pas de données publiques ;
- point de départ de transport privé ;
- secrets protégés ;
- sauvegardes sécurisées ;
- suppression facile des données.

## 42. Déploiement

V1 locale :

```text
Docker Compose
```

Services :

```text
web
api
postgres
redis
```

Optionnel :
```text
worker
```

Le projet doit pouvoir être lancé avec une procédure simple et documentée.

## 43. Instructions pour Claude Cowork

Claude doit travailler incrémentalement.

Ordre :

```text
1. Lire le README
2. Identifier les contraintes
3. Vérifier les API/connecteurs réellement accessibles et autorisés
4. Identifier ce qui est faisable en V1
5. Signaler les sources indisponibles
6. Proposer l'architecture finale
7. Proposer le schéma PostgreSQL
8. Proposer le découpage des packages
9. Proposer le plan d'implémentation
10. Implémenter le socle
```

Puis :

```text
11. Modèle Job
12. Profil
13. Scoring
14. Dashboard
15. Premier connecteur autorisé
16. Normalisation
17. Déduplication
18. Refresh
19. Scheduler
20. Notifications
21. IA
22. Transport
23. Tests
24. Docker
25. Documentation
```

À chaque étape :
- faire fonctionner le projet ;
- lancer les tests ;
- corriger les erreurs ;
- ne pas casser les fonctionnalités précédentes ;
- expliquer les décisions importantes ;
- éviter les dépendances inutiles.

## 44. Vision finale

```text
                ┌─────────────────────┐
                │     User Profile    │
                └──────────┬──────────┘
                           ↓
                ┌─────────────────────┐
                │   Search Strategy   │
                └──────────┬──────────┘
                           ↓
        ┌────────────────────────────────────┐
        │            Job Sources             │
        │ FT · LBB · Careers · autres       │
        └────────────────┬───────────────────┘
                         ↓
                ┌─────────────────────┐
                │ Normalize + Dedup    │
                └──────────┬──────────┘
                           ↓
                ┌─────────────────────┐
                │ Deterministic Score │
                └──────────┬──────────┘
                           ↓
                ┌─────────────────────┐
                │      AI Analysis    │
                └──────────┬──────────┘
                           │
                 ┌─────────┴─────────┐
                 ↓                   ↓
             Dashboard          Notification
```

Le but est de réduire le temps passé à chercher, filtrer et comparer les offres, tout en laissant la décision finale au candidat.

## 45. Première tâche demandée à Claude

Avant d'écrire du code :

1. Lire intégralement ce README.
2. Identifier les contraintes techniques et fonctionnelles.
3. Vérifier les API/connecteurs réellement accessibles et autorisés.
4. Identifier ce qui est faisable immédiatement en V1.
5. Signaler clairement les sources qui ne peuvent pas être intégrées proprement.
6. Proposer l'architecture finale.
7. Proposer le schéma PostgreSQL.
8. Proposer le découpage des packages.
9. Proposer le plan d'implémentation.
10. Ne pas commencer par développer un scraper LinkedIn/Indeed non autorisé.

Ensuite seulement, commencer l'implémentation par le socle V1.

## 46. Règle générale

> On construit d'abord un excellent moteur de recherche et de décision à partir de données accessibles légalement et techniquement, puis on ajoute progressivement les sources.

Une source indisponible ne doit jamais bloquer le reste du système.
