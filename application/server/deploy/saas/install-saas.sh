#!/usr/bin/env bash
# ============================================================================================
#  ImmoPilot SaaS — installe les 4 versions sur UN seul serveur (VPS Ubuntu 22.04 / 24.04 ou Debian 12) :
#
#     https://DOMAINE/               vitrine : présentation, tarifs, choix du pays, démo, inscription
#     https://maroc.DOMAINE/         ImmoPilot Maroc (dirham)          — vrais clients, inscription en ligne
#     https://france.DOMAINE/        ImmoPilot France (euro)           — vrais clients, inscription en ligne
#     https://demo-maroc.DOMAINE/    démonstration Maroc, sans compte, lecture seule, données fictives
#     https://demo-france.DOMAINE/   démonstration France, sans compte, lecture seule, données fictives
#
#  Commande (en root, sur le serveur) :
#     curl -fsSL https://raw.githubusercontent.com/darmanagepro-gif/ImmoPilot/main/application/server/deploy/saas/install-saas.sh -o install-saas.sh
#     sudo bash install-saas.sh auto vous@exemple.com            ← sans nom de domaine (adresse automatique en .sslip.io)
#     sudo bash install-saas.sh immopilot.com vous@exemple.com   ← avec votre domaine (DNS déjà pointé, voir le guide)
#
#  Relançable sans risque : ne recrée ni les données ni les réglages existants. Les 4 versions ont des données séparées.
# ============================================================================================
set -euo pipefail
DOMAIN="${1:-}"; ADMIN="${2:-}"
REPO="${IMMO_REPO:-https://github.com/darmanagepro-gif/ImmoPilot.git}"; BRANCH="${IMMO_BRANCH:-main}"
INSTANCES="maroc france demo-maroc demo-france"
declare -A EDITION=( [maroc]=ma [france]=fr [demo-maroc]=ma-demo [demo-france]=fr-demo )
declare -A PORT=( [maroc]=8081 [france]=8082 [demo-maroc]=8083 [demo-france]=8084 )
[ "$(id -u)" = "0" ] || { echo "Lancez ce script en root (sudo)."; exit 1; }
[[ "$ADMIN" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { echo "Usage : sudo bash install-saas.sh <domaine|auto> <e-mail du super administrateur>"; exit 1; }
. /etc/os-release

echo "== 1/9 Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw fonts-dejavu-core fonts-liberation unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https dnsutils
dpkg-reconfigure -f noninteractive unattended-upgrades || true

if [ "$DOMAIN" = "auto" ]; then
  IP=$(curl -4 -fsS https://api.ipify.org || curl -4 -fsS https://ifconfig.me)
  [[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Adresse IP publique introuvable."; exit 1; }
  DOMAIN="${IP//./-}.sslip.io"
  echo "   Pas de nom de domaine : adresse automatique https://$DOMAIN/ (remplaçable plus tard par votre domaine)"
fi
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Domaine invalide : $DOMAIN"; exit 1; }
echo "== ImmoPilot SaaS sur $DOMAIN — $PRETTY_NAME"
if [[ "$DOMAIN" != *.sslip.io ]]; then
  IP=$(curl -4 -fsS https://api.ipify.org || true)
  for h in "" maroc. france. demo-maroc. demo-france.; do
    got=$(dig +short A "$h$DOMAIN" | tail -1)
    [ "$got" = "$IP" ] || echo "   ATTENTION : $h$DOMAIN pointe vers « ${got:-rien} » au lieu de $IP. Corrigez le DNS (voir le guide), le HTTPS ne marchera qu'après."
  done
fi

echo "== 2/9 Node.js 22 (LTS)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<13)){console.error("Node.js >= 22.13 requis");process.exit(1)}'

echo "== 3/9 Navigateur pour les PDF"
CHROME=""
if [ "$ID" = "debian" ]; then apt-get install -y chromium; CHROME=/usr/bin/chromium
else
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /etc/apt/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
  apt-get update -y && apt-get install -y google-chrome-stable; CHROME=/usr/bin/google-chrome-stable
fi

echo "== 4/9 Caddy (HTTPS automatique)"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "== 5/9 Utilisateur, code et dépendances"
id immopilot >/dev/null 2>&1 || useradd --system --home /var/lib/immopilot --shell /usr/sbin/nologin immopilot
install -d -o immopilot -g immopilot -m 0700 /var/lib/immopilot
install -d -m 0755 /opt/immopilot
if [ -d /opt/immopilot/src/.git ]; then git -C /opt/immopilot/src fetch --depth 1 origin "$BRANCH" && git -C /opt/immopilot/src checkout -q -B "$BRANCH" FETCH_HEAD
else git clone --depth 1 -b "$BRANCH" "$REPO" /opt/immopilot/src; fi
APP=/opt/immopilot/src/application
[ -f "$APP/server/server.js" ] || { echo "Dossier application/server introuvable dans le dépôt."; exit 1; }
(cd "$APP/server" && npm ci --omit=dev --no-audit --no-fund)

echo "== 6/9 Réglages des 4 versions (/etc/immopilot/<version>.env, lisibles par root et le service uniquement)"
install -d -m 0750 -g immopilot /etc/immopilot
# Un seul réglage e-mail pour les 4 versions : /etc/immopilot/smtp.env (inclus dans chaque version)
if [ ! -f /etc/immopilot/smtp.env ]; then
  cat > /etc/immopilot/smtp.env <<ENV
# E-mails (OBLIGATOIRE pour l'inscription en ligne, les invitations et les mots de passe oubliés).
# Renseignez le SMTP de votre fournisseur (Hostinger Mail, Brevo, Mailjet…), puis : sudo immopilot-saas restart
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=no-reply@$DOMAIN
MAIL_DAILY_QUOTA=2000
ENV
fi
for i in $INSTANCES; do
  install -d -o immopilot -g immopilot -m 0700 "/var/lib/immopilot/$i"
  f="/etc/immopilot/$i.env"
  if [ ! -f "$f" ]; then
    TOKEN=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)
    if [[ "$i" == demo-* ]]; then REAL="${i#demo-}"; EXTRA="SIGNUP_OPEN=false
# Bouton « Créer mon compte » de la démo : mène à l'inscription de la vraie version
SIGNUP_URL=https://$REAL.$DOMAIN/inscription"
    else EXTRA="# Inscription en ligne des propriétaires et agences, avec essai gratuit (jours)
SIGNUP_OPEN=true
SIGNUP_TRIAL_DAYS=60"; fi
    cat > "$f" <<ENV
# Réglages ImmoPilot — version $i. Après modification : sudo immopilot-saas restart
IMMO_EDITION=${EDITION[$i]}
PUBLIC_URL=https://$i.$DOMAIN/
ADMIN_EMAIL=$ADMIN
ADMIN_TOKEN=$TOKEN
DATA_DIR=/var/lib/immopilot/$i
HOST=127.0.0.1
PORT=${PORT[$i]}
CHROMIUM_PATH=$CHROME
$EXTRA
ENV
  fi
  # Ancienne adresse remplacée (passage de l'adresse automatique à votre domaine) : on met à jour les adresses publiques.
  sed -i -E "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$i.$DOMAIN/#; s#^(SIGNUP_URL=https://[a-z]+)\.[^/]+/#\1.$DOMAIN/#" "$f"
  chown root:immopilot "$f"; chmod 0640 "$f"
done
chown root:immopilot /etc/immopilot/smtp.env; chmod 0640 /etc/immopilot/smtp.env
echo "$DOMAIN" > /etc/immopilot/domaine

echo "== 7/9 Services, vitrine, HTTPS, pare-feu, sauvegardes"
install -m 0644 "$APP/server/deploy/saas/immopilot@.service" /etc/systemd/system/immopilot@.service
sed "s/{{DOMAIN}}/$DOMAIN/g" "$APP/server/deploy/saas/Caddyfile" > /etc/caddy/Caddyfile
install -m 0755 "$APP/server/deploy/saas/immopilot-saas.sh" /usr/local/sbin/immopilot-saas
echo "15 3 * * * root /usr/local/sbin/immopilot-saas backup >> /var/log/immopilot-backup.log 2>&1" > /etc/cron.d/immopilot-backup
echo "30 4 * * 1 root /usr/local/sbin/immopilot-saas demo-reset >> /var/log/immopilot-demo.log 2>&1" > /etc/cron.d/immopilot-demo
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null
# Ancienne installation « une seule version » éventuelle : arrêtée pour libérer le port et le domaine.
systemctl disable --now immopilot 2>/dev/null || true
systemctl daemon-reload
for i in $INSTANCES; do systemctl enable "immopilot@$i" >/dev/null; systemctl restart "immopilot@$i"; done
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy || systemctl restart caddy

echo "== 8/9 Bases de données et super administrateur"
for i in $INSTANCES; do
  for n in $(seq 1 40); do curl -fsS "http://127.0.0.1:${PORT[$i]}/healthz" >/dev/null 2>&1 && break; sleep 1; done
  echo "-- $i"
  if /usr/local/sbin/immopilot-saas cli "$i" setup > "/root/immopilot-setup-$i.txt" 2>&1; then
    L=$(grep -Eo "https://[^\" ]*action=accept[^\" ]*" "/root/immopilot-setup-$i.txt" | head -1 || true)
    echo "   OK${L:+ — lien d’activation : $L}"
  else echo "   ÉCHEC, voir /root/immopilot-setup-$i.txt"; fi
done

echo "== 9/9 Données fictives des démonstrations"
for i in demo-maroc demo-france; do
  if [ -f "/var/lib/immopilot/$i/.demo-prete" ]; then echo "   $i : déjà prête"; continue; fi
  if /usr/local/sbin/immopilot-saas cli "$i" run creerEnvironnementDemo > "/root/immopilot-demo-$i.txt" 2>&1 && \
     /usr/local/sbin/immopilot-saas cli "$i" run creerHistoriqueDemo >> "/root/immopilot-demo-$i.txt" 2>&1; then
    touch "/var/lib/immopilot/$i/.demo-prete"; echo "   $i : prête"
  else echo "   $i : ÉCHEC, voir /root/immopilot-demo-$i.txt"; fi
done

echo
echo "================================================================================"
echo " ImmoPilot SaaS est en ligne :"
echo "   Vitrine            https://$DOMAIN/"
echo "   Maroc              https://maroc.$DOMAIN/"
echo "   France             https://france.$DOMAIN/"
echo "   Démo Maroc         https://demo-maroc.$DOMAIN/"
echo "   Démo France        https://demo-france.$DOMAIN/"
echo
echo " Liens d'activation de votre compte super administrateur (un par version) : ci-dessus,"
echo " et dans /root/immopilot-setup-*.txt (confidentiel)."
echo " INDISPENSABLE ensuite : renseignez le SMTP dans /etc/immopilot/smtp.env puis : sudo immopilot-saas restart"
echo " État des 4 versions à tout moment : sudo immopilot-saas status"
echo "================================================================================"
