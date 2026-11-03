#!/bin/bash
# Contrôle quotidien des sauvegardes DarPilot (installé dans /usr/local/sbin/immopilot-backup-check, lancé par cron).
# Vérifie que la dernière archive chiffrée hors serveur (celle que récupère le PC) :
#   1. existe et date de moins de 26 h ;
#   2. se déchiffre avec le mot de passe de sauvegarde ;
#   3. contient, pour France et Maroc, une base SQLite intacte (PRAGMA integrity_check) et l'archive des fichiers.
# En cas d'échec : ligne dans le journal + e-mail d'alerte à ADMIN_EMAIL via l'API Brevo (clé lue sur le serveur, jamais affichée).
set -uo pipefail
O=${OFFSITE_DIR:-/var/backups/offsite/sauvegardes}; P=${PASS_FILE:-/root/.offsite-pass}; ENV=${ENV_FILE:-/etc/immopilot/immopilot.env}
LOG=${LOG_FILE:-/var/log/immopilot-backup.log}; MAXH=${MAX_AGE_HOURS:-26}; WORK=${WORK_DIR:-/var/backups}

fail() {
  local msg="$1" K TO FROM
  echo "$(date -Is) CONTROLE SAUVEGARDE EN ECHEC : $msg" >> "$LOG"
  K=$(grep -m1 '^BREVO_API_KEY=' "$ENV" 2>/dev/null | cut -d= -f2-)
  TO=$(grep -m1 '^ADMIN_EMAIL=' "$ENV" 2>/dev/null | cut -d= -f2-)
  FROM=$(grep -m1 '^MAIL_FROM=' "$ENV" 2>/dev/null | cut -d= -f2-)
  if [ -z "${NO_ALERT:-}" ] && [ -n "$K" ] && [ -n "$TO" ]; then  # NO_ALERT=1 : appelé par le contrôle quotidien, qui fait son propre rapport
    curl -s -m 20 -o /dev/null -X POST https://api.brevo.com/v3/smtp/email -H "api-key: $K" -H "content-type: application/json" \
      -d "$(node -e 'console.log(JSON.stringify({ sender: { email: process.argv[1], name: "DarPilot" }, to: [{ email: process.argv[2] }],
        subject: "ALERTE : sauvegarde DarPilot en échec",
        textContent: "Le contrôle automatique des sauvegardes a échoué sur le serveur :\n\n" + process.argv[3] +
          "\n\nDétails : /var/log/immopilot-backup.log sur le serveur.\nTant que ce n’est pas réglé, votre PC ne récupère pas de sauvegarde à jour." }))' \
        "${FROM:-no-reply@darpilot.fr}" "$TO" "$msg")"
  fi
  exit 1
}

F=$(ls -1t "$O"/immopilot-*.tar.gpg 2>/dev/null | head -1)
[ -n "$F" ] || fail "aucune archive chiffrée dans $O"
AGE=$(( ($(date +%s) - $(stat -c %Y "$F")) / 3600 ))
[ "$AGE" -le "$MAXH" ] || fail "la dernière archive date de ${AGE} h ($(basename "$F")) : les sauvegardes de nuit ne tournent plus"

W=$(mktemp -d "$WORK/.controle.XXXXXX") || fail "dossier de travail impossible à créer"
trap 'rm -rf "$W"' EXIT
chmod 700 "$W"
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$P" -d "$F" 2>/dev/null | tar -x -C "$W" 2>/dev/null
[ "${PIPESTATUS[0]}" = "0" ] || fail "archive impossible à déchiffrer ($(basename "$F"))"

for n in immopilot immopilot-ma; do
  db=$(ls "$W/$n"/immopilot-*.db 2>/dev/null | head -1)
  [ -n "$db" ] || fail "base $n absente de l'archive $(basename "$F")"
  r=$(node --no-warnings -e '
    const { DatabaseSync } = require("node:sqlite");
    const d = new DatabaseSync(process.argv[1], { readOnly: true });
    const ok = Object.values(d.prepare("PRAGMA integrity_check").get())[0];
    const t = d.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = \x27table\x27").get().n;
    console.log(ok + " " + t);' "$db" 2>&1)
  case "$r" in "ok "*) ;; *) fail "base $n endommagée dans $(basename "$F") : $(printf '%s\n' "$r" | grep -m1 -i -E 'error|malformed|corrupt|not a database|^[a-z]' | cut -c1-200)";; esac
  [ "${r#ok }" -gt 0 ] 2>/dev/null || fail "base $n vide dans $(basename "$F")"
  ls "$W/$n"/fichiers-*.tar.gz >/dev/null 2>&1 || fail "fichiers de $n absents de l'archive $(basename "$F")"
  tar -tzf "$(ls "$W/$n"/fichiers-*.tar.gz | head -1)" >/dev/null 2>&1 || fail "archive des fichiers de $n illisible"
done
echo "$(date -Is) controle sauvegarde OK : $(basename "$F") (${AGE} h), bases France et Maroc intactes" >> "$LOG"
