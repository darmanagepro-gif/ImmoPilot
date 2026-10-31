#!/usr/bin/env bash
# ImmoPilot SaaS — commande d'administration du serveur (installée en /usr/local/sbin/immopilot-saas).
#
#   sudo immopilot-saas status                     état des 4 versions
#   sudo immopilot-saas restart [version]          redémarre toutes les versions (ou une seule : maroc, france, demo-maroc, demo-france)
#   sudo immopilot-saas logs <version>             50 dernières lignes du journal
#   sudo immopilot-saas update                     sauvegarde, récupère la dernière version sur GitHub, redémarre, contrôle
#   sudo immopilot-saas backup                     sauvegarde des 4 bases + fichiers privés (automatique chaque nuit à 3 h 15)
#   sudo immopilot-saas demo-reset                 recrée les données fictives des démos (automatique chaque lundi à 4 h 30)
#   sudo immopilot-saas domaine <nouveau-domaine>  passe de l'adresse automatique à votre domaine (relance l'installation)
#   sudo immopilot-saas cli <version> <commande…>  commandes avancées (setup, run <fonction>, set <PROPRIETE> <valeur>, mails)
set -euo pipefail
INSTANCES="maroc france demo-maroc demo-france"
declare -A PORT=( [maroc]=8081 [france]=8082 [demo-maroc]=8083 [demo-france]=8084 )
APP=/opt/immopilot/src/application
BK=/var/backups/immopilot; KEEP=${KEEP_DAYS:-14}
[ "$(id -u)" = "0" ] || { echo "Lancez avec sudo."; exit 1; }
valid() { [[ " $INSTANCES " == *" $1 "* ]] || { echo "Version inconnue : $1 (maroc, france, demo-maroc, demo-france)"; exit 1; }; }
wait_up() { for n in $(seq 1 40); do curl -fsS "http://127.0.0.1:${PORT[$1]}/healthz" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }
cli() { local i="$1"; shift; valid "$i"; ( set -a; . /etc/immopilot/smtp.env; . "/etc/immopilot/$i.env"; set +a; exec node "$APP/server/cli.js" "$@" ); }
backup_one() {
  local i="$1" stamp="$2" data="/var/lib/immopilot/$1"
  [ -f "$data/immopilot.db" ] || return 0
  node --no-warnings -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1] + "/immopilot.db", { readOnly: true });
    db.exec("VACUUM INTO " + JSON.stringify(process.argv[2]).replace(/"/g, "\x27"));
    db.close();' "$data" "$BK/$i-$stamp.db"
  [ -d "$data/files" ] && tar -czf "$BK/$i-fichiers-$stamp.tar.gz" -C "$data" files || true
}
case "${1:-}" in
  status)
    echo "Adresse : https://$(cat /etc/immopilot/domaine 2>/dev/null || echo '?')/"
    for i in $INSTANCES; do
      st=$(systemctl is-active "immopilot@$i" || true); h=$(curl -fsS -m 3 "http://127.0.0.1:${PORT[$i]}/healthz" 2>/dev/null || echo "-")
      printf "  %-12s service %-9s réponse %s\n" "$i" "$st" "$h"
    done ;;
  restart)
    if [ -n "${2:-}" ]; then valid "$2"; systemctl restart "immopilot@$2"; wait_up "$2" && echo "$2 redémarrée."
    else for i in $INSTANCES; do systemctl restart "immopilot@$i"; done; for i in $INSTANCES; do wait_up "$i" && echo "$i : en ligne" || echo "$i : NE RÉPOND PAS (sudo immopilot-saas logs $i)"; done; fi ;;
  logs) valid "${2:-}"; journalctl -u "immopilot@$2" -n 50 --no-pager ;;
  backup)
    install -d -m 0700 "$BK"; stamp=$(date +%Y%m%d-%H%M%S)
    for i in maroc france; do backup_one "$i" "$stamp"; done
    chmod 0600 "$BK"/*-"$stamp"* 2>/dev/null || true
    find "$BK" -type f -mtime +"$KEEP" -delete
    echo "$(date -Is) sauvegarde OK ($BK, $stamp). Copiez aussi ce dossier HORS du serveur." ;;
  update)
    "$0" backup
    git -C /opt/immopilot/src fetch --depth 1 origin "$(git -C /opt/immopilot/src rev-parse --abbrev-ref HEAD)"
    git -C /opt/immopilot/src reset -q --hard FETCH_HEAD
    (cd "$APP/server" && npm ci --omit=dev --no-audit --no-fund)
    install -m 0644 "$APP/server/deploy/saas/immopilot@.service" /etc/systemd/system/immopilot@.service
    install -m 0755 "$APP/server/deploy/saas/immopilot-saas.sh" /usr/local/sbin/immopilot-saas
    systemctl daemon-reload
    "$0" restart
    for i in $INSTANCES; do cli "$i" setup >/dev/null 2>&1 || echo "Mise à jour de la base $i : voir sudo immopilot-saas cli $i setup"; done
    echo "ImmoPilot SaaS à jour : $(git -C /opt/immopilot/src log -1 --format='%h %s')" ;;
  demo-reset)
    for i in demo-maroc demo-france; do
      systemctl stop "immopilot@$i"
      find "/var/lib/immopilot/$i" -mindepth 1 -delete
      systemctl start "immopilot@$i"; wait_up "$i"
      cli "$i" setup >/dev/null && cli "$i" run creerEnvironnementDemo >/dev/null && cli "$i" run creerHistoriqueDemo >/dev/null \
        && touch "/var/lib/immopilot/$i/.demo-prete" && echo "$(date -Is) $i : données fictives recréées" || echo "$(date -Is) $i : ÉCHEC de la remise à zéro"
    done ;;
  domaine)
    [ -n "${2:-}" ] || { echo "Usage : sudo immopilot-saas domaine immopilot.com"; exit 1; }
    admin=$(grep -m1 '^ADMIN_EMAIL=' /etc/immopilot/maroc.env | cut -d= -f2)
    IMMO_BRANCH="$(git -C /opt/immopilot/src rev-parse --abbrev-ref HEAD)" bash "$APP/server/deploy/saas/install-saas.sh" "$2" "$admin" ;;
  cli) shift; i="${1:-}"; shift || true; cli "$i" "$@" ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
