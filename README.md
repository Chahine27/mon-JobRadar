# Job Radar

Application personnelle de recherche d'emploi, qui tourne sur un petit serveur AWS (offre gratuite) et s'utilise depuis le navigateur du PC ou du téléphone.
Elle collecte des offres sur plusieurs sites, les note selon mon profil, me prévient quand une bonne offre arrive et m'aide à postuler.

> **Comment ce projet a été fait.** Job Radar a été conçu et piloté par moi, Chahine Mehadji, et codé par l'IA **Claude Code**.
> Je n'ai pas écrit le code moi-même. J'ai fixé les besoins (cahier des charges : [docs/CAHIER-DES-CHARGES.md](docs/CAHIER-DES-CHARGES.md)), discuté longuement de la méthode et des priorités, donné à l'IA les informations dont elle avait besoin, puis testé chaque fonction pour dire ce qui marchait et ce qui ne marchait pas.

## Ce que fait l'application

1. **Collecte des offres** automatiquement, toutes les quelques minutes : France Travail, Adzuna, Jooble, pages carrières d'entreprises (Greenhouse, Lever, Ashby, Recruitee, Workable, Personio) et, en option, LinkedIn, Indeed, HelloWork et Welcome to the Jungle.
2. **Supprime les doublons** : une offre publiée sur plusieurs sites n'apparaît qu'une fois. Deux annonces d'un même site ne sont fusionnées que si leur texte est le même.
3. **Note chaque offre** sur 100 selon mon profil : technologies, expérience demandée, contrat, salaire, lieu, télétravail et temps de trajet. Chaque note est expliquée.
4. **Prévient** par e-mail ou par notification du navigateur quand une offre dépasse un certain score. Une offre arrivée sans description (LinkedIn, HelloWork) attend que sa page soit lue avant de déclencher un mail.
5. **Aide à postuler** :
   - lettre de motivation écrite par l'IA à partir de mon parcours et de l'annonce, puis vérifiée phrase par phrase ;
   - CV adapté à l'offre, exporté en PDF d'une page ;
   - candidatures spontanées : recherche d'entreprises proches (La Bonne Boîte), lettre et envoi par e-mail ;
   - suivi des réponses reçues dans ma boîte mail (réponse, refus, message d'absence), relance groupée des candidatures spontanées.
6. **Ajout d'une offre à la main** : je colle une annonce ou son lien (le serveur lit la page), ou je l'envoie en un clic grâce à une extension Chrome/Edge.
7. **Suivi des candidatures** : statuts, barre de recherche (entreprise, poste, lieu, site, mails), candidature sur offre sans nouvelle depuis 21 jours classée « Sans réponse » (pas de relance : seules les spontanées se relancent).
8. **Statistiques** : compétences les plus demandées, expérience exigée, efficacité de chaque source.
9. **Signaler un souci** : le bouton « Copier l'offre » copie toute l'offre en JSON (sources, description, score détaillé, avis de l'IA) pour la donner à Claude Code.

Le site est adapté au téléphone (barre de navigation en bas, pages compactes).

## Les fonctions en détail

### Offres (page d'accueil)

- Date de la dernière collecte, nombre de nouvelles offres et bouton **« Actualiser maintenant »**. La liste se met à jour seule pendant la collecte.
- **Filtre par source** (France Travail, Adzuna, Jooble, LinkedIn…, « Ajoutées par moi »), avec l'état de chaque source et le délai avant sa prochaine collecte.
- **Filtre par lieu** : dans ma zone, full remote, lieu non précisé.
- **Filtre par statut** : actives, nouvelles, sauvegardées, ignorées, expirées.
- Score minimum, contrat, recherche dans le texte, tri par score ou par date, affichage des offres masquées. Les filtres sont gardés d'une visite à l'autre.
- Chaque carte montre le score, le poste, l'entreprise, le lieu, le contrat, le salaire, le télétravail, les compétences que j'ai ou qu'il me manque, la source et la date. Elle signale aussi une annonce incomplète (« score approximatif ») et un score baissé par l'IA (« 91 → 50 % »).

### Fiche d'une offre

- Toutes les infos de l'offre, l'adresse avec un lien vers la carte et le **temps de trajet**.
- **Modifier les infos** : corriger le poste, l'entreprise, la ville, le contrat, le télétravail, le salaire ou l'expérience. Mes corrections ne sont jamais écrasées par la collecte et peuvent être annulées.
- **Compléter l'annonce** quand la source ne donne qu'un extrait (Adzuna, Jooble) : je colle la page entière, et le score, l'IA et la lettre utilisent le texte complet.
- Un bouton par site où l'offre est publiée, puis Sauvegarder, Postuler, Ignorer.
- **Avis de l'IA** : adéquation forte, moyenne ou faible, avis écrit, compétences exigées et « plus » lus dans l'annonce.
- **Explication du score** : pourquoi l'offre correspond, points de vigilance, détail du calcul point par point, plafonds appliqués.
- **Compétences** : celles que j'ai et celles qui manquent, avec « + je l'ai » qui l'ajoute au profil et recalcule le score.
- **« Pas pour moi »** : ignore l'offre et peut créer une règle pour les suivantes (techno non voulue, métier hors sujet, entreprise).
- **Lettre de motivation** : écriture par l'IA, encadré « À vérifier avant d'envoyer », modification, copie, PDF.
- **CV pour cette offre** : voir plus bas.
- **Postuler** : je choisis le canal et le CV envoyé. Un doublon (même offre déjà postulée ailleurs) est signalé.
- **« Copier l'offre »** : copie toute l'offre en JSON pour signaler un souci.

### Ajouter une offre

- Coller **le texte** d'une annonce ou **son lien** : le serveur lit la page, puis l'IA remplit le formulaire (poste, entreprise, lieu, contrat, salaire, expérience, télétravail) que je vérifie.
- Si l'offre existe déjà sous forme d'extrait, Job Radar propose de la compléter au lieu de créer un doublon.
- **Extension Chrome/Edge** (dossier `extension/`) : un clic ou **Alt + Maj + J** sur la page d'une offre (LinkedIn, Indeed, HelloWork…) l'envoie à Job Radar, qui la lit, l'ajoute et l'analyse.

### Candidatures

- Page d'accueil avec des compteurs : candidatures actives, envoyées, en attente de décision, entretiens, refus reçus, sans réponse.
- **À suivre en priorité** et **activité récente** (mails reçus, relances, changements d'étape).
- Onglets : sur une offre, spontanées, à relancer, à compléter, refusées, e-mails reconnus.
- **Barre de recherche** sur toutes les candidatures : entreprise, poste, lieu, site d'annonce, objet et expéditeur des mails.
- Étapes : envoyée, accusé de réception, entretien, proposition, refusée, relancée. Elles avancent **toutes seules** grâce aux mails reçus.
- Une candidature sur offre sans nouvelle depuis **21 jours** passe en « Sans réponse » (une offre ne se relance pas). Elle reprend son étape si une réponse arrive.
- Un mail rattaché par erreur peut être écarté (« Pas lié »). Un mail incertain est proposé « à vérifier ».

### Suivi des mails

- Lecture de la boîte Gmail **en lecture seule** : rien n'est marqué comme lu ni déplacé.
- Réception **en direct** (le serveur est prévenu dès qu'un mail arrive), et vérification à la demande.
- Une IA gratuite lit chaque réponse possible : à quelle candidature elle se rattache, son type (accusé, entretien, proposition, refus, absence) et un résumé. Les onglets Promotions et Réseaux sociaux sont ignorés, et les mails sans rapport ne sont pas gardés.
- La réponse est lue sans le message d'origine cité en dessous.
- Un **message d'absence** est reconnu avec sa date de retour, et la relance est reproposée après.
- L'étape d'une candidature ne recule jamais, sauf pour un refus.

### Candidatures spontanées

- **Entreprises** : liste d'entreprises qui ont de bonnes chances de recruter des développeurs (La Bonne Boîte, France Travail), dans une zone au choix (ville et rayon, ou départements).
- Tri par potentiel d'embauche ou par distance, filtres par statut (à contacter, contactée, relancée, entretien, pas intéressé, ignorée) et par adresse e-mail trouvée ou non.
- **Candidature à une entreprise** en trois étapes : lettre écrite par l'IA gratuite (sans rien inventer sur l'entreprise), e-mail (objet, texte, destinataire), envoi depuis Gmail avec la lettre et le CV en PDF. Rien ne part sans un clic.
- **Candidatures en lot** : écrire plusieurs lettres d'un coup, puis les relire et les envoyer une par une ou toute une sélection.
- **Relance** proposée après 7 jours. **« Relancer les 10 plus anciennes »** envoie les relances en arrière-plan, chacune dans son fil, avec une barre de progression.

### CV adapté à l'offre

- Pour chaque offre, un **CV d'une page** assemblé à partir de mon **CV complet**, sans IA : chaque phrase vient d'une version que j'ai validée.
- Deux modèles : **ATS** (une colonne, lisible par les logiciels de tri) et **e-mail** (deux colonnes).
- Les morceaux du CV (lignes d'expérience, projets, compétences) sont notés selon les compétences exigées par l'offre, puis les meilleurs sont gardés jusqu'à remplir la page.
- À l'écran : aperçu et explication de chaque choix (« gardée car : Vue.js exigé »), éléments laissés de côté avec « Remettre », compétences demandées absentes du CV.
- Je peux retirer, remettre, changer de version ou de titre, monter ou descendre un élément.
- **Contrôles bloquants** avant l'export : phrases toutes issues du CV complet, aucune compétence interdite, rien de « vu seulement en cours » présenté comme une expérience, une seule page, texte du PDF lisible.
- Le CV est signalé « à refaire » si l'offre ou le CV complet change.

### CV complet

- Mon CV découpé en morceaux : en-tête, titres, profils, expériences, projets, compétences, formation, langues et loisirs.
- Chaque morceau a ses versions de phrase, ses compétences, son niveau (entreprise, projet, cours) et sa règle (toujours ou si utile).
- Une phrase « à valider » n'est jamais utilisée tant que je ne l'ai pas validée.

### CV & lettre

- **Blocs d'histoires vraies** : ce que j'ai réellement fait, que l'IA utilise comme matière pour les lettres.
- Règles d'honnêteté, en-tête et signature.
- **Mes PDF** : le CV envoyé avec les candidatures spontanées est gardé en base.

### Profil

Tout ce qui décide du score : compétences maîtrisées ou vues en projets, technos préférées, mots-clés de recherche, contrats acceptés, expérience visée, salaire cible et minimum, zones de recherche, règles bonus et malus personnelles (mot du titre, mot de l'annonce, entreprise), seuils de l'IA et des notifications, domicile et gare d'arrivée pour le trajet.

### Sources et réglages

- **Sources** : activer ou couper chaque site, choisir sa fréquence, voir son état et sa dernière erreur, compteur du quota Jooble. Ajout d'une page carrières d'entreprise en collant son adresse.
- **Réglages** : notifications du navigateur et par e-mail, envoi de test, historique, relance manuelle d'une source en erreur.

### Statistiques

Compétences les plus demandées, ce qui me manque autour de mes compétences, ce qui me débloquerait le plus d'offres, expérience demandée et efficacité de chaque source.

## Comment une offre est traitée

1. **Collecte** : chaque source a son rythme et ses limites. Une source en panne ne bloque pas les autres et attend un peu plus avant de réessayer. LinkedIn est espacé et s'arrête au premier refus.
2. **Mise au même format** : contrat, salaire ramené en brut annuel, expérience demandée, lieu, télétravail et technologies (grâce à un dictionnaire de compétences avec leurs synonymes).
3. **Doublons** : une offre vue sur trois sites devient une seule offre avec trois liens.
4. **Score** sur 100, calculé par des règles fixes :
   - la note technique compte la part des technos principales de l'offre que je maîtrise, celles du titre comptant triple ;
   - des bonus et malus en points : techno préférée, poste junior, salaire, télétravail complet, expérience demandée trop haute, trajet trop long, fonction voisine du développement, mes propres règles ;
   - des plafonds : contrat hors profil, poste qui n'est pas du développement, techno principale que je n'ai pas, adéquation faible ;
   - les offres hors sujet, hors zone, senior ou avec un contrat non voulu sont **masquées**, mais restent visibles sur demande.
   - Une information absente (salaire, trajet…) ne donne ni bonus ni malus, et rien n'est inventé.
5. **Relecture par l'IA** des offres les mieux notées. Elle peut baisser la note, jamais la monter.
6. **Trajet** : en transports depuis ma gare d'arrivée pour l'Île-de-France (PRIM), en voiture depuis le domicile ailleurs (OSRM). Le lieu vient de l'adresse de l'annonce, sinon de l'établissement de l'entreprise, sinon du centre de la ville.
7. **Alerte** par e-mail et notification du navigateur si le score dépasse le seuil, jamais deux fois pour la même offre.
8. **Expiration** : une offre qui a disparu de toutes ses sources passe en « expirée ». Les offres sauvegardées ou postulées ne sont jamais touchées.

Toute règle de score ou de lecture a un numéro de version : quand elle change, elle est réappliquée aux offres déjà en base.

## L'IA

L'IA principale est **Claude**, en ligne : Haiku pour relire les offres et vérifier les lettres, Sonnet pour écrire les lettres.
Elle est payée avec des crédits prépayés, sans recharge automatique, donc la dépense ne peut pas dépasser ce qui a été mis. Une analyse coûte environ 0,06 centime, une lettre quelques centimes. Le coût de chaque appel est écrit dans le journal.
Si Claude ne répond pas ou si le crédit est épuisé, des IA gratuites en ligne prennent le relais : **Ollama Cloud** (`gpt-oss:120b`), **Groq** (`gpt-oss-120b`, pour les analyses seulement) puis **Mistral** (`ministral-14b`). Le tri des mails et les lettres spontanées passent directement par ces IA gratuites.
Sans aucune clé dans le `.env`, tout tourne avec [Ollama](https://ollama.com) installé sur la machine, gratuitement (modèle `gemma4:e4b`, ou `OLLAMA_LETTER_MODEL` pour les lettres).

L'IA sert à :

- **relire les offres les mieux notées** et donner un avis (adéquation forte, moyenne ou faible). Cet avis peut **baisser** la note, jamais la monter : la note de base vient de règles fixes, testées et prévisibles. L'IA corrige aussi le contrat, le salaire et l'expérience mal lus par le code, et complète l'adresse pour le trajet ;
- **lire une annonce collée** et remplir le formulaire (titre, entreprise, contrat, salaire…) ;
- **écrire les lettres de motivation**, en trois temps : Haiku choisit l'angle et les histoires vraies à raconter, Sonnet écrit la lettre une seule fois, puis un correcteur compare chaque phrase à mon profil et à l'annonce. Une phrase non prouvée bloque l'envoi jusqu'à correction ou validation ;
- **trier les mails reçus** (réponse d'un recruteur, refus, message automatique, absence…).

Les réponses de l'IA doivent suivre un format imposé (JSON). Elles sont vérifiées avant d'être utilisées. Les lettres sont aussi relues par des règles fixes : seulement des virgules et des points, une virgule au plus par phrase, pas de mots interdits, pas de technologie absente du CV, pas de chiffre inventé, pas de phrase recopiée de l'annonce.

## Ce qui marche bien

Je me sers de toutes les fonctions au quotidien, et l'outil fait ce que je voulais : réunir les offres au même endroit, sans doublons, triées selon ce qui me correspond vraiment, et m'éviter de refaire les mêmes recherches chaque jour.

Le projet compte **860 tests automatiques**, tous réussis, lancés à chaque mise en ligne.

## Ce qui ne marche pas encore bien

- **Les lettres de motivation.** Elles s'améliorent depuis que Claude les écrit et qu'un correcteur vérifie les faits, mais les règles changent encore souvent et il faut toujours relire avant d'envoyer.
- **La génération de CV.** Elle fonctionne, mais elle n'est pas encore assez pratique à utiliser ni optimisée.
- **Une seule personne.** L'application est prévue pour un seul utilisateur.

## Ce que je compte améliorer

1. **L'interface.**
2. **La génération de CV** : la rendre plus pratique et plus rapide.

## Hébergement et mise en ligne

- L'application tourne sur un serveur **AWS** (offre gratuite), accessible depuis mes appareils par **Tailscale** (réseau privé).
- Chaque envoi du code sur la branche `main` lance **GitHub Actions** : vérification des types, tests, construction du site, puis mise en ligne sur le serveur ([.github/workflows/deployer.yml](.github/workflows/deployer.yml)).
- La base de données est sauvegardée chaque jour sur le PC.
- Un **bac à sable** sur le serveur ([scripts/sandbox.sh](scripts/sandbox.sh)) teste le code du PC sur une copie de la vraie base, sans collecte, sans mails et sans clé Claude.

## Technologies

- **Langage** : TypeScript (Node.js 24)
- **Site** : Vue.js 3, Vite
- **Serveur** : Node.js, Fastify, Zod
- **Base de données** : PostgreSQL, Prisma 7
- **IA** : Claude (Haiku, Sonnet), Ollama Cloud, Groq et Mistral en secours ; Ollama local sans clé
- **PDF** : Playwright (Edge, Chrome ou Chromium sans fenêtre) pour les CV, pdfkit pour les lettres
- **Tests** : Vitest
- **Mise en ligne** : GitHub Actions, AWS, Tailscale
- **Sources en option** : Python (JobSpy)

## Organisation du code

```text
apps/
  api/        serveur : routes, planification des collectes, branchement de l'IA
  web/        site (Vue)
  worker/     petites commandes de collecte et de test
packages/
  source-connectors/  un connecteur par site d'offres
  job-normalizer/     met toutes les offres au même format
  pipeline/           collecte, enregistrement, doublons, suivi des mails
  scoring/            calcul de la note d'une offre
  ai/                 appels aux IA, analyse des offres, lettres et leur relecture, tri des mails
  cv-tailor/          choix du contenu du CV selon l'offre
  cv-render/          mise en page et PDF du CV
  skills/             dictionnaire des compétences et repérage dans les annonces
  routing/            temps de trajet et géolocalisation
  notifications/      e-mails et notifications du navigateur
  shared/             types communs (profil, offre, candidature, lettre)
  db/                 schéma de la base et migrations
extension/    extension Chrome/Edge « Envoyer à Job Radar »
tools/        scraper Python des sources en option (JobSpy)
scripts/      mise en ligne, bac à sable, sauvegarde de la base
docs/         cahier des charges, description détaillée, mode d'emploi
```

## Pour développer

Il faut Node.js 20 ou plus et pnpm.

```bash
pnpm install
pnpm dev          # API (port 3000) et site (http://localhost:5173)
pnpm check        # types et tests, à lancer avant chaque commit
pnpm test:int     # tests sur une vraie base PostgreSQL
```

Les clés d'API vont dans un fichier `.env`, sur le modèle de `.env.example`.

Plus de détails : [docs/DESCRIPTIF.md](docs/DESCRIPTIF.md) (fonctionnement complet) et [docs/LANCEMENT.md](docs/LANCEMENT.md) (ancien mode d'emploi sur le PC).

## Licence

Code publié **uniquement pour être consulté**. Tous droits réservés : voir [LICENSE](LICENSE).
