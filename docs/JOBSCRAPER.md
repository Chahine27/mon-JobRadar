# Intégration JobScraper

## Architecture

JobScraper reste un outil Python externe. Job Radar l'appelle comme sous-processus depuis `packages/source-connectors/src/jobscraper.ts`, lui passe une recherche et lit son export JSON temporaire. Le connecteur adapte chaque `JobOffer` en `RawJob`; le pipeline commun continue ensuite par `normalize()` → `ingest()` → PostgreSQL. Les états, intervalles et erreurs sont ceux de `SourceState`, `CollectionRun` et `SourceRun`.

Chaque plateforme est représentée par une source Job Radar distincte (`jobscraper:linkedin`, `jobscraper:hellowork`, `jobscraper:francetravail`, `jobscraper:wttj`, `jobscraper:adzuna`). Elles sont créées désactivées, avec un intervalle d'un jour par défaut, réglable jusqu'à 15 minutes minimum (en dessous, risque de blocage de l'adresse IP par les sites). Le connecteur utilise les mêmes mots-clés et zones du profil que les autres sources; le libellé géographique est transmis à JobScraper. Il demande un tri par date, retrie les résultats datés côté Job Radar et écarte les dates connues plus anciennes que la fenêtre demandée. Les dates inconnues restent inconnues et ne sont pas remplacées par l'heure de collecte.

Pour LinkedIn, le connecteur ne passe **pas** `--details` (retiré le 13 octobre 2026). Ce mode faisait une requête de détail par résultat (jusqu'à 25 par recherche) : LinkedIn répondait HTTP 429 et la source restait bloquée. Il remplaçait aussi l'offre de la liste par celle du détail, ce qui perdait la date de publication, collait les mots de la description et transformait « Temps plein » en CDI. La description et la date manquantes sont lues ensuite par `completeJobScraperDescriptions` (page publique `jobs-guest`, une requête par offre, 30 au plus par passage, 1,5 s entre deux). Ce complément passe juste après la collecte, avant les trajets, la vérification IA et les notifications, qui ne traitent ainsi l'offre qu'une fois, complète.

Le processus a un délai maximal configurable. Chaque plateforme échoue indépendamment et le pipeline continue les autres. Le JSON temporaire est écrit sous le dossier temporaire du système puis supprimé, même si la commande échoue.

## Installation

Prérequis déclarés par JobScraper : Python 3.9 ou supérieur. Le dépôt annonce des versions 3.9 à 3.12 dans ses classifiers. L'intégration ne télécharge ni n'installe Python ou ses dépendances.

Cloner le dépôt séparément (il n'est pas recopié dans Job Radar) :

```powershell
git clone https://github.com/Zeffut/JobScraper.git tools/jobscraper
py -3 -m venv tools/jobscraper/.venv
tools/jobscraper/.venv/Scripts/python.exe -m pip install -e tools/jobscraper
```

Sous Linux/macOS, utiliser `python3 -m venv tools/jobscraper/.venv`, puis `tools/jobscraper/.venv/bin/python -m pip install -e tools/jobscraper`.

Le dépôt amont consulté pour cette intégration était au commit `0bb9fa3c863c77e85d58f63c961c401d9aef54b1`. Aucun fichier `LICENSE` n'était présent dans cette copie. Le code amont n'est donc pas redistribué dans ce dépôt; l'utilisateur clone et installe séparément JobScraper. Vérifier les conditions de licence amont avant redistribution ou déploiement.

## Indeed (JobSpy)

JobScraper ne couvre pas Indeed. La source `jobscraper:indeed` appelle à la place `packages/source-connectors/python/indeed.py`, qui utilise [JobSpy](https://github.com/speedyapply/JobSpy) (`python-jobspy`, licence MIT, API mobile d'Indeed, `country_indeed="France"`). Le script accepte les mêmes options que la CLI JobScraper et écrit le même format `JobOffer` : file, intervalle, normalisation et diagnostic sont partagés. Il s'installe dans le même environnement Python :

```powershell
uv pip install --python tools/jobscraper/.venv/Scripts/python.exe python-jobspy
```

Indeed donne la description complète, la date de publication (jour), et souvent le salaire, converti en annuel par le script (mensuel ×12, journalier ×218, horaire ×1607). `is_remote=false` de JobSpy veut seulement dire « pas mentionné » : il est traité comme inconnu. Un refus d'Indeed (HTTP 403) est journalisé par JobSpy et remonté comme erreur de la source.

## Configuration

Dans `.env` :

```env
JOBSCRAPER_ENABLED=false
JOBSCRAPER_PATH=tools/jobscraper
# JOBSCRAPER_PYTHON=C:/chemin/vers/python.exe
JOBSCRAPER_TIMEOUT_MS=120000
```

Pour effectuer une collecte ponctuelle sans planification automatique, installer Python et JobScraper, puis mettre temporairement `SCHEDULER_ENABLED=false` et `JOBSCRAPER_ENABLED=true`. Redémarrer l'API, activer une source à la fois dans la page **Sources**, exécuter le diagnostic puis `pnpm collect`. Après validation, remettre `SCHEDULER_ENABLED=true`; l'intervalle minimal JobScraper est de 15 minutes. Les nouvelles sources restent désactivées en base jusqu'à activation individuelle.

```powershell
pnpm db:migrate
pnpm jobscraper:test
pnpm collect
```

`pnpm jobscraper:test` lance une recherche réelle « développeur » à Paris sur les dernières 24 heures, une source après l'autre. Il affiche une ligne JSON par source avec statut, nombre de résultats, durée et nombre d'annonces contenant chaque champ. Cette commande ne stocke pas les offres dans PostgreSQL. `pnpm collect` passe ensuite par le pipeline normal.

## Mapping JobOffer → RawJob → offre normalisée

| JobScraper | Traitement Job Radar |
|---|---|
| `id`, `source` | `sourceJobId`; source isolée sous `jobscraper:<plateforme>` |
| `url` | `sourceUrl`, lien conservé dans `JobSourceLink` |
| `title`, `company` | Titre et entreprise normalisés |
| `location` | Ville/code postal/département extraits si présents; aucune coordonnée inventée |
| `description` | Description, vide si absente |
| `contract_type` | Converti par le normaliseur partagé; inconnu reste `null` |
| `experience_level` | Conservé comme texte; les années ne sont lues que si la description en donne |
| `remote` | `true` → distant, `false` → présentiel, absent → inconnu |
| `posted_at` | Date de publication analysée; `scraped_at` et `collectedAt` ne la remplacent jamais |
| `salary_min`, `salary_max`, `salary_currency` | Valeurs conservées dans `salaryText` et `rawData`; pas de score salaire car la période n'est pas définie uniformément |
| `skills` | Ajoutés aux technologies avec celles reconnues dans le texte |
| `benefits`, autres propriétés | Conservés dans `rawData`; pas de nouveau champ métier créé |

Le salaire est volontairement exclu des valeurs annuelles normalisées : le modèle amont ne définit pas de période de salaire et mélange des scrapers. Les valeurs d'origine restent consultables dans les données brutes. La publication est conservée depuis `posted_at`; les dates invalides deviennent `null`.

## Champs observés dans le code amont

Cette matrice décrit les chemins du code au commit indiqué ci-dessus, pas la disponibilité garantie par les sites. Les scrapers avalent parfois leurs erreurs et peuvent retourner une liste vide sans signaler la panne. `pnpm jobscraper:test` sert à obtenir les mesures de l'environnement courant.

| Source (mode appelé) | Champs renvoyés par défaut dans le code | Limites visibles dans le code |
|---|---|---|
| LinkedIn (recherche + `--details`) | ID, titre, entreprise, lieu, URL, date parfois détectée; description, contrat, expérience et compétences via le détail | Le détail coûte une requête supplémentaire par offre et peut rester vide si LinkedIn ne l'expose pas. Entreprise ou lieu parfois vides : l'offre est gardée. Salaire et télétravail non renseignés dans le constructeur inspecté. |
| HelloWork | ID, titre, entreprise, lieu, contrat, date parfois détectée | La recherche extrait aussi un texte salaire, mais ne le met pas dans `JobOffer`; description, expérience, remote et skills absents dans le résultat de recherche standard. |
| France Travail | ID, titre, entreprise, lieu, description, contrat, date parfois détectée | Les coordonnées, salaire, niveau et compétences ne sont pas inclus dans la construction `JobOffer` inspectée. Job Radar conserve aussi son connecteur API natif, indépendant. |
| Adzuna | ID, titre, entreprise, lieu, description, bornes de salaire, contrat, date selon la réponse | La période et le caractère estimé ne sont pas propagés au modèle `JobOffer`; Job Radar ne score donc pas ces montants. Expérience, remote et skills non renseignés. |
| Welcome to the Jungle | ID, titre, entreprise, lieu, description, contrat, expérience, remote, bornes de salaire, date parfois détectée | Le type de période salariale n'est pas propagé; les compétences et avantages ne sont pas extraits par le parseur inspecté. |

## Premier essai réel — 5 octobre 2026

Une collecte manuelle a interrogé uniquement LinkedIn, avec les recherches du profil, Paris et l'Oise, les offres des dernières 24 heures et 10 résultats maximum par recherche. Résultat : 35 liens source enregistrés en 28,9 secondes, 34 offres nouvelles, 1 rattachée à une offre déjà connue, aucune rejetée. Les 35 résultats stockés avaient un titre, une entreprise, un lieu et une URL; aucun n'avait une description, une date de publication, un salaire, un contrat, un niveau d'expérience, un indicateur de télétravail, des compétences ou des avantages.

Les six recherches sur l'Oise n'ont donné aucune offre. La CLI amont quitte avant de créer le fichier JSON dans ce cas; le bridge a d'abord journalisé ces recherches vides comme des erreurs de fichier manquant. Le connecteur reconnaît maintenant le message « Aucune offre trouvée » comme une réponse vide valide. Cette correction n'a pas encore été revérifiée par une seconde collecte réelle. HelloWork, France Travail, WTTJ et Adzuna n'ont pas été interrogés en direct dans ce premier essai.

Les objets amont donnent des listes vides par défaut pour `skills` et `benefits`; cette valeur par défaut ne signifie pas que le site ne possède pas l'information. Le diagnostic compte seulement les valeurs non vides réellement présentes.

## Correctif local HelloWork (9 octobre 2026)

HelloWork a renommé la classe de ses étiquettes de carte (`tw-tag-secondary-s` → `tag-secondary-s`) : JobScraper ne lisait plus ni le lieu (toujours « France ») ni le contrat. Dans `tools/jobscraper/src/jobscraper/scrapers/hellowork.py`, le sélecteur des tags est devenu `card.select("div.tw-tag-secondary-s, div.tag-secondary-s")`. Ce clone n'est pas versionné : à refaire après un nouveau `git clone`. Le lieu arrive au format « Beauvais - 60 », lu par le normaliseur (ville + département).

## Vérification des zones par source (9 octobre 2026, « Développeur », Oise)

| Source | Lieu envoyé | Résultat |
|---|---|---|
| France Travail | code département `60` | Correct ; peu d'offres dans l'Oise (3 au total, aucune sur 7 jours) |
| Adzuna | nom du département (« Oise ») | Correct (Beauvais, Compiègne, Creil…) |
| Jooble | nom du département | Correct d'après les offres en base (Beauvais, Compiègne, Chantilly…) |
| LinkedIn | libellé (« Oise ») | Correct (Beauvais, Senlis, Compiègne…) |
| HelloWork | libellé | Correct après le correctif ci-dessus |
| WTTJ | libellé ajouté au texte de recherche | Approché : le mot « Oise » ramène aussi le Val-d'Oise (Cergy) ; le score de zone les départage |
| Indeed | « Oise (60) » (format Indeed) | Correct ; « Oise » seul renvoie 0 offre. Rayon d'environ 80 km |

## Limites et diagnostic

- Le dépôt JobScraper est déclaré en version alpha dans son `pyproject.toml`; les sites peuvent changer leurs pages ou bloquer les requêtes. Une recherche réussie aujourd'hui ne garantit pas sa disponibilité future.
- La CLI lance ses scrapers et exporte un tableau JSON; elle n'expose pas de statut d'erreur structuré par source. Le bridge détecte les exceptions de processus, les timeouts et les lignes de log `ERROR`, mais une erreur absorbée par un scraper peut se présenter comme zéro résultat.
- Les dates LinkedIn/HelloWork/France Travail peuvent être dérivées de libellés relatifs et ne sont pas garanties exactes. Une date non fournie est conservée comme inconnue.
- Le connecteur natif France Travail et Adzuna reste disponible. Les IDs JobScraper sont préfixés par une source distincte; le rapprochement titre/entreprise/ville reste celui de `ingest.ts`.
- Le dépôt amont ne contenait pas de licence à la révision inspectée. Le code n'est pas vendorié ni ajouté en sous-module.
- Le premier essai réel a seulement couvert LinkedIn. Utiliser `pnpm jobscraper:test` après l'installation pour obtenir les statuts, champs disponibles, nombres et durées de toutes les plateformes.
