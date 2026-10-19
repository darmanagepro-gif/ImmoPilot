#!/usr/bin/env bash
# Mise à jour d'ImmoPilot depuis GitHub : sauvegarde, récupération du code, dépendances, redémarrage, contrôle.
set -euo pipefail
/usr/local/sbin/immopilot-backup
git -C /opt/immopilot/src pull --ff-only
(cd /opt/immopilot/src/application/server && npm ci --omit=dev --no-audit --no-fund)
systemctl restart immopilot
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1 && { echo "ImmoPilot à jour et en ligne."; exit 0; }; sleep 1; done
echo "Le service ne répond pas : journalctl -u immopilot -n 50"; exit 1
