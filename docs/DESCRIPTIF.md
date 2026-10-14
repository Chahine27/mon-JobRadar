# Job Radar — Descriptif complet de l'application

> État au 7 octobre 2026. Application personnelle et privée, qui tourne en local sur le PC de Chahine.
> Ce document décrit ce que l'application **fait réellement aujourd'hui** (le `README.md` à la racine est le cahier des charges d'origine).

---

## Sommaire

1. [En une phrase](#1-en-une-phrase)
2. [Vue d'ensemble du fonctionnement](#2-vue-densemble-du-fonctionnement)
3. [Les écrans (fonctionnalités utilisateur)](#3-les-écrans-fonctionnalités-utilisateur)
4. [Sources d'offres](#4-sources-doffres)
5. [Pipeline de traitement d'une offre](#5-pipeline-de-traitement-dune-offre)
6. [Le score de compatibilité](#6-le-score-de-compatibilité)
7. [L'IA locale (Ollama)](#7-lia-locale-ollama)
8. [Trajet domicile → travail](#8-trajet-domicile--travail)
9. [Notifications](#9-notifications)
10. [Suivi des candidatures par mail](#10-suivi-des-candidatures-par-mail)
11. [Candidatures spontanées](#11-candidatures-spontanées)
12. [Extension navigateur](#12-extension-navigateur)
13. [Architecture technique](#13-architecture-technique)
14. [Base de données](#14-base-de-données)
15. [API (routes du serveur)](#15-api-routes-du-serveur)
16. [Tâches automatiques](#16-tâches-automatiques)
17. [Sécurité et données personnelles](#17-sécurité-et-données-personnelles)
18. [Lancement, configuration, outils](#18-lancement-configuration-outils)
19. [Tests et qualité](#19-tests-et-qualité)
20. [Coûts](#20-coûts)
21. [Limites connues et pistes](#21-limites-connues-et-pistes)
22. [CV adapté à l'offre](#22-cv-adapté-à-loffre)

---

## 1. En une phrase

Job Radar est un **agent personnel de recherche d'emploi** : il collecte des offres sur plusieurs sites, les regroupe sans doublons, leur donne un **score de compatibilité expliqué** selon le profil (CDI, junior, Vue.js / Java / TypeScript, Oise–Paris, ≥ 38 k€), prévient quand une bonne offre apparaît, aide à **écrire la lettre de motivation** avec une IA locale, suit les **réponses des recruteurs** dans la boîte mail, et prépare des **candidatures spontanées**.

Principes de base :
- **le score est calculé par des règles fixes**, pas par l'IA. L'IA peut seulement le *baisser* ;
- **rien n'est inventé** : un salaire, une adresse, un trajet ou une expérience inconnus restent « non précisés » ;
- **sources autorisées seulement** : pas de contournement de CAPTCHA, de connexion ou de limites ;
- **tout est gratuit et local** : l'IA tourne sur le PC, aucune donnée ne part chez un fournisseur d'IA.

---

## 2. Vue d'ensemble du fonctionnement

```text
 Sources (France Travail, Adzuna, Jooble, pages carrières, JobScraper, extension, saisie à la main)
        │  collecte planifiée (rythme propre à chaque source) ou bouton « Actualiser maintenant »
        ▼
 Normalisation  →  contrat, salaire, expérience, lieu, télétravail, technologies
        ▼
 Dédoublonnage  →  une offre vue sur 3 sites = 1 seule offre, avec 3 liens
        ▼
 Score déterministe (6 critères + plafonds)  →  masquage des offres hors profil
        ▼
 Vérification par l'IA locale (meilleures offres)  →  score éventuellement baissé
        ▼
 Notification (navigateur + e-mail) si score ≥ seuil      Trajet calculé à l'ouverture
        ▼
 Interface web : offres, détail, lettre, candidatures, entreprises
        ▼
 Suivi des réponses par mail (accusé, entretien, proposition, refus)
```

---

## 3. Les écrans (fonctionnalités utilisateur)

Menu latéral : **Offres · Candidatures · Ajouter une offre · Entreprises · Sources · CV & lettre · CV complet · Profil · Réglages**, plus le choix du thème (Auto / Clair / Sombre) et le bouton **« Arrêter Job Radar »** en bas du menu.

### 3.1 Connexion
- Compte unique (créé par le script de « seed » avec `SEED_USER_EMAIL` / `SEED_USER_PASSWORD`).
- Session par cookie sécurisé ; toute page non publique redirige vers la connexion.

### 3.2 Offres (tableau de bord, `/`)
- **En-tête** : date de la dernière collecte, nombre de nouvelles offres, bouton **« Actualiser maintenant »** (une seule collecte à la fois).
- **Bandeau des sources** : « Toutes les sources » ou une seule source (France Travail, Adzuna, Jooble, LinkedIn via JobScraper…, « Ajoutées par moi »). Chaque pastille indique l'état (OK / erreur / non configurée / jamais lancée) et le délai avant la prochaine collecte.
- **Rubriques (lieu)** : **Tout** · Dans ma zone · Full remote · Lieu non précisé.
- **Statut** : Actives · Nouvelles · Sauvegardées · Ignorées · Expirées · Toutes.
- **Filtres** : score minimum (25 / 50 / 65 / 75 %), recherche texte, tri par score ou par date, affichage des offres masquées.
- Les filtres sont **mémorisés** d'une visite à l'autre (stockage du navigateur).
- **Cartes d'offre** : score (pastille colorée), titre, entreprise, lieu, contrat, salaire, télétravail, compétences présentes ou manquantes, logo de la source, « publiée il y a… ». Mentions : « Extrait · score approximatif » (Adzuna, Jooble), « IA en cours… », score corrigé par l'IA (« 91 → 50 % »), « IA éteinte : scores non vérifiés ».
- **Pagination** par 10 (« Voir plus »). La liste se met à jour seule pendant et après une collecte, sans faire remonter la page.

### 3.3 Détail d'une offre (`/offres/:id`)
- **En-tête** : statut, dates (publiée / vue pour la première fois), titre, entreprise, adresse ou ville (lien Google Maps), contrat, salaire, télétravail, expérience demandée, **temps de trajet**, grande pastille de score.
- **Bouton « Modifier les infos »** : corriger ou compléter l'intitulé, l'entreprise, la ville, le département, le contrat, le télétravail, le salaire et l'expérience. Les corrections priment sur la source, ne sont jamais écrasées par la collecte et peuvent être annulées (« Revenir aux infos de la source »).
- **Actions** : « Voir l'offre sur … » (un bouton par source), Sauvegarder, Marquer comme postulé, Ignorer, Remettre à « vue ». Ouvrir une nouvelle offre la passe automatiquement de « Nouvelle » à « Vue ».
- **Annonce incomplète** (Adzuna, Jooble, LinkedIn sans détail) : encadré « Compléter l'annonce » pour coller la page entière. Le score, l'IA et la lettre utilisent alors le texte complet (« Revenir à l'extrait » pour annuler).
- **Analyse IA** : adéquation (forte / moyenne / faible), avis, compétences exigées et « plus » lus dans l'annonce.
- **Pourquoi ça correspond / Points de vigilance** : explications du score en clair.
- **Lettre de motivation** : rédaction par l'IA, encadré « À vérifier avant d'envoyer », édition, Copier, Enregistrer en PDF. Notification quand la lettre est prête, sauf si la page est déjà ouverte.
- **CV pour cette offre** (voir §22) : bouton « Adapter mon CV », onglets ATS / e-mail, aperçu à gauche et explications à droite (« gardée car : Vue.js (exigé) »), lignes et projets laissés de côté avec « Remettre », compétences demandées absentes du CV (lien « J'ai fait ça → ajouter une phrase »), vues seulement en cours, choisies de ne pas être affichées, mots remplacés, contrôles (vert / rouge) et avertissements. Choix manuels : retirer, remettre, autre version, autre titre, monter / descendre. Boutons « Valider », « Exporter en PDF », « Exporter les deux », « Ouvrir le dossier ». Bandeau « Régénérer » si le CV complet ou l'offre a changé.
- **Description** : texte de l'annonce, avec un bouton **« Modifier »** pour le compléter ou le corriger (le score et l'IA utilisent le nouveau texte).
- **Détail du score** : note technique, chaque bonus/malus en points, plafonds (dont plafond IA), score final. Bouton **« Pas pour moi »**.
- **Compétences** : celles qu'on a et celles qui manquent, avec un bouton « + je l'ai » qui ajoute la compétence au profil et recalcule le score.
- Raison affichée si le trajet n'a pas pu être calculé (avec un lien vers le profil si le point de départ manque).

### 3.4 Candidatures (`/postule`)
- Toutes les offres marquées « Postulé », avec la **date de candidature** et le **CV adapté envoyé** (modèle et date d'export).
- **Étape** de chaque candidature : Envoyée → Accusé de réception → Entretien → Proposition, ou Refusée. Elle est mise à jour **toute seule** grâce aux mails reçus (voir §10).
- Mails rattachés consultables, bouton pour écarter un mail rattaché par erreur, bouton « je n'ai finalement pas postulé » (l'offre revient dans Offres), bouton de vérification immédiate des mails.

### 3.5 Ajouter une offre (`/ajouter`)
- Coller une annonce vue ailleurs (LinkedIn, Indeed…) : **lecture automatique** (titre, entreprise, lieu, contrat, salaire, expérience, télétravail), puis vérification dans le formulaire.
- Lecture par l'IA possible ; option « Ajout automatique depuis l'extension ».
- Si l'offre existe déjà sous forme d'extrait (Adzuna / Jooble), Job Radar propose de **la compléter** au lieu de créer un doublon.
- Liste « Mes offres ajoutées » (retrait possible).

### 3.6 Entreprises (`/entreprises`) — candidatures spontanées
- Entreprises **susceptibles de recruter des développeurs dans les 6 prochains mois** (La Bonne Boîte, France Travail), dans une zone au choix (ville et rayon, ou départements), avec des propositions de zones.
- Tri par **potentiel d'embauche** ou par distance. Filtres par statut (À contacter, Contactée, Relancée, Entretien, Pas intéressé, Ignorée) et par e-mail (connu, indice, manquant). Les filtres sont gardés dans le profil.
- Détection d'adresses e-mail de contact. Chaque entreprise ouvre une page « Candidature spontanée ».

### 3.7 Candidature spontanée (`/entreprises/:id/candidature`)
En 3 étapes : **1. la lettre** (écrite par l'IA, sans rien inventer sur l'entreprise, puis relue) → **2. l'e-mail** (objet, texte, destinataire) → **3. envoyer**. L'e-mail part de Gmail avec la lettre en PDF et le CV en PDF. Rien ne part sans un clic, et un renvoi à une entreprise déjà contactée demande une confirmation.

### 3.8 Sources (`/sources`)
- Liste des sources : activer ou désactiver, **fréquence de collecte** (avec un minimum par source), état, dernière erreur, compteur de quota Jooble (500 appels à vie).
- **Entreprises suivies** : ajout d'une page carrières (Greenhouse, Lever, Ashby, Recruitee) en collant son adresse.

### 3.9 CV & lettre (`/candidature`)
1. Ton CV (texte, obligatoire)
2. Une lettre déjà écrite (pour imiter le style)
3. En-tête et signature
4. Tes règles pour la lettre
5. Dossier où enregistrer le PDF de la lettre, et chemin du CV PDF (pour les candidatures spontanées)
6. Où enregistrer le PDF du CV adapté : dossier (vide = celui des lettres), un sous-dossier « Entreprise_AAAA-MM-JJ » ou non, remplacer le fichier existant ou garder l'ancien (« _2 », « _3 »…)

### 3.10 CV complet (`/cv`)
- Le CV découpé en morceaux (voir §22) : sections repliables En-tête, Titres, Profils, Expériences (lignes), Projets, Compétences, Formation, Langues et loisirs, Règles, plus la liste « Points à trancher » et le choix du modèle ATS.
- Chaque morceau : ses versions (style « verbe » pour le CV une colonne, « nom » pour le deux colonnes), ses étiquettes de compétences (choisies dans le dictionnaire), son niveau (pro / projet / cours) et sa règle (toujours / si utile).
- Les phrases « à valider » sont en orange avec « Je valide cette phrase » (modifier le texte la valide aussi) ; compteur en haut. Tant qu'elles ne sont pas validées, elles ne sont jamais utilisées.
- « Importer le fichier de départ » (`data/cv/cv-master.seed.yaml`) si la base est vide, sans jamais écraser. « Tester sur une offre » ouvre une offre sauvegardée.
- Enregistrement refusé si le CV complet est incohérent (compétence inconnue ou interdite, phrase sans version validée, titre ou résumé avec une compétence vue seulement en cours…).

### 3.11 Profil (`/profil`)
Tous les réglages qui décident du score :
- compétences maîtrisées, technos préférées (avec importance), **recherches lancées** (mots-clés) ;
- contrats acceptés, expérience visée (min–max), salaire cible et minimum ;
- **zones de recherche** (départements) et rayon autour du point de départ ;
- **règles bonus/malus** (mot du titre, mot de l'annonce, entreprise → points) ;
- seuils (analyse IA, notification) ;
- **domicile privé** (trajet en voiture, hors Île-de-France) et **gare d'arrivée à Paris** (trajet en transports, Île-de-France).

### 3.12 Réglages (`/reglages`)
- **Notifications** : navigateur (abonnement Web Push), e-mail (adresse), test d'envoi, historique.
- **Relancer une source** à la main (si elle est en erreur), sans attendre ni changer son rythme.

---

## 4. Sources d'offres

| Source | Accès | Particularités |
|---|---|---|
| **France Travail** | API officielle (identifiants francetravail.io) | Source principale. Expiration confirmée par l'API. |
| **Adzuna** | API officielle (clé gratuite) | Ne donne qu'un **extrait** de l'annonce : score approximatif tant qu'elle n'est pas complétée. |
| **Jooble** | API officielle (clé gratuite fr.jooble.org) | **500 appels à vie** par clé : une recherche par zone, une collecte par jour au plus, arrêt à 480. Extrait seulement. |
| **Pages carrières (ATS)** | Données publiques documentées | Greenhouse, Lever, Ashby, Recruitee. Entreprises ajoutées à la main. |
| **JobScraper** (outil Python externe, `tools/jobscraper`) | Sous-processus | LinkedIn, HelloWork, France Travail, Welcome to the Jungle, Adzuna. Désactivé par défaut, 1 passage par jour (15 min minimum). File séparée, pour ne pas bloquer les autres sources. Descriptions manquantes complétées ensuite depuis la page publique. |
| **Extension navigateur** | Clic sur la page d'une offre | N'importe quel site d'emploi. Voir §12. |
| **Saisie à la main** | Page « Ajouter une offre » | Offre gardée dans « Sauvegardées ». |
| **La Bonne Boîte** | API France Travail | Pour les candidatures spontanées (entreprises, pas des offres). |

Fonctionnement commun :
- chaque connecteur respecte l'interface `JobSource` et ses propres limites (limiteur de débit) ;
- **une source en panne ne bloque jamais les autres** ; en cas d'échec, le délai avant le prochain essai s'allonge (backoff), puis revient à la normale après un succès ;
- chaque collecte est enregistrée (`CollectionRun`, `SourceRun`) : offres récupérées, créées, doublons, durée, erreurs ;
- la fenêtre de publication demandée s'adapte à la date du dernier succès.

---

## 5. Pipeline de traitement d'une offre

1. **Collecte** : la source renvoie des offres brutes (`RawJob`).
2. **Normalisation** (`packages/job-normalizer`), un module par source :
   - contrat (CDI, CDD, intérim, alternance, stage, freelance), lu dans les champs, le titre ou le texte (« Contract: »…) ;
   - salaire ramené en **brut annuel** (mensuel ou horaire convertis), y compris un salaire écrit dans l'annonce ;
   - expérience demandée (années min et max, texte) ;
   - lieu : ville, code postal, département, coordonnées, précision (adresse ou centre-ville) ;
   - télétravail : complet, hybride, sur site ou inconnu ;
   - technologies, via le **dictionnaire de compétences** (`packages/skills`, synonymes compris) ;
   - nettoyage du HTML et du texte.
3. **Dédoublonnage** (`packages/pipeline/dedupe`), par ordre :
   identifiant chez la source → adresse canonique → empreinte entreprise + titre + ville → **clé de rapprochement** (titre nettoyé de « (H/F) », du contrat…) pour la même offre écrite autrement. Résultat : une offre avec **plusieurs liens sources**. Commande de nettoyage : `pnpm jobs:dedupe`.
4. **Enregistrement** (`ingest`) : création ou mise à jour. Une mise à jour ne touche jamais au statut, à l'annonce complète collée ni aux corrections manuelles.
5. **Score** calculé à la lecture et mis en cache (`JobScore`), recalculé si l'offre, le profil ou les règles changent.
6. **Expiration** (toutes les 6 h) :
   - France Travail : plus vue depuis 7 jours **et** confirmée disparue par l'API ;
   - pages carrières : plus vue depuis 2 jours ;
   - Adzuna, Jooble : plus de 45 jours ;
   - une offre multi-sources n'expire que si **toutes** ses sources l'ont perdue ;
   - les offres sauvegardées, postulées ou ignorées ne sont jamais touchées.
7. **Notification** des nouvelles offres pertinentes (voir §9).

---

## 6. Le score de compatibilité

Package `packages/scoring`. Le score est **déterministe** : mêmes données et mêmes règles donnent le même score. Les règles ont un **numéro de version** (actuellement `2026-10-10.1`) ; toute modification change la version et relance le calcul de tous les scores.

### 6.1 Calcul : technique + bonus/malus

**Score = note technique ramenée sur 80 points + bonus et malus en points**, borné entre 0 et 100. Une information absente (salaire, contrat, trajet, expérience) ne donne **ni bonus ni malus**.

**Note technique** (0–100 %) : part des **technos principales** de l'offre (langages, frameworks, plateformes) que tu maîtrises. Les outils (Git, SQL, Docker, CI/CD…) n'entrent pas dans le calcul, sauf s'il n'y a qu'eux. Une techno **du titre** (la stack principale) compte **triple**. Une techno que tu n'as pas compte **à moitié** si le poste est junior (ou « débutant accepté ») ou si l'annonce **propose une formation** (« formation interne », « vous serez formé », « montée en compétences ») — sauf si sa **maîtrise est exigée** (« 3 ans d'expérience sur Angular », « maîtrise d'Angular », « Angular indispensable »). Quand l'IA a analysé l'offre, ses compétences exigées (et « plus », comptés à moitié) remplacent les mots-clés.

| Bonus / malus | Points |
|---|---|
| Techno préférée dans la stack principale | + 10 × son poids (si poids ≥ 0,5) |
| Poste junior / débutant accepté | + 5 |
| Salaire à la cible ou plus / sous le minimum / nettement sous | + 5 / − 10 / − 20 |
| Télétravail complet | + 5 |
| Expérience un peu / nettement / très au-dessus de la cible | − 10 / − 25 / − 40 |
| Trajet en voiture 46–60 / 61–75 / 76–90 / plus de 90 min | − 5 / − 10 / − 20 / − 30 |
| Transports depuis la gare d'arrivée 31–45 / 46–60 / plus de 60 min | − 5 / − 15 / − 25 |
| Hors de ta zone | − 30 (offre masquée) |
| Fonction voisine (support, analyste, sécurité, test, administration) | − 20 |
| **Tes règles** (Profil, ou « Pas pour moi » sur une offre) : mot du titre, mot de l'annonce, entreprise | les points choisis (− 100 à + 50) |

Puis les **plafonds** :

| Condition | Plafond |
|---|---|
| Contrat hors profil | 0 % (offre masquée) |
| Poste qui n'est pas du développement (chef de projet, commercial…) | 35 % |
| Hors sujet (aucune techno et titre sans rapport avec l'informatique) | 15 % (offre masquée) |
| **IA** : adéquation moyenne / faible | 75 % / 50 % |

**« Pas pour moi »** (fiche d'une offre) : ignore l'offre et, au choix, ajoute une règle pour les suivantes — stack non maîtrisée (− 30 par techno du titre), métier hors sujet (− 40 pour un mot du titre), entreprise (− 50). Les règles se modifient dans le Profil.

### 6.2 Offres masquées du flux principal
Contrat hors profil, poste senior / lead / manager (lu dans le titre), expérience demandée supérieure de plus d'un an au maximum visé, hors sujet, hors zone (le télétravail et les lieux inconnus ne sont jamais masqués). Elles restent en base et se voient avec « afficher les masquées ».

### 6.3 Explications
Chaque score est accompagné de **raisons positives**, de **points de vigilance** (« demande 3 ans », « salaire non communiqué », « trajet ≈ 75 min »…) et des **étapes du calcul**. Une estimation n'est jamais présentée comme un fait.

---

## 7. L'IA locale (Ollama)

- Modèle **gemma4:e4b** via **Ollama**, sur le PC : gratuit, sans clé, rien ne sort de la machine. Contexte réglé sur 8k. Adresse et modèle modifiables (`OLLAMA_URL`, `OLLAMA_MODEL`).
- Package `packages/ai`. L'IA **n'écrit jamais directement en base** : ses réponses sont vérifiées (schémas zod) et contrôlées. Par exemple, un salaire, une entreprise ou une expérience absents du texte sont refusés.

| Usage | Détail |
|---|---|
| **Analyse d'offre** (`job-analysis`) | Adéquation forte / moyenne / faible, avis, compétences exigées et « plus », expérience demandée. Gardée en cache ; marquée « à refaire » si l'annonce, le profil, le CV ou le modèle change. |
| **Vérification automatique** | Les offres affichées à **70 % et plus** sont relues une par une (5 à 10 s chacune). L'IA peut seulement **baisser** le score. Les extraits ne sont pas vérifiés. |
| **Lecture d'annonce** (`job-reading`) | Range les champs d'une page envoyée par l'extension ou collée. |
| **Lettre de motivation** (`cover-letter`) | À partir du CV, d'une lettre exemple (pour le style), de tes règles et de l'annonce. Liste « À vérifier » (techno absente du CV, nom repris de la lettre exemple…). Version spontanée plus vendeuse pour les entreprises. Export PDF (pdfkit) dans le dossier choisi. |
| **Lecture des mails** (`mail-reading`) | Tranche les mails ambigus (accusé, entretien, proposition, refus) quand les règles ne suffisent pas. |

Ollama éteint : tout marche sans l'IA (mention « IA éteinte »), avec repli sur la lecture simple.

---

## 8. Trajet domicile → travail

Package `packages/routing`. Le mode dépend du lieu de l'offre :
- **Île-de-France** (75, 77, 78, 91–95) : **transports en commun depuis la gare d'arrivée** du profil (Gare du Nord par défaut ; le train jusqu'à elle est un temps fixe accepté), avec PRIM (Île-de-France Mobilités, clé gratuite `PRIM_API_KEY`). Score : rien jusqu'à 30 min, puis − 5 / − 15 / − 25.
- **Ailleurs** (Oise…) ou département inconnu : **voiture depuis le domicile** (privé) avec **OSRM** (open source, données OpenStreetMap) : serveur public gratuit sans clé, 1 requête/s au plus, durée sans trafic. `OSRM_URL` pour utiliser son propre serveur OSRM (Docker).
- **Lieu de l'offre**, du plus précis au moins précis : adresse lue dans l'annonce (Géoplateforme IGN) ; sinon **établissement de l'entreprise** trouvé avec l'API Recherche d'entreprises de l'État (gratuite, sans clé) — seulement si le nom est identique et l'établissement dans la ville de l'offre, un seul lieu possible (sinon on ne risque pas un faux point : homonymes, cabinets de recrutement) ; sinon le centre de la ville. Tout est mis en cache (`GeocodeCache`, `TravelCache`, arrondi ~1 km).
- **Économie des quotas** : calcul seulement à l'ouverture d'une offre (1 appel au plus) et pour les nouvelles offres qui pourraient être notifiées ; 800 itinéraires par jour et par fournisseur.
- Pas d'itinéraire = « non calculé », avec la raison. Aucune durée inventée. Un changement de domicile ou de gare relance le calcul.
- Interface `RoutingService` : on peut changer de fournisseur.

---

## 9. Notifications

Package `packages/notifications`.
- **Canaux** : notification navigateur (**Web Push**, clés VAPID générées par `pnpm setup:push`) et **e-mail** (SMTP Gmail avec mot de passe d'application).
- **Quand** :
  - nouvelle offre avec un score ≥ seuil (70 % par défaut) : « à postuler » ;
  - offre complétée dont le score recalculé reste bon ;
  - lettre de motivation prête (navigateur seulement), **sauf si la page est déjà ouverte** (le site signale sa présence toutes les 10 s).
- **Jamais deux fois** la même alerte pour la même offre (clé unique offre + canal + type).
- Historique des notifications dans les Réglages.

---

## 10. Suivi des candidatures par mail

- Lecture de la boîte Gmail en **IMAP, en lecture seule** (rien n'est marqué comme lu ni déplacé). Activé par `MAIL_TRACKING_ENABLED=true`.
- Toutes les **15 minutes**, ou sur demande depuis la page Candidatures.
- Recherche côté Gmail : mots-clés de réponse (« candidature », « entretien », « malheureusement », « test technique »…) **et noms des entreprises** où tu as postulé. Curseurs par dossier (`MailCursor`) pour ne relire que le nouveau ; relecture possible sur une période.
- Chaque mail est rattaché à une candidature (entreprise, réponse à un envoi), puis classé **Accusé / Entretien / Proposition / Refus** par des règles, et par l'IA si c'est ambigu. Les envois de Chahine et les mails de Job Radar sont ignorés.
- **L'étape ne recule jamais**, sauf qu'un refus l'emporte, à moins qu'un entretien ou une proposition arrive après.

---

## 11. Candidatures spontanées

- Entreprises venant de **La Bonne Boîte** (potentiel d'embauche, secteur NAF, effectif, adresse, distance), selon les métiers **ROME** du profil (par défaut M1805, études et développement informatique) et une zone propre (ville et rayon, ou départements).
- Suivi par entreprise : À contacter → Contactée → Relancée → Entretien, ou Pas intéressé / Ignorée.
- Recherche d'e-mails de contact (adresses trouvées ou indices).
- Lettre par l'IA, puis envoi depuis Gmail avec la lettre PDF et le CV PDF (limite : 10 envois par minute).

---

## 12. Extension navigateur

Dossier `extension/` (Chrome / Edge, Manifest V3, chargée en « mode développeur »).
- Un clic sur l'icône ou **Alt + Maj + J** sur la page d'une offre (LinkedIn, Indeed, HelloWork, Welcome to the Jungle…).
- Déplie les « Voir plus », envoie le texte (ou seulement la sélection) à Job Radar, qui ouvre un onglet où **l'IA lit, ajoute et analyse l'offre** (20 à 40 s), puis affiche la page de l'offre.
- Reconnaît une offre Adzuna / Jooble déjà connue et propose de **la compléter**.
- Droits minimaux : onglet actif, et seulement `localhost:5173`. La page n'est lue qu'au clic et rien n'est envoyé ailleurs.
- Page d'options (adresse de Job Radar).

---

## 13. Architecture technique

### 13.1 Stack
| Couche | Technologie |
|---|---|
| Interface | **Vue 3** + TypeScript + **Vite**, vue-router, CSS maison (thèmes clair et sombre) |
| Serveur | **Node.js** + TypeScript + **Fastify 5**, validation **zod** |
| Base | **PostgreSQL 17** + **Prisma 7** |
| IA | **Ollama** (local), modèle gemma4:e4b |
| Mails | nodemailer (SMTP), imapflow + mailparser (IMAP), web-push |
| PDF | pdfkit (lettres) ; Microsoft Edge sans fenêtre via playwright-core et relecture par pdfjs-dist (CV) |
| Conteneurs | Docker Compose (PostgreSQL ; Redis prévu mais pas utilisé) |
| Tests | Vitest |
| Gestionnaire | pnpm (monorepo) |

### 13.2 Découpage du monorepo
```text
apps/
  web/        Interface Vue (vues, composants, client API)
  api/        Serveur Fastify : routes, auth, planificateur, stockage Prisma
  worker/     Commandes en ligne : collecte, dédoublonnage, tests de sources, clés push
packages/
  shared/             Types et schémas communs (profil, offre, candidature, kit de lettre, géo)
  db/                 Schéma Prisma, migrations, client, seed et données de démo
  source-connectors/  Connecteurs : France Travail, Adzuna, Jooble, ATS, La Bonne Boîte, JobScraper
  job-normalizer/     Normalisation par source, salaire, contrat, texte, lecture d'annonce collée
  skills/             Dictionnaire de compétences et extraction (+ compétences propres au CV)
  scoring/            Règles, signaux, score, hash du profil
  cv-tailor/          CV adapté : notation, choix des morceaux, choix manuels, contrôles, ajustement (pur, sans base)
  cv-render/          CV adapté : modèles HTML une / deux colonnes, mesure de la page, PDF via Edge, relecture du PDF
  pipeline/           Collecte, ingestion, dédoublonnage, planification, quotas, expiration, suivi des mails
  routing/            Géocodage, adresse des entreprises, itinéraires PRIM (transports) et OSRM (voiture), cache
  ai/                 Client Ollama et usages IA (analyse, lecture, lettre, mails)
  notifications/      E-mail, Web Push, IMAP, mise en forme, envoi sans doublon
extension/            Extension Chrome / Edge
tools/jobscraper/     Outil Python externe
scripts/              Lancement Windows (PowerShell / VBS), raccourci, icône
docs/                 Mode d'emploi, JobScraper, analyse initiale, ce descriptif
```

### 13.3 Choix de conception
- **Interfaces de stockage** (`stores.ts`) séparées de Prisma : les tests de l'API tournent sans base.
- **Hash de contenu** (`contentHash`) : toute modification (annonce complète, corrections) change le hash, ce qui recalcule le score et périme l'analyse IA et la lettre.
- **Deux files de collecte** : sources API d'un côté, JobScraper (lent) de l'autre ; elles ne se bloquent pas.
- Collecte « plantée » détectée et marquée en échec (15 min, 90 min pour JobScraper).

---

## 14. Base de données

PostgreSQL, 18 migrations. Principales tables :

| Table | Rôle |
|---|---|
| `User`, `Session` | Compte et sessions |
| `Profile` | Profil (JSON validé) et point de départ |
| `Job` | L'offre normalisée, avec annonce complète collée (`fullText`, `fullInfo`) et corrections manuelles (`userEdits`) |
| `JobSourceLink` | Liens vers chaque source d'une offre |
| `JobScore` | Cache des scores |
| `JobAnalysis` | Analyses IA |
| `JobEvent` | Historique des changements de statut (date de candidature) |
| `LetterKit`, `CoverLetter` | CV, lettre exemple, règles ; lettres générées et éditées |
| `TravelEstimate`, `GeocodeCache`, `TravelCache` | Trajets et caches |
| `CollectionRun`, `SourceRun`, `SourceState` | Historique des collectes, état et rythme de chaque source |
| `ApiQuota` | Compteurs de quotas (Jooble) |
| `CompanyTarget` | Pages carrières suivies |
| `Notification`, `NotificationSettings`, `PushSubscription` | Notifications |
| `CompanyLead`, `SpontaneousApplication` | Entreprises et candidatures spontanées |
| `ApplicationMail`, `MailCursor` | Mails de réponse rattachés, curseurs IMAP |
| `CvMaster` | CV complet découpé en morceaux (JSON validé par `CvMasterSchema`), empreinte `contentHash` |
| `TailoredCv` | CV adapté par offre et par modèle : brouillon (choix, notes, contrôles), choix manuels, version des règles, empreintes CV / offre, statut (`DRAFT`, `VALIDATED`, `EXPORTED`), chemin du PDF, dates d'export et d'envoi |

Statuts d'une offre : `NEW`, `SEEN`, `SAVED`, `APPLIED`, `REJECTED`, `EXPIRED`, `IGNORED`.

---

## 15. API (routes du serveur)

Toutes les routes, sauf `health` et la connexion, demandent d'être connecté.

| Domaine | Routes |
|---|---|
| Système | `GET /api/health`, `POST /api/system/stop`, `POST /api/presence` |
| Auth | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Offres | `GET /api/jobs` (filtres : score, statut, zone, source, texte, tri, pagination), `GET /api/jobs/:id`, `POST /api/jobs/:id/status · save · apply · ignore` |
| Compléter / corriger | `PUT · DELETE /api/jobs/:id/full-text`, `PUT /api/jobs/:id/edits`, `POST /api/jobs/find-abridged` |
| Offres manuelles | `GET · POST /api/jobs/manual`, `POST /api/jobs/manual/analyze`, `POST /api/jobs/manual/ai-read`, `DELETE /api/jobs/manual/:id` |
| Collecte | `POST /api/jobs/refresh`, `GET /api/collection/status` |
| IA | `GET /api/ai/status`, `GET · POST /api/jobs/:id/analysis`, `GET · POST /api/ai/auto`, `POST /api/ai/auto/feed` |
| Lettres | `GET · PUT /api/letter-kit`, `GET · POST · PUT /api/jobs/:id/letter`, `POST /api/jobs/:id/letter/pdf` |
| Candidatures | `GET /api/applications`, `POST /api/applications/check`, `POST /api/applications/mails/:id/dismiss` |
| Entreprises | `GET /api/leads`, `GET · PUT /api/leads/settings`, `PUT /api/leads/filters`, `POST /api/leads/emails`, `PATCH /api/leads/:id` |
| Spontanées | `GET /api/leads/:id/application`, `POST …/application/letter`, `PUT …/application`, `POST …/application/send` |
| CV complet | `GET · PUT /api/cv-master`, `POST /api/cv-master/import-seed`, `POST /api/cv-master/variants/:ref/validate`, `GET /api/cv/templates`, `GET /api/cv/skills` |
| CV adapté | `GET · POST · PUT /api/jobs/:id/cv`, `GET /api/jobs/:id/cv/preview`, `POST /api/jobs/:id/cv/pdf` (débit limité), `POST /api/jobs/:id/cv/open-folder` |
| Profil | `GET · PUT /api/profile` |
| Sources | `GET /api/sources`, `PUT /api/sources/:source`, `GET · POST /api/companies`, `PATCH · DELETE /api/companies/:id` |
| Notifications | `GET · PUT /api/notifications/settings`, `POST /api/notifications/subscribe · unsubscribe`, `GET /api/notifications` |

---

## 16. Tâches automatiques

Tant que l'application tourne :

| Tâche | Fréquence |
|---|---|
| Collecte des sources API | Planificateur toutes les `CRON_INTERVAL_MINUTES` (30 min) ; chaque source a son propre rythme et son backoff |
| File JobScraper | 1 fois par jour par défaut (15 min minimum) |
| Expiration des offres | Toutes les 6 h |
| Suivi des mails | Toutes les 15 min |
| Vérification IA des meilleures offres | À l'affichage de la liste, une offre à la fois |
| Trajet | À l'ouverture d'une offre, et pour les nouvelles offres qui pourraient être notifiées |

---

## 17. Sécurité et données personnelles

- Authentification par mot de passe (haché avec **argon2**), session en cookie `SameSite=Strict`, contrôle de l'origine des requêtes (contre le CSRF).
- **helmet** (en-têtes de sécurité), **limitation de débit** sur les routes sensibles (connexion, envoi de mails).
- Toutes les entrées validées avec **zod** ; liens externes filtrés (`safeUrl`) ; identifiants des pages carrières au format strict (pas d'injection d'URL).
- Secrets uniquement dans `.env`, jamais dans Git (modèle commenté : `.env.example`).
- Données 100 % locales : base sur le PC, IA locale, boîte mail en lecture seule, extension limitée à localhost.
- Sauvegardes de la base dans `data/backups/`.

---

## 18. Lancement, configuration, outils

### Lancement
- **Double-clic sur « Lancer Job Radar.cmd »** (ou le raccourci du Bureau) : démarre la base (intégrée, sans Docker), Ollama, installe les mises à jour et les migrations, lance l'API et le site **en arrière-plan sans fenêtre**, puis ouvre http://localhost:5173. Journal dans `logs/job-radar.log`. S'il tourne déjà, il redémarre tout.
- **Arrêt** : bouton « Arrêter Job Radar » dans le menu.
- À la main : `pnpm db:server` puis `pnpm dev`.

### Variables principales (`.env`)
Base (`DATABASE_URL`…), France Travail, Adzuna, Jooble, SMTP / IMAP, `NOTIFY_EMAIL_TO`, compte initial, `APP_URL`, `SESSION_SECRET`, planificateur, JobScraper (`JOBSCRAPER_ENABLED`, chemin, délai), `MAIL_TRACKING_ENABLED`, seuil de notification, clés VAPID, `PRIM_API_KEY`, `OSRM_URL` (facultatif), Ollama.

### Commandes utiles
| Commande | Rôle |
|---|---|
| `pnpm dev` | API + site |
| `pnpm collect` | Collecte immédiate en ligne de commande |
| `pnpm jobs:dedupe` | Fusionne les doublons existants |
| `pnpm db:migrate` / `db:studio` / `db:demo` | Migrations, tableau de la base, fausses offres |
| `pnpm ft:test`, `sources:test`, `travel:test`, `lbb:test`, `jooble:test`, `ai:test`, `jobscraper:test` | Vérifier chaque service externe |
| `pnpm setup:push` | Générer les clés Web Push |
| `pnpm cv:test <idOffre> [une-colonne ou deux-colonnes]` | Affiche le CV adapté d'une offre (morceaux, notes, écartés, contrôles) sans créer de PDF |
| `pnpm check` | Compilation + tests rapides |
| `pnpm test:int` | Tests avec une vraie base (`jobradar_test`, séparée) |

---

## 19. Tests et qualité

- **615 tests** rapides (Vitest, 47 fichiers), sans base de données : normalisation, dédoublonnage, salaire, contrat, expérience, compétences, score (cas figés : offre parfaite, trop senior, salaire faible, trop loin, non-CDI…), routes de l'API, IA (simulée), lettres, PDF, mails, notifications, extension.
- **Tests d'intégration** avec PostgreSQL (source → normalisation → base, dédoublonnage, suivi des mails, notifications) et avec Edge (CV : une page, texte lisible, ordre des retraits, ressemblance avec le CV de référence).
- TypeScript strict sur tout le monorepo (`pnpm typecheck`).
- Règle : le score ne change jamais sans une nouvelle version des règles ; le choix du CV adapté non plus (`CV_RULES_VERSION`).

---

## 20. Coûts

**0 €.** Toutes les briques sont gratuites : APIs officielles en offre gratuite (France Travail, Adzuna, Jooble, La Bonne Boîte, Géoplateforme, PRIM), IA locale Ollama, Gmail, PostgreSQL et Docker en local. Les quotas sont gérés par l'application (Jooble 500 à vie, PRIM 800 par jour).

---

## 21. Limites connues et pistes

- **Adzuna / Jooble** ne donnent qu'un extrait : il faut compléter l'annonce (extension ou copier-coller) pour un score fiable.
- **Jooble** : quota de 500 appels à vie par clé (environ 8 mois avec 2 zones), puis nouvelle clé.
- **Trajet** : calculé en Île-de-France via PRIM ; ailleurs ou sans adresse précise, « non calculé ». Corriger la ville à la main ne recalcule pas le trajet.
- **JobScraper** : scraping de sites tiers, désactivé par défaut et lent ; risque de blocage d'IP en dessous de 15 min.
- **IA locale** : 5 à 40 s par tâche selon l'usage ; qualité limitée par la taille du modèle.
- **Redis** est lancé par Docker Compose mais pas utilisé (pas de file BullMQ : le planificateur est en mémoire).
- **Un seul utilisateur** ; pas prévu pour être mis en ligne tel quel (HTTPS à ajouter pour la production).
- Pistes du cahier des charges non faites : Discord / Telegram, filtres avancés (salaire minimum, technologie, date de publication) dans l'interface, collecte adaptative selon l'activité de chaque source.

---

## 22. CV adapté à l'offre

Pour une offre, un CV d'**une page** qui met en avant ce que Chahine a **réellement** fait et qui colle le plus à l'offre, assemblé à partir du **CV complet** (page `/cv`).

**Principes** : rien d'inventé (toutes les phrases viennent mot pour mot de versions validées du CV complet) ; **pas d'IA** pour rédiger ni choisir ; déterministe (version des règles `CV_RULES_VERSION`, actuellement `2026-10-07.2`) ; rien n'est exporté sans validation à l'écran ; les contrôles bloquent ; données perso hors de Git (CV complet en base, fichier de départ et PDF de référence dans `data/cv/`, ignoré par Git).

### 22.1 Ce qu'on lit de l'offre
Compétences exigées et « plus » de l'analyse IA si elle est à jour (sinon tout ce que le dictionnaire trouve est « exigé », avec un avertissement), toutes les compétences citées, l'intitulé, le type de poste (frontend, backend, full stack, mobile, autre ; d'après le titre puis les compétences), et si l'annonce n'est qu'un extrait.

### 22.2 Notation et choix
- Par compétence d'un morceau : exigée 10, « plus » 4, seulement citée 2 ; une fois par morceau ; niveau « cours » × 0,5 ; ce qui a été fait par l'équipe seulement (`teamOnlySkills`) ne compte pas.
- **Expériences** : toutes, de la plus récente à la plus ancienne. Lignes « toujours » en tête, puis les lignes utiles par note décroissante jusqu'au maximum, au moins le minimum.
- **Projets** : par note, entre le minimum et le maximum (un projet à 0 point seulement pour atteindre le minimum).
- **Compétences** : jamais une compétence interdite ; groupes les plus utiles d'abord ; dans un groupe : exigées, « plus », puis par niveau.
- **Titre** : celui du type de poste qui partage le plus de compétences exigées, sinon le titre par défaut ; suffixe facultatif « | Vue.js, Java » (compétences exigées faites en entreprise d'abord, puis en projet).
- **Profil** : celui du modèle et du type de poste. **Version de phrase** : celle du style du modèle (verbe / nom), sinon l'autre (« style mélangé »).
- **Remplacement de libellé** : une compétence écrite autrement dans l'offre (« VueJS », « Node JS ») peut prendre cette forme dans les listes de compétences et de technologies, jamais dans les phrases, et jamais par une forme plus courte déjà contenue dans le libellé (« Docker Compose » reste « Docker Compose ») ; chaque remplacement est affiché.
- Les compétences propres au CV (Vuex, Vite, ARIA, Postman, DDD…) sont dans `packages/skills/src/cv-skills.ts`, à part du dictionnaire du score : le score des offres ne change pas.

### 22.3 Contrôles (bloquants)
1. Chaque phrase vient du CV complet ; 2. aucune compétence interdite (tous les synonymes) ; 3. mots forts (« maîtrise », « expert »…) seulement à côté d'une compétence autorisée ; 4. nom, téléphone, e-mail, ligne Bac+5, formations et expériences présents ; 5. rien de « vu en cours » dans le titre, le profil ou l'expérience ; 6. aucune phrase « à valider » ; 7. une seule page ; 8. texte du PDF lisible (nom, e-mail, titre).
Avertissements (non bloquants) : annonce incomplète, analyse IA absente ou périmée, style mélangé, moins de 2 compétences exigées couvertes, compétences exigées absentes.

### 22.4 Rendu et PDF
- Deux modèles HTML (`packages/cv-render`) : **une colonne** (rubriques bleues soulignées, compétences en lignes « Groupe : … », dates après le rôle) et **deux colonnes** (dates à gauche, colonne Compétences / Langues / Loisirs, technos des projets en bleu), d'après les CV de référence. Polices Liberation si leurs fichiers sont dans `packages/cv-render/fonts/`, sinon Arial / Times New Roman (mêmes dimensions).
- PDF par **Microsoft Edge** sans fenêtre (Chrome sinon), un seul navigateur réutilisé. Texte sélectionnable.
- **Ajustement à une page**, dans cet ordre fixe : loisirs → projet le moins bien noté → ligne « si utile » la moins bien notée → compétences « cours » à 0 point → description courte d'un projet (une colonne). Jamais de police ou de marge réduite ; ce qui a été remis à la main n'est pas retiré.
- **Remplissage** : s'il reste de la place, les projets puis les lignes laissés de côté reviennent un à un (par note), sans dépasser la page ni les maximums, et jamais ce qui a été retiré à la main (« place libre sur la page » dans les explications).
- Fichiers (réglables au point 6 de « CV & lettre ») : `<dossier des CV, sinon des lettres>/<Entreprise>_<AAAA-MM-JJ>/MEHADJI_CHAHINE.pdf`, avec `_ATS` pour la version ATS si les deux modèles sont dans le même dossier.
- **Périmé** : un CV adapté est « à refaire » si les règles, le CV complet ou l'offre changent ; rien n'est recalculé en silence (bandeau « Régénérer », choix manuels conservés).
