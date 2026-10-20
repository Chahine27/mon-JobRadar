# Job Radar — mode d'emploi

> **Depuis le 17/10/2026, Job Radar tourne sur le serveur AWS** et se met à jour tout seul à chaque push sur `main`.
> **Ne pas le lancer aussi sur le PC** (« Lancer Job Radar.cmd », `pnpm dev`) : les collectes et les mails partiraient en double.
> Ce guide décrit l'ancien fonctionnement sur le PC. Il reste utile pour développer en local, avec une base locale.

Ce guide explique comment démarrer l'appli, l'utiliser au quotidien et réparer les problèmes courants.
Toutes les commandes se tapent dans un terminal ouvert dans le dossier `mon JobRadar`.

## 1. Après un redémarrage du PC

**Le plus simple : double-clic sur « Lancer Job Radar.cmd »** (à la racine de `mon JobRadar`), ou sur le raccourci « Job Radar » du Bureau.
Il démarre la base de données (intégrée, sans Docker : fichiers dans `data\postgres`), Ollama, installe les mises à jour (`pnpm install` si besoin,
migrations de la base), lance `pnpm dev` et ouvre http://localhost:5173 tout seul. Si Job Radar tourne déjà, il arrête l'ancienne version et relance tout (pour toujours avoir la dernière version).
Tout tourne **en arrière-plan, sans fenêtre** ; ce qui s'affichait dans la fenêtre est écrit dans `logs/job-radar.log`.
En cas de problème au démarrage, un message s'affiche (par exemple si le port 5173 ou 3000 est pris par un autre programme).
**Pour arrêter : bouton « Arrêter Job Radar » en bas du menu du site** (avec confirmation). La base de données reste allumée en arrière-plan (elle ne consomme presque rien).
Pour créer le raccourci du Bureau (une seule fois) : clic droit sur `scripts\creer-raccourci.ps1` → « Exécuter avec PowerShell ».

À la main, si besoin :

1. Démarre la base de données (dans un terminal à laisser ouvert) :
   ```
   pnpm db:server
   ```
2. Dans un autre terminal, démarre l'appli (serveur + site) :
   ```
   pnpm dev
   ```
3. Ouvre http://localhost:5173 dans ton navigateur et connecte-toi.

Laisse le terminal de `pnpm dev` ouvert : tant qu'il tourne, la collecte des offres se fait toute seule
(toutes les heures), les offres expirées sont nettoyées (toutes les 6 heures) et les alertes partent.

Pour tout arrêter : `Ctrl + C` dans les deux terminaux.

## 2. Au quotidien

| Je veux…                                   | Commande / action                         |
|--------------------------------------------|-------------------------------------------|
| Lancer une collecte tout de suite          | `pnpm collect`                            |
| Voir la base de données dans un tableau    | `pnpm db:studio`                          |
| Voir les offres expirées                   | Tableau de bord → filtre statut « Expirées » |
| Chercher des entreprises (candidature spontanée) | Page « Entreprises »                |
| Garder une offre vue sur LinkedIn, Indeed…  | Page « Ajouter une offre » : colle le titre et le texte |

### Quand une offre est-elle « expirée » ?

- **France Travail** : l'offre n'est plus vue depuis 7 jours **et** l'API confirme qu'elle n'existe plus.
- **Pages carrières (ATS)** : l'offre n'est plus vue depuis 2 jours.
- **Adzuna, Jooble** : l'offre a plus de 45 jours.

Si une offre vient de plusieurs sources, elle n'expire que si **toutes** disent qu'elle a disparu.
Les offres que tu as sauvegardées, auxquelles tu as postulé ou que tu as écartées ne sont jamais touchées.

## 3. Après avoir récupéré une nouvelle version du code

```
pnpm install
pnpm db:migrate
```
Puis relance `pnpm dev`.

## 4. Vérifier que tout marche

| Commande           | Ce qu'elle vérifie                                                    |
|--------------------|-----------------------------------------------------------------------|
| `pnpm check`       | Le code se compile et les tests rapides passent (sans base de données) |
| `pnpm test:int`    | Les tests avec une vraie base (la base doit tourner). Utilise une base à part, `jobradar_test` : tes vraies données ne sont pas touchées |
| `pnpm ft:test`     | Tes identifiants France Travail fonctionnent                          |
| `pnpm sources:test`| Chaque source (France Travail, Adzuna, pages carrières) répond         |
| `pnpm travel:test` | Le calcul du temps de trajet (Géoplateforme + PRIM) répond             |
| `pnpm lbb:test`    | La Bonne Boîte (candidatures spontanées) répond                       |
| `pnpm jooble:test` | Ta clé Jooble marche (fait **1 vrai appel**, compté dans les 500)      |
| `pnpm setup:push`  | Génère les clés pour les notifications dans le navigateur (à faire une fois) |
| `pnpm db:demo`     | Ajoute des fausses offres pour tester l'affichage (`pnpm db:demo:clear` pour les retirer) |

