#!/usr/bin/env bash
# ============================================================================================
#  ImmoPilot — installation sur un serveur dédié (VPS) Ubuntu 22.04 / 24.04 ou Debian 12.
#  À lancer en root, sur un serveur neuf, APRÈS avoir fait pointer le nom de domaine vers le serveur :
#
#     curl -fsSL https://raw.githubusercontent.com/darmanagepro-gif/ImmoPilot/main/application/server/deploy/install.sh -o install.sh
#     sudo bash install.sh app.mondomaine.fr vous@mondomaine.fr fr
#
#  Arguments : 1) nom de domaine  2) e-mail du super administrateur  3) édition : fr (euro) ou ma (dirham), fr par défaut
#  Installe : Node.js 22, Chromium (PDF), Caddy (HTTPS Let's Encrypt automatique), pare-feu, service systemd,
#  sauvegarde quotidienne. Les données restent sur le serveur (/var/lib/immopilot), jamais publiques.
# ============================================================================================
set -euo pipefail
DOMAIN="${1:-}"; ADMIN="${2:-}"; EDITION="${3:-fr}"
REPO="${IMMO_REPO:-https://github.com/darmanagepro-gif/ImmoPilot.git}"; BRANCH="${IMMO_BRANCH:-main}"
[ "$(id -u)" = "0" ] || { echo "Lancez ce script en root (sudo)."; exit 1; }
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Usage : sudo bash install.sh app.mondomaine.fr vous@mondomaine.fr [fr|ma]"; exit 1; }
[[ "$ADMIN" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { echo "E-mail du super administrateur invalide."; exit 1; }
[[ "$EDITION" =~ ^(fr|ma)$ ]] || { echo "Édition : fr ou ma."; exit 1; }
. /etc/os-release
echo "== ImmoPilot ($EDITION) sur $DOMAIN — $PRETTY_NAME"

echo "== 1/8 Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw fonts-dejavu-core fonts-liberation unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https
dpkg-reconfigure -f noninteractive unattended-upgrades || true   # mises à jour de sécurité automatiques

echo "== 2/8 Node.js 22 (LTS)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<13)){console.error("Node.js >= 22.13 requis");process.exit(1)}'

echo "== 3/8 Navigateur pour les PDF"
CHROME=""
if [ "$ID" = "debian" ]; then apt-get install -y chromium; CHROME=/usr/bin/chromium
else
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
  apt-get update -y && apt-get install -y google-chrome-stable; CHROME=/usr/bin/google-chrome-stable
fi

echo "== 4/8 Caddy (HTTPS automatique)"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "== 5/8 Utilisateur, code et dépendances"
id immopilot >/dev/null 2>&1 || useradd --system --home /var/lib/immopilot --shell /usr/sbin/nologin immopilot
install -d -o immopilot -g immopilot -m 0700 /var/lib/immopilot
install -d -m 0755 /opt/immopilot
if [ -d /opt/immopilot/src/.git ]; then git -C /opt/immopilot/src pull --ff-only; else git clone --depth 1 -b "$BRANCH" "$REPO" /opt/immopilot/src; fi
APP=/opt/immopilot/src/application
[ -f "$APP/server/server.js" ] || { echo "Dossier application/server introuvable dans le dépôt."; exit 1; }
(cd "$APP/server" && npm ci --omit=dev --no-audit --no-fund)

echo "== 6/8 Configuration (/etc/immopilot/immopilot.env, lisible par root et le service uniquement)"
install -d -m 0750 -g immopilot /etc/immopilot
if [ ! -f /etc/immopilot/immopilot.env ]; then
  TOKEN=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)
  cat > /etc/immopilot/immopilot.env <<ENV
# Réglages ImmoPilot — modifiez puis : sudo systemctl restart immopilot
IMMO_EDITION=$EDITION
PUBLIC_URL=https://$DOMAIN/
ADMIN_EMAIL=$ADMIN
ADMIN_TOKEN=$TOKEN
DATA_DIR=/var/lib/immopilot
HOST=127.0.0.1
PORT=8080
CHROMIUM_PATH=$CHROME
# E-mails (obligatoire pour les invitations et liens d'activation) : SMTP de votre fournisseur (Brevo, Mailjet, OVH, Gmail Workspace…)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=no-reply@$DOMAIN
MAIL_DAILY_QUOTA=2000
ENV
fi
chown root:immopilot /etc/immopilot/immopilot.env; chmod 0640 /etc/immopilot/immopilot.env

echo "== 7/8 Service, HTTPS, pare-feu, sauvegardes"
install -m 0644 "$APP/server/deploy/immopilot.service" /etc/systemd/system/immopilot.service
sed "s/{{DOMAIN}}/$DOMAIN/g" "$APP/server/deploy/Caddyfile" > /etc/caddy/Caddyfile
install -m 0755 "$APP/server/deploy/backup.sh" /usr/local/sbin/immopilot-backup
install -m 0755 "$APP/server/deploy/update.sh" /usr/local/sbin/immopilot-update
printf '#!/bin/sh\nset -a; . /etc/immopilot/immopilot.env; set +a\nexec node %s/server/cli.js "$@"\n' "$APP" > /usr/local/bin/immopilot; chmod 0750 /usr/local/bin/immopilot
echo "15 3 * * * root /usr/local/sbin/immopilot-backup >> /var/log/immopilot-backup.log 2>&1" > /etc/cron.d/immopilot-backup
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null
systemctl daemon-reload
systemctl enable --now immopilot
systemctl reload caddy || systemctl restart caddy
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1 && break; sleep 1; done

echo "== 8/8 Base de données et premier super administrateur"
/usr/local/bin/immopilot setup | tee /root/immopilot-setup.txt | grep -E "Lien d'activation|\"ok\"|ERREUR|ÉCHEC" || true
echo
echo "Terminé. Ouvrez https://$DOMAIN/"
echo "Lien d'activation du super administrateur : envoyé par e-mail si le SMTP est configuré, et noté dans /root/immopilot-setup.txt (confidentiel)."
echo "Étapes suivantes : renseignez le SMTP dans /etc/immopilot/immopilot.env, puis sudo systemctl restart immopilot."
