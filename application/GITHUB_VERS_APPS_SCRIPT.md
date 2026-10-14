# Relier GitHub à Google Apps Script (réglage unique, environ 10 minutes)

Une fois ce réglage fait, chaque mise à jour publiée dans `application/dist/` est envoyée automatiquement dans votre projet
Apps Script et le déploiement existant est mis à jour (même adresse `/exec`) : plus aucun copier-coller.
Vous pouvez aussi lancer l'envoi à la main : onglet **Actions** › **Déployer sur Apps Script** › **Run workflow**.

## 1. Autoriser l'API Apps Script
Ouvrez https://script.google.com/home/usersettings (avec le compte propriétaire du script) et activez **API Google Apps Script**.

## 2. Copier l'ID du script
Dans votre projet Apps Script : ⚙️ **Paramètres du projet** › **ID du script** › **Copier**.

## 3. Créer la clé de connexion (sans rien installer, depuis le navigateur)
1. Sur https://github.com/darmanagepro-gif/ImmoPilot : bouton vert **Code** › onglet **Codespaces** › **Create codespace on main**.
2. Dans le terminal qui s'ouvre en bas, collez : `npx -y @google/clasp@3.4.1 login --no-localhost` puis Entrée.
3. Ouvrez le lien affiché, choisissez votre compte Google (celui du script), **Autoriser**.
4. Le navigateur arrive sur une page « inaccessible » (adresse commençant par `http://localhost:8888/?…code=`) : c'est normal.
   Copiez **toute l'adresse** de cette page, collez-la dans le terminal, Entrée.
5. Tapez `cat ~/.clasprc.json` puis Entrée, et copiez tout le texte affiché (de `{` à `}`).

## 4. Enregistrer les deux secrets
Sur GitHub : **Settings** › **Secrets and variables** › **Actions** › **New repository secret** :
- Nom `CLASPRC_JSON` : collez le texte copié à l'étape 3.5.
- Nom `APPS_SCRIPT_ID` : collez l'ID du script (étape 2).

## 5. Fermer le Codespace
https://github.com/codespaces › **…** › **Delete** (la clé n'y reste pas).

## 6. Premier envoi
Onglet **Actions** › **Déployer sur Apps Script** › **Run workflow**. Coche verte = c'est en ligne.
Si une nouvelle autorisation est demandée (nouvelle fonction comme l'assistant IA), ouvrez l'éditeur Apps Script,
exécutez une fois `verifierInstallation` et cliquez sur **Autoriser**.

## Sécurité
- La clé `CLASPRC_JSON` donne accès à vos projets Apps Script et aux fichiers créés par clasp sur votre compte Google :
  ne la copiez nulle part ailleurs que dans le secret GitHub. Les secrets ne sont jamais affichés dans les journaux
  et ne sont pas transmis aux copies (forks) du dépôt.
- Pour couper l'accès : supprimez le secret, et retirez « clasp » dans https://myaccount.google.com/permissions.
- Toute modification publiée dans `application/dist/` part en production : ne donnez l'accès en écriture au dépôt qu'à des personnes de confiance.