## 5. Problèmes courants

**« Can't reach database server » / erreur de connexion à la base**
→ La base n'est pas lancée : relance Job Radar, ou `pnpm db:server`. Le détail est dans `data\postgres.log`.

**Une page affiche une erreur après une mise à jour / « companyLead is undefined »**
→ La base ou le client Prisma n'est pas à jour : `pnpm db:migrate`, puis relance `pnpm dev`.

**Le trajet affiche « non calculé »**
→ Vérifie `PRIM_API_KEY` dans `.env` et ton adresse de départ dans le profil, puis `pnpm travel:test`.
Le message sous le trajet (page de l'offre) donne la raison.

**Aucune nouvelle offre**
→ `pnpm sources:test` pour voir quelle source ne répond pas. Une source en panne n'empêche pas les autres.

**France Travail répond 401 ou 403**
→ Identifiants faux ou scope manquant sur francetravail.io. Lance `pnpm ft:test`.

**Pas d'e-mail reçu**
→ Vérifie les lignes `SMTP_…` et `NOTIFY_EMAIL_TO` dans `.env`. Avec Gmail, il faut un « mot de passe d'application ».

**Git dit « index.lock: File exists »**
→ `rm -f .git/index.lock` puis recommence.

**Le port 5173 ou 3000 est déjà utilisé**
→ Un ancien `pnpm dev` tourne encore dans un autre terminal : ferme-le.

## 6. Extension « Envoyer à Job Radar » (Chrome ou Edge)

Un clic sur une offre (LinkedIn, Indeed, HelloWork, Welcome to the Jungle…) l'ouvre dans Job Radar, déjà remplie.

**Installation (une seule fois)**
1. Ouvre `chrome://extensions` (ou `edge://extensions` dans Edge).
2. Active le **Mode développeur** (interrupteur en haut à droite, ou en bas à gauche dans Edge).
3. Clique sur **Charger l'extension non empaquetée** et choisis le dossier `monPiston/extension`.
4. Épingle l'icône Job Radar (pièce de puzzle → punaise) pour l'avoir toujours sous la main.

**Utilisation**
1. `pnpm dev` doit tourner.
2. Sur la page d'une offre : clique sur l'icône Job Radar (ou **Alt + Maj + J**).
3. Un onglet Job Radar s'ouvre et **l'IA fait tout** (20 à 40 s) : elle lit l'annonce (titre, entreprise, lieu, contrat,
   télétravail, salaire, expérience demandée, compétences), ajoute l'offre (ou complète l'offre Adzuna / Jooble déjà connue),
   l'analyse et vérifie son score. Tu arrives directement sur la page de l'offre.
   Ce que l'IA propose est contrôlé : un salaire, une entreprise ou une expérience absents du texte sont refusés.
   - Tu préfères vérifier avant l'ajout ? Décoche « Ajout automatique depuis l'extension » en haut de « Ajouter une offre ».
   - Ollama éteint : pas d'ajout automatique, le formulaire est rempli par la lecture simple (moins fiable) pour que tu vérifies.
   Les « Voir plus » de la page sont dépliés automatiquement avant l'envoi.

Astuce : si une page est mal lue, sélectionne le texte de l'annonce à la souris avant de cliquer : seule la sélection est envoyée.
L'extension ne lit la page que quand tu cliques, et n'envoie rien ailleurs que vers ton Job Radar.
Après une mise à jour du dossier `extension`, clique sur la flèche « Recharger » de l'extension dans `chrome://extensions`.

## 7. Activer Jooble (plus d'offres)

Jooble regroupe les offres de nombreux sites d'emploi français.

1. Va sur https://fr.jooble.org/api/about et remplis le formulaire (pour « Site web », mets par exemple ton GitHub).
   ⚠️ Prends bien la clé sur **fr**.jooble.org : une clé d'un autre pays ne donne pas les offres françaises.
2. Colle la clé reçue dans `.env` : `JOOBLE_API_KEY=ta-cle`
3. `pnpm db:migrate` (une seule fois), puis `pnpm jooble:test`.
4. Relance `pnpm dev`, puis page **Sources** → coche **Active** sur Jooble.

**Important :** la clé gratuite donne **500 appels au total** (pas par jour). L'appli économise :
une seule recherche par zone (toutes tes recherches regroupées), une collecte par jour au plus,
et arrêt automatique à 480. Avec 2 zones, ça fait environ 8 mois. Le compteur est visible sur la page Sources.
Quand il est épuisé : demande une nouvelle clé, le compteur repart de zéro tout seul.

