# Job Radar

Appli perso de recherche d'emploi (un seul utilisateur, Chahine). Collecte d'offres, notation sur 100, alertes, lettres de motivation, CV adaptés, suivi des candidatures.
Monorepo pnpm, TypeScript, Node >= 20 (24 en CI et sur le serveur). Code, commentaires, commits et réponses en français.

## Commandes

- `pnpm check` : types + tests unitaires. À lancer avant tout commit (c'est ce que fait la CI).
- `pnpm test` / `pnpm typecheck` séparément ; un seul fichier : `npx vitest run <chemin>`.
- `pnpm test:int` : tests d'intégration (`*.int.test.ts`) sur une vraie base PostgreSQL `jobradar_test`.
- `pnpm dev` : API (Fastify, port 3000) + site (Vite, http://localhost:5173).
- `pnpm db:generate` après une modif de `packages/db/prisma/schema.prisma`, `pnpm db:migrate` pour créer la migration.
- `pnpm jobs:renormalize` : réapplique normalisation et score aux offres déjà en base.
- `pnpm mails:retrack [--apply]` : relit les réponses de candidature des 60 derniers jours avec les règles actuelles de rattachement (sur le serveur).
- `scripts/sandbox.sh [commande]` : bac à sable sur le serveur (code du PC, copie fraîche de la vraie base, sans collecte, mails ni clé Claude). `SANDBOX_DB=keep` pour ne pas recopier la base.

## Organisation

- `apps/api` : API Fastify (lance aussi la collecte planifiée et la renormalisation au démarrage).
- `apps/web` : site Vue 3 + Vite.
- `apps/worker` : scripts de collecte et outils en ligne de commande (`pnpm collect`, `*:test`).
- `apps/api/src/mcp.ts` : serveur MCP en lecture seule (offres, notes, suivi des candidatures) pour Claude Code, lancé sur le serveur par SSH/Tailscale (`mcp-server.ts`), base ouverte en lecture seule.
- `packages/source-connectors` : un connecteur par site d'offres. `job-normalizer` : nettoyage des offres. `scoring` : note sur 100. `pipeline` : collecte → normalisation → dédoublonnage → score (`renormalize.ts`).
- `packages/ai` : appels IA. `cover-letter.ts` écrit les lettres, `letter-review.ts` les relit par règles, `job-analysis.ts` donne l'avis sur une offre, `mail-reading.ts` trie les mails, `cloud.ts` gère la chaîne de modèles.
- `packages/db` : Prisma 7 + PostgreSQL. `cv-tailor` / `cv-render` : CV adapté et PDF. `notifications`, `routing` (temps de trajet), `skills`, `shared`.
- `extension/` : extension Chrome/Edge pour envoyer une offre. `tools/jobscraper` : scraper Python (gitignoré sur le serveur, copié à part).

## Production

- Chaque push sur `main` déploie en production sur le serveur AWS (`.github/workflows/deployer.yml` : `pnpm check`, build du site, puis `scripts/deployer.sh`).
- La base de référence est celle du serveur. Ne pas lancer Job Radar sur le PC en parallèle (double collecte, mails en double). `docs/LANCEMENT.md` décrit encore l'ancien fonctionnement local.
- Ne jamais copier du code à la main dans `~/jobradar` sur le serveur : tester dans `~/sandbox` via `scripts/sandbox.sh`.

## Règles

- **Zéro dépense.** Ne proposer que des solutions gratuites. Les crédits Claude du `.env` servent aux vraies candidatures, pas aux tests : vérifier sans appel IA, ou avec les IA gratuites (`ANTHROPIC_API_KEY=` vide → Ollama Cloud, Groq, Mistral). Un appel Claude payant seulement après accord, avec le coût estimé.
- **Ne jamais modifier `.env`** (clés d'API). `.env.example` sert de modèle.
- **Git** : commit et push directement sur `main`, sans branche ni PR. Un seul commit une fois le travail fini et vérifié, avec seulement les fichiers touchés pendant la session.
- **Règles rétroactives** : un changement de normalisation ou de score doit valoir aussi pour les offres déjà en base (champs repris par `renormalizeJobs`). Un changement de consigne d'analyse IA passe par `ANALYSIS_PROMPT_VERSION`. Si un champ n'est pas couvert, prévoir sa réapplication et le dire.
- **Lettres** : dans le corps, seulement des virgules et des points, une virgule au plus par phrase, phrases simples à la première personne. Ces règles sont imposées par `letter-review.ts`, ne pas les affaiblir.
- **Bac à sable des lettres** : `SANDBOX=1 npx vitest run packages/ai/src/_bac-a-sable.test.ts` (fichier local non commité, données dans `data/sandbox/`, IA gratuites seulement).
- Économiser : lire les pages en texte plutôt qu'en capture, filtrer les sorties longues (`tail`, `grep`).
