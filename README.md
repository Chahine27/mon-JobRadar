# Job Radar

Application personnelle de recherche d'emploi, qui tourne entièrement sur mon PC.
Elle collecte des offres sur plusieurs sites, les note selon mon profil, me prévient quand une bonne offre arrive et m'aide à postuler.

> **Comment ce projet a été fait.** Job Radar a été conçu et piloté par moi, Chahine Mehadji, et codé par l'IA **Claude Code**.
> Je n'ai pas écrit le code moi-même. J'ai fixé les besoins (cahier des charges : [docs/CAHIER-DES-CHARGES.md](docs/CAHIER-DES-CHARGES.md)), discuté longuement de la méthode et des priorités, donné à l'IA les informations dont elle avait besoin, puis testé chaque fonction pour dire ce qui marchait et ce qui ne marchait pas.

## Ce que fait l'application

1. **Collecte des offres** automatiquement, toutes les quelques minutes : France Travail, Adzuna, Jooble, pages carrières d'entreprises (Greenhouse, Lever, Ashby, Recruitee, Workable, Personio) et, en option, LinkedIn, Indeed, HelloWork et Welcome to the Jungle.
2. **Supprime les doublons** : une offre publiée sur plusieurs sites n'apparaît qu'une fois.
3. **Note chaque offre** sur 100 selon mon profil : technologies, expérience demandée, contrat, salaire, lieu, télétravail et temps de trajet. Chaque note est expliquée.
4. **Prévient** par e-mail ou par notification du navigateur quand une offre dépasse un certain score.
5. **Aide à postuler** :
   - lettre de motivation écrite par l'IA à partir de mon CV et de l'annonce ;
   - CV adapté à l'offre, exporté en PDF d'une page ;
   - candidatures spontanées : recherche d'entreprises proches (La Bonne Boîte), lettre et envoi par e-mail ;
   - suivi des réponses reçues dans ma boîte mail.
6. **Ajout d'une offre à la main** : je colle une annonce vue ailleurs, ou je l'envoie en un clic grâce à une extension Chrome/Edge.
7. **Statistiques** : compétences les plus demandées, expérience exigée, efficacité de chaque source.

## L'IA locale (Ollama)

Toute l'IA tourne **sur mon PC** avec [Ollama](https://ollama.com) : rien n'est envoyé à un service payant, et le projet ne coûte rien.
Le modèle par défaut est `gemma4:e4b`. On peut en choisir un plus gros pour les lettres (réglage `OLLAMA_LETTER_MODEL`).

L'IA sert à :

- **relire les offres les mieux notées** et donner un avis (adéquation forte, moyenne ou faible). Cet avis peut **baisser** la note, jamais la monter : la note de base vient de règles fixes, testées et prévisibles ;
- **lire une annonce collée** et remplir le formulaire (titre, entreprise, contrat, salaire…) ;
- **écrire les lettres de motivation** ;
- **trier les mails reçus** (réponse d'un recruteur, refus, message automatique…).

Les réponses de l'IA doivent suivre un format imposé (JSON). Elles sont vérifiées avant d'être utilisées. Les lettres sont relues automatiquement par des règles (mots interdits, technologies absentes du CV, chiffres inventés, phrases recopiées de l'annonce…). En cas de problème, l'IA doit corriger sa lettre.

## Ce qui marche bien

Je me sers de toutes les fonctions au quotidien, et l'outil fait ce que je voulais : réunir les offres au même endroit, sans doublons, triées selon ce qui me correspond vraiment, et m'éviter de refaire les mêmes recherches chaque jour.

Le projet compte **662 tests automatiques**, tous réussis.

## Ce qui ne marche pas encore bien

- **Les lettres de motivation.** Le modèle d'IA local est petit, et la qualité des lettres en souffre. Je ne veux pas payer un service d'IA pour un outil que je construis moi-même. Il a donc fallu ajouter beaucoup de règles de correction, et ces règles restent fragiles.
- **La génération de CV.** Elle fonctionne, mais elle n'est pas encore assez pratique à utiliser ni optimisée.
- **Une seule personne.** L'application est prévue pour un seul utilisateur, et le PC doit rester allumé (base de données, IA, création des PDF).

## Ce que je compte améliorer

1. **L'interface.**
2. **La génération de CV** : la rendre plus pratique et plus rapide.

## Technologies

- **Langage** : TypeScript
- **Site** : Vue.js 3, Vite
- **Serveur** : Node.js, Fastify, Zod
- **Base de données** : PostgreSQL (version intégrée, sans Docker), Prisma
- **IA** : Ollama (modèle local)
- **PDF** : Playwright (Edge ou Chrome sans fenêtre) pour les CV, pdfkit pour les lettres
- **Tests** : Vitest
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
  ai/                 appels à Ollama et consignes données à l'IA
  cv-tailor/          choix du contenu du CV selon l'offre
  cv-render/          mise en page et PDF du CV
  routing/            temps de trajet et géolocalisation
  notifications/      e-mails et notifications du navigateur
  db/                 schéma de la base et migrations
extension/    extension Chrome/Edge « Envoyer à Job Radar »
docs/         cahier des charges, description détaillée, mode d'emploi
```

Plus de détails : [docs/DESCRIPTIF.md](docs/DESCRIPTIF.md) (fonctionnement complet) et [docs/LANCEMENT.md](docs/LANCEMENT.md) (mode d'emploi).

## Licence

Code publié **uniquement pour être consulté**. Tous droits réservés : voir [LICENSE](LICENSE).
