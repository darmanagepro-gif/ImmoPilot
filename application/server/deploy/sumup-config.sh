#!/usr/bin/env bash
# ImmoPilot : configure le prélèvement automatique des abonnements par SumUp sur France ET Maroc, puis teste la connexion.
# Usage (en root) : bash sumup-config.sh
# La clé secrète est lue sans être affichée et n'est conservée ni dans l'historique ni en clair (base chiffrée).
set -euo pipefail
[ "$(id -u)" = "0" ] || { echo "Lancez ce script en root."; exit 1; }
echo "== Configuration SumUp (ImmoPilot France et Maroc)"
read -r -p "Code marchand SumUp (ex. MXXXXXXX) : " M
M=$(printf %s "$M" | tr -d '[:space:]')
[[ "$M" =~ ^[A-Za-z0-9]{4,20}$ ]] || { echo "Code marchand invalide."; exit 1; }
echo "Collez la clé secrète SumUp (sup_sk_...) avec clic droit > Coller, puis Entrée (rien ne s'affiche, c'est normal) :"
read -r -s K; echo
K=$(printf %s "$K" | sed 's/\x1b\[20[01]~//g' | tr -d '[:space:][:cntrl:]')
echo "(${#K} caractères reçus)"
[[ "$K" =~ ^[A-Za-z0-9_.-]{20,}$ ]] || { echo "Clé invalide : rien n'a été enregistré."; exit 1; }
read -r -p "Taux de conversion pour le Maroc : combien d'euros pour 1 dirham ? (ex. 0.092) : " R
R=$(printf %s "$R" | tr ',' '.' | tr -d '[:space:]')
[[ "$R" =~ ^0\.[0-9]{2,6}$ ]] || { echo "Taux invalide (attendu par exemple 0.092)."; exit 1; }
for W in immopilot immopilot-ma; do
  command -v "$W" >/dev/null || { echo "Commande $W introuvable, ignorée."; continue; }
  echo "-- $W"
  printf %s "$K" | "$W" set-secret SUMUP_API_KEY
  "$W" set SUMUP_MERCHANT_CODE "$M" >/dev/null && echo "SUMUP_MERCHANT_CODE enregistré."
  "$W" set SUMUP_CURRENCY EUR >/dev/null && echo "SUMUP_CURRENCY = EUR"
  if [ "$W" = "immopilot-ma" ]; then "$W" set SUMUP_RATE "$R" >/dev/null && echo "SUMUP_RATE = $R €/MAD"; fi
  "$W" run testerSumUp || true
done
unset K
echo "TERMINÉ. Si « ok »: true apparaît pour France et Maroc, le prélèvement automatique est actif."