## 8. Le fichier `.env`

Il contient tes mots de passe et clés d'API. Il ne doit **jamais** être commité.
Le modèle est `.env.example` : chaque ligne y est expliquée.

## 9. L'IA locale (Ollama) — gratuite, rien ne sort de ton PC

Job Radar utilise **Ollama** avec le modèle **gemma4:e4b**, installés sur ton PC.
Aucune clé, aucun abonnement, et les annonces comme ton profil restent chez toi.

**Première fois**
1. Installe Ollama (https://ollama.com), puis dans PowerShell : `ollama pull gemma4:e4b`
2. Dans les réglages d'Ollama, mets « Context length » sur **8k**.
3. Dans le dossier du projet : `pnpm install`, puis `pnpm ai:test` → tu dois voir une analyse en JSON et sa durée.

**Au quotidien**
- Ollama doit être lancé (icône en bas à droite de Windows). Il démarre tout seul avec Windows par défaut.
- Sur la page d'une offre, carte **Analyse IA** → bouton **Analyser avec l'IA**.
  L'analyse est gardée : la rouvrir ne coûte rien. Elle est signalée « à refaire » si l'annonce ou ton profil change.

**Vérification automatique des scores**
La liste des offres s'affiche par 10. Parmi les offres affichées, celles à **70 % et plus** sont relues par l'IA
(une à la fois, 5 à 10 s chacune ; « IA en cours… » sur l'offre). Si l'IA juge l'offre peu adaptée, le score baisse :
adéquation **moyenne → 75 % max**, **faible → 50 % max** (l'ancien score reste affiché : « 91 → 50 % »). Elle ne monte jamais un score.
Si ton profil, ton CV ou l'annonce change, l'ancienne vérification ne compte plus et l'offre est revérifiée.
Ollama éteint : la liste marche normalement, avec « IA éteinte : scores non vérifiés ».

**Offres Adzuna et Jooble : compléter l'annonce**
Ces sites ne donnent que le début de l'annonce : le score est approximatif (« Extrait · score approximatif » dans la liste)
et l'IA ne vérifie pas ces offres, pour ne pas juger sur un bout de texte.
- Le plus simple : sur la page de l'offre, « Voir l'offre », puis clic sur l'extension **Envoyer à Job Radar** →
  Job Radar reconnaît l'offre et propose **Compléter l'offre existante** (pas de doublon).
- Sinon : **Compléter l'annonce** sur la page de l'offre, puis Ctrl + A, Ctrl + C sur l'annonce et colle.
Le score, l'analyse IA et la lettre utilisent alors l'annonce complète (la collecte ne l'écrase jamais).

**Lettre de motivation**
1. Menu **CV & lettre** : colle ton CV (texte), une lettre que tu as déjà écrite (pour le style), ton en-tête → **Enregistrer**.
2. Page d'une offre, carte **Lettre de motivation** → **Écrire la lettre avec l'IA**.
3. Lis l'encadré **À vérifier avant d'envoyer** (techno absente de ton CV, nom repris de ta lettre exemple…), corrige
   directement dans le texte, puis **Enregistrer mes modifications**.
4. **Copier** (pour un formulaire ou un email) ou **Enregistrer en PDF** (choisis « Enregistrer au format PDF » comme imprimante).

**Si ça ne marche pas**
- « Ollama ne répond pas » → lance l'appli Ollama, puis réessaie.
- « Modèle pas installé » → `ollama pull gemma4:e4b`
- Autre adresse ou autre modèle → dans `.env` : `OLLAMA_URL=...` et `OLLAMA_MODEL=...`, puis relance `pnpm dev`.

## 10. Lettre en PDF et candidatures spontanées par email

- **PDF de la lettre** : dans « CV & lettre », section 5, colle le dossier où ranger la lettre (ex. `C:\Users\…\Documents\travail\pour postuler`). Le bouton « Enregistrer en PDF » d'une offre écrit alors `Lettre_de_motivation.pdf` dans ce dossier, en remplaçant l'ancien. Si le PDF est ouvert dans un lecteur, ferme-le d'abord.
- **Candidature spontanée** : écran « Entreprises » → colle l'email de contact de l'entreprise → « Préparer la candidature ». L'IA écrit la lettre (sans rien inventer sur l'entreprise), tu la relis, puis « Envoyer » : l'email part de ton Gmail avec la lettre en PDF et ton CV PDF (chemin à indiquer dans « CV & lettre »). Rien ne part sans ton clic, et une entreprise déjà contactée demande une confirmation pour renvoyer.
- L'envoi utilise le même compte que les notifications : `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` dans `.env` (mot de passe d'application Gmail).
