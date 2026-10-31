#!/usr/bin/env bash
# ImmoPilot : active le chiffrement au repos (AES-256-GCM) d'UNE instance et chiffre les données existantes.
# Usage (en root) :  bash encrypt-at-rest.sh immopilot     (instance principale : /etc/immopilot/immopilot.env)
#                    bash encrypt-at-rest.sh ma            (instance /etc/immopilot/ma.env, service immopilot-ma)
# Protège la base, les scans de pièces d'identité, les propriétés sensibles (clé IA…) et les e-mails en file contre le vol d'un
# disque, d'un instantané ou d'une sauvegarde. Ne protège PAS contre un serveur piraté en cours de fonctionnement (la clé y est lue).
# Relancable sans risque. SAUVEGARDEZ LA CLÉ HORS DU SERVEUR : sans elle, les données chiffrées sont perdues.
set -euo pipefail
[ "$(id -u)" = "0" ] || { echo "Lancez ce script en root."; exit 1; }
N=${1:-immopilot}; E=/etc/immopilot/$N.env; K=/etc/immopilot/data-$N.key
SVC=immopilot; [ "$N" = "immopilot" ] || SVC=immopilot-$N
BK=/usr/local/sbin/immopilot-backup; [ "$N" = "immopilot" ] || BK=/usr/local/sbin/immopilot-backup-$N
[ -f "$E" ] || { echo "Instance introuvable : $E"; exit 1; }
[ -x "$BK" ] || { echo "Sauvegarde introuvable ($BK) : faites d'abord une sauvegarde avant de chiffrer."; exit 1; }
[ -x "/usr/local/bin/$SVC" ] || { echo "Commande /usr/local/bin/$SVC introuvable."; exit 1; }

echo "== 1/5 Sauvegarde de sécurité avant chiffrement"
"$BK"
echo "== 2/5 Clé de chiffrement (32 octets aléatoires, lisible par root et le service seulement)"
if [ ! -s "$K" ]; then ( umask 077; head -c 32 /dev/urandom | base64 > "$K" ); echo "   clé créée : $K"; else echo "   clé déjà présente : $K (conservée)"; fi
chown root:immopilot "$K"; chmod 0640 "$K"
echo "== 3/5 Activation dans $E"
grep -q '^DATA_KEY_FILE=' "$E" || printf '\n# Chiffrement au repos (AES-256-GCM) : NE PAS SUPPRIMER ce fichier sans copie de la clé, les données seraient perdues.\nDATA_KEY_FILE=%s\n' "$K" >> "$E"
echo "== 4/5 Redémarrage puis chiffrement des données existantes"
systemctl restart "$SVC"
PORT=$(grep '^PORT=' "$E" | cut -d= -f2-)
for i in $(seq 1 60); do curl -fsS "http://127.0.0.1:${PORT:-8080}/healthz" >/dev/null 2>&1 && break; sleep 1; done
"/usr/local/bin/$SVC" encrypt-data
echo "== 5/5 Vérification (tout doit se déchiffrer, plus aucun clair)"
"/usr/local/bin/$SVC" verify-data
echo
echo "TERMINÉ pour « $N ». La clé est dans $K : conservez-en une copie HORS du serveur (l'archive chiffrée hors serveur la contient si"
echo "immopilot-offsite est installé). Les anciennes sauvegardes AVANT chiffrement restent en clair dans /var/backups jusqu'à leur purge (14 jours)."
