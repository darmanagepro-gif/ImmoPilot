#!/usr/bin/env bash
# Sauvegarde quotidienne d'ImmoPilot : base SQLite (copie cohérente, sans arrêt du service) + fichiers privés.
# Conservation : 14 jours dans /var/backups/immopilot. Copiez aussi ce dossier HORS du serveur (rclone, stockage objet, NAS…).
set -euo pipefail
DATA=/var/lib/immopilot; DEST=/var/backups/immopilot; KEEP=${KEEP_DAYS:-14}; STAMP=$(date +%Y%m%d-%H%M%S)
install -d -m 0700 "$DEST"
node --no-warnings -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1] + "/immopilot.db", { readOnly: true });
  db.exec("VACUUM INTO " + JSON.stringify(process.argv[2]).replace(/"/g, "\x27"));
  db.close();' "$DATA" "$DEST/immopilot-$STAMP.db"
tar -czf "$DEST/fichiers-$STAMP.tar.gz" -C "$DATA" files
chmod 0600 "$DEST"/*-"$STAMP".*
find "$DEST" -type f -mtime +"$KEEP" -delete
echo "$(date -Is) sauvegarde OK : $DEST/immopilot-$STAMP.db et fichiers-$STAMP.tar.gz"
