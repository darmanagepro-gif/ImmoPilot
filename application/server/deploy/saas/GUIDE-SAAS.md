# ImmoPilot en SaaS — guide d'installation (VPS Hostinger)

Une seule installation met en ligne **5 adresses** sur votre serveur :

| Adresse | Rôle |
|---|---|
| `https://DOMAINE/` | Vitrine : présentation, tarifs Maroc / France, démo, inscription |
| `https://maroc.DOMAINE/` | ImmoPilot Maroc (dirham) — vrais clients |
| `https://france.DOMAINE/` | ImmoPilot France (euro) — vrais clients |
| `https://demo-maroc.DOMAINE/` | Démo Maroc : sans compte, lecture seule, données fictives |
| `https://demo-france.DOMAINE/` | Démo France : sans compte, lecture seule, données fictives |

Les 4 versions ont des **bases de données séparées** (un client Maroc ne voit jamais la France, la démo ne touche jamais aux vrais clients).

## Ce que fait le mode SaaS

- **Inscription en ligne** : sur l'écran de connexion (ou `https://maroc.DOMAINE/inscription`), le propriétaire ou l'agence choisit son forfait, donne son nom et son e-mail. Son espace est créé avec **2 mois d'essai gratuit** (réglable), puis il reçoit un e-mail pour choisir son mot de passe. Vous recevez un e-mail à chaque nouvelle inscription.
- **Fin d'essai** : l'abonnement passe « échéance dépassée », puis « suspendu » (lecture seule) 15 jours plus tard s'il n'est pas payé — comme aujourd'hui. Vous enregistrez les paiements dans *Abonnements*.
- **Inscriptions jamais activées** : désactivées automatiquement après 14 jours.
- **Démos** : données fictives recréées chaque lundi à 4 h 30.
- **Sauvegardes** : chaque nuit à 3 h 15 (Maroc et France), conservées 14 jours dans `/var/backups/immopilot`.

> Le **prélèvement automatique par carte (SumUp)** n'est pas encore branché : il faut d'abord les clés API de votre compte SumUp et le choix de la devise avec votre banque.

## Installation (une seule fois, 10 à 15 minutes)

1. Dans **hPanel Hostinger › VPS**, choisissez le système **Ubuntu 24.04** (sans panneau de contrôle), puis notez l'**adresse IP** et le **mot de passe root**.
2. Ouvrez le **Terminal du navigateur** (bouton « Terminal » / « Browser terminal » dans hPanel) ou, sur votre ordinateur : `ssh root@VOTRE_IP`.
3. Collez ces deux lignes (remplacez l'e-mail par le vôtre) :

```bash
curl -fsSL https://raw.githubusercontent.com/darmanagepro-gif/ImmoPilot/main/application/server/deploy/saas/install-saas.sh -o install-saas.sh
sudo bash install-saas.sh auto abder.loulou@icloud.com
```

`auto` = pas encore de nom de domaine : le site reçoit une adresse automatique du type `https://31-220-10-20.sslip.io/` (avec cadenas HTTPS). À la fin, le script affiche les 5 adresses et vos **liens d'activation** de super administrateur (un par version).

4. **E-mails (indispensable pour l'inscription)** : ouvrez le réglage et remplissez le SMTP (par exemple une boîte `contact@votredomaine` chez Hostinger Mail, ou un compte Brevo gratuit) :

```bash
sudo nano /etc/immopilot/smtp.env      # Ctrl+O pour enregistrer, Ctrl+X pour quitter
sudo immopilot-saas restart
```

Hostinger Mail : `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER` et `MAIL_FROM` = votre adresse, `SMTP_PASS` = son mot de passe (entre apostrophes s'il contient des symboles : `SMTP_PASS='mot$de#passe'`).

## Passer à votre nom de domaine (plus tard)

1. Achetez le domaine (ex. `immopilot.ma` ou `immopilot.com`).
2. Dans la zone DNS du domaine, créez ces enregistrements **A** vers l'IP du VPS : `@`, `www`, `maroc`, `france`, `demo-maroc`, `demo-france` (ou un seul enregistrement `*` + `@`).
3. Attendez quelques minutes, puis : `sudo immopilot-saas domaine immopilot.com`

Les données sont conservées ; seules les adresses changent.

## Commandes utiles

```bash
sudo immopilot-saas status          # état des 4 versions
sudo immopilot-saas update          # sauvegarde + dernière version depuis GitHub + redémarrage
sudo immopilot-saas logs maroc      # journal d'une version
sudo immopilot-saas backup          # sauvegarde immédiate
sudo immopilot-saas demo-reset      # recrée les démos
sudo immopilot-saas cli maroc set IMMO_AI_API_KEY sk-...   # réglages avancés (clé IA, etc.)
```

Durée d'essai ou fermeture de l'inscription : dans `/etc/immopilot/maroc.env` (ou `france.env`), `SIGNUP_TRIAL_DAYS=60` / `SIGNUP_OPEN=false`, puis `sudo immopilot-saas restart`.

## Et la version Google Apps Script ?

Elle continue de fonctionner sans changement (l'inscription en ligne y reste fermée). Pour transférer vos clients actuels vers le serveur, voir `application/MIGRATION.md`.
