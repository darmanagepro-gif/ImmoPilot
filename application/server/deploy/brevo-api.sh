#!/usr/bin/env bash
# ImmoPilot : passe l'envoi des e-mails sur l'API Brevo (France ET Maroc) et active le suivi de livraison.
# Usage (en root) : bash brevo-api.sh
# La clé est lue sans être affichée, vérifiée auprès de Brevo, puis écrite uniquement dans les fichiers
# d'environnement du serveur (lisibles par root et le service), jamais dans la base ni dans le navigateur.
set -euo pipefail
[ "$(id -u)" = "0" ] || { echo "Lancez ce script en root."; exit 1; }
echo "== API Brevo pour ImmoPilot (France et Maroc)"
echo "Collez la clé API Brevo (xkeysib-...) avec clic droit > Coller, puis Entrée (rien ne s'affiche, c'est normal) :"
read -r -s K; echo
K=$(printf %s "$K" | sed 's/\x1b\[20[01]~//g' | tr -d '[:space:][:cntrl:]')
echo "(${#K} caractères reçus)"
[[ "$K" =~ ^xkeysib-[A-Za-z0-9-]{20,}$ ]] || { echo "Clé invalide (elle doit commencer par xkeysib-) : rien n'a été modifié."; exit 1; }
ACCOUNT=$(curl -s -m 20 -H "api-key: $K" -H "accept: application/json" https://api.brevo.com/v3/account || true)
echo "$ACCOUNT" | grep -q '"email"' || { echo "Brevo refuse cette clé : rien n'a été modifié."; exit 1; }
echo "Clé acceptée par Brevo (compte $(echo "$ACCOUNT" | grep -o '"email":"[^"]*"' | head -1 | cut -d'"' -f4))."
setkv() { # fichier clé valeur : remplace ou ajoute la ligne CLÉ=valeur
  local f="$1" k="$2" v="$3" tmp; tmp=$(mktemp)
  grep -v "^${k}=" "$f" > "$tmp" || true
  printf '%s=%s\n' "$k" "$v" >> "$tmp"
  cat "$tmp" > "$f"; rm -f "$tmp"
}
for U in immopilot immopilot-ma; do
  systemctl cat "$U" >/dev/null 2>&1 || { echo "Service $U introuvable, ignoré."; continue; }
  F=$(systemctl show -p EnvironmentFiles "$U" | sed -E 's/^EnvironmentFiles=([^ ]+).*/\1/')
  [ -f "$F" ] || { echo "Fichier d'environnement de $U introuvable ($F), ignoré."; continue; }
  setkv "$F" BREVO_API_KEY "$K"
  grep -q '^BREVO_WEBHOOK_TOKEN=' "$F" || setkv "$F" BREVO_WEBHOOK_TOKEN "$(openssl rand -hex 24)"
  chmod 600 "$F"
  systemctl restart "$U"
  echo "-- $U : API Brevo activée ($F), service redémarré."
done
unset K ACCOUNT
sleep 8
for U in immopilot immopilot-ma; do journalctl -u "$U" -n 30 --no-pager 2>/dev/null | grep -E "Webhook Brevo" | tail -1 || true; done
echo "TERMINÉ. Les e-mails partent maintenant par l'API Brevo ; les statuts de livraison remontent dans ImmoPilot."
