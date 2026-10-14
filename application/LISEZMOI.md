# ImmoPilot — code de l'application (Google Apps Script)

Ce dossier contient le code complet de l'application ImmoPilot 2.0, publiée par le site https://darmanagepro-gif.github.io/ImmoPilot/.

## Installation rapide (2 fichiers)
1. Dans votre projet Google Apps Script, collez `dist/ImmoPilot.gs` dans le fichier **ImmoPilot.gs** et `dist/Index.html` dans le fichier **Index.html** (remplacez tout le contenu).
2. Facultatif, uniquement pour le mode IA de l'assistant Rubban : remplacez le manifeste par `dist/appsscript.json`.
3. Exécutez `setupProject()` (première installation), puis **Déployer › Gérer les déploiements › Nouvelle version**.

Procédure complète : `DEPLOIEMENT.md`. Sécurité : `SECURITE.md`. Nouveautés : `CHANGELOG.md`.

## Contenu
- `*.gs`, `*.html` : sources (un fichier par service) ; `dist/` : version « 2 fichiers » générée par `node tests/build-bundle.js`.
- `tests/` : tests automatisés (simulateur Apps Script, interface, navigation, assistant).
- `deploiement-web-mobile/` : site installable, projet Android / iPhone (Capacitor), fiche Google Play, guides.

## Sécurité
Aucune clé ni donnée client n'est présente dans ce dépôt. Les identifiants (base, dossier Drive, clé d'IA facultative) sont stockés dans les **propriétés du script** de votre projet Apps Script, jamais dans le code.
