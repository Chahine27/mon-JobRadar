#!/usr/bin/env bash
# Met à jour Job Radar sur le serveur AWS, une fois le nouveau code copié dans ~/jobradar
# (par .github/workflows/deployer.yml). Les migrations de la base passent au redémarrage de jobradar-api.
set -euo pipefail
cd "$(dirname "$0")/.."

CI=true pnpm install --frozen-lockfile
pnpm --filter @job-radar/web build
sudo systemctl restart jobradar-api jobradar-web

for _ in $(seq 1 90); do
  if curl -fs http://127.0.0.1:5173/api/health >/dev/null; then
    echo "Job Radar à jour et en ligne."
    exit 0
  fi
  sleep 2
done
echo "Job Radar ne répond pas après le redémarrage :"
journalctl -u jobradar-api -n 40 --no-pager -o cat
exit 1
