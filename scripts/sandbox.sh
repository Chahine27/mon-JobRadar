#!/usr/bin/env bash
# Bac à sable sur le serveur AWS : le code tel qu'il est sur ce PC (même non commité), sur une copie fraîche de la
# vraie base, sans toucher à la production (dossier ~/jobradar, services, base « jobradar »). Rien n'y tourne en continu :
# ni collecte, ni suivi des mails, ni envoi de mail, ni IA payante (clé Claude retirée ; Groq / Mistral gratuits gardés).
#   scripts/sandbox.sh                  → copie le code, recopie la base, lance « pnpm check »
#   scripts/sandbox.sh <commande…>      → idem, puis la commande dans ~/sandbox
#                                         ex. scripts/sandbox.sh pnpm --filter @job-radar/api score:eval --model=claude
#   SANDBOX_DB=keep scripts/sandbox.sh  → garde la base du bac à sable telle quelle (pas de recopie)
set -euo pipefail
cd "$(dirname "$0")/.."

# Fichiers suivis + nouveaux fichiers non ignorés, dans leur état actuel sur ce PC.
# ponytail: un fichier supprimé ici reste dans ~/sandbox ; vider le dossier (hors node_modules) si ça gêne.
git ls-files -co --exclude-standard -z | tar --null -T - -c | ssh jobradar 'mkdir -p ~/sandbox && tar -x -C ~/sandbox'

args=""
[ $# -gt 0 ] && args=$(printf '%q ' "$@")
ssh jobradar "SANDBOX_DB=${SANDBOX_DB:-fresh} bash -s -- $args" <<'EOF'
set -euo pipefail
cd ~/sandbox
if [ "$SANDBOX_DB" != keep ]; then
  sudo -u postgres dropdb --if-exists jobradar_sandbox
  sudo -u postgres createdb -O jobradar jobradar_sandbox
  sudo -u postgres pg_dump -Fc jobradar | sudo -u postgres pg_restore --no-owner --role=jobradar -d jobradar_sandbox
fi
# .env de la production, pointé sur la base du bac à sable, sans rien qui agisse au-dehors.
sed -e 's#^\(DATABASE_URL=.*/\)jobradar\b#\1jobradar_sandbox#' \
    -e 's#^\(SCHEDULER_ENABLED\|MAIL_TRACKING_ENABLED\|JOBSCRAPER_ENABLED\)=.*#\1=false#' \
    -e 's#^\(ANTHROPIC_API_KEY\|SMTP_PASSWORD\|VAPID_PRIVATE_KEY\)=.*#\1=#' \
    ~/jobradar/.env > .env
grep -q '^DATABASE_URL=.*/jobradar_sandbox' .env || { echo "DATABASE_URL du bac à sable introuvable : arrêt"; exit 1; }
export PRISMA_HIDE_UPDATE_MESSAGE=1
CI=true pnpm install --frozen-lockfile --silent >/dev/null
pnpm --filter @job-radar/db generate >/dev/null
pnpm --filter @job-radar/db migrate:deploy >/dev/null 2>&1
if [ $# -eq 0 ]; then pnpm check 2>&1 | grep -E "Test Files|Tests |error" ; else "$@"; fi
EOF
