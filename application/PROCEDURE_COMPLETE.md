# ImmoPilot — procédure complète (de l'installation à la mise en ligne)

## A. Mettre à jour l'application (à chaque nouvelle version)
1. Ouvrez votre projet Google Apps Script (script.google.com).
2. Fichier **ImmoPilot.gs** : sélectionnez tout (Ctrl + A), supprimez, collez le contenu de `1_ImmoPilot_gs_A_COLLER.txt`. Enregistrez (Ctrl + S).
3. Fichier **Index.html** : même chose avec `2_Index_html_A_COLLER.txt`. Enregistrez.
4. Aucun autre fichier ne doit rester dans le projet (sauf `appsscript.json`, caché par défaut).
5. Exécutez **verifierInstallation** : « ok: true » attendu.
6. **Déployer › Gérer les déploiements** › crayon du déploiement existant › **Version : Nouvelle version** › **Déployer**.
   Ne créez jamais de « Nouveau déploiement » : l'adresse /exec changerait et le site GitHub ne la connaîtrait plus.
7. Ouvrez https://darmanagepro-gif.github.io/ImmoPilot/ et rechargez (Ctrl + F5).

Les nouvelles colonnes de la base s'ajoutent toutes seules à la première ouverture (aucune donnée modifiée).

## B. Installation à partir de rien (première fois seulement)
1. Nouveau projet Apps Script, fichiers `ImmoPilot.gs` et `Index.html` collés comme en A.
2. Exécutez **setupProject** et acceptez les autorisations : base Google Sheet privée, dossier Drive privé, vous devenez super administrateur.
3. **Déployer › Nouveau déploiement** › Application Web › Exécuter en tant que : **moi** › Accès : **Tout le monde** › Déployer. Copiez l'URL /exec.
4. Propriétés du script : `IMMO_APP_URL` = `https://darmanagepro-gif.github.io/ImmoPilot/`, `IMMO_EMBED_ORIGINS` = `https://darmanagepro-gif.github.io`.
5. Exécutez **createFirstSuperAdmin** (lien d'activation par e-mail) puis **installTriggers** (tâches automatiques).
6. Nouvelle version du déploiement (A.6).

## C. Démonstration (comptes, biens, 6 mois d'historique)
1. Exécutez **creerEnvironnementDemo** : organisations « DÉMO », comptes (liens d'activation envoyés), 3 biens, agence créée par le propriétaire (option de son abonnement), prestataire, gardiens.
2. Exécutez **creerHistoriqueDemo** : réservations, voyageurs complets (tous les occupants avec nationalité, pièce et numéro ; copies « spécimen »), arrivées/départs, ménages avec photos, incidents, devis, interventions, factures, dépenses, bail, loyers, abonnement.
   Relancer ne crée aucun doublon : seuls les éléments manquants sont ajoutés.
3. Comptes : Éric Dupont (super admin), Jean Bernard (propriétaire), Moad Zaira (agence), Mohamed Zetounie (prestataire), 3 gardiens (alias de ecosynergy31@gmail.com). Chacun active son compte par l'e-mail reçu.
4. La démo est exclue de vos statistiques de plateforme, sans e-mails automatiques. **mettreDemoEnVeille** / **reveillerDemo** la suspendent ou la réactivent sans rien supprimer.
5. Démo uniquement : numéros de pièce complets et conservation 200 jours (paramètres de l'organisation de démo). Vos vrais clients : numéros masqués et purge à 30 jours par défaut.

## D. Envoi automatique GitHub → Apps Script (facultatif, réglage unique)
Voir `application/GITHUB_VERS_APPS_SCRIPT.md` : API Apps Script activée, ID du script, clé `clasp` créée dans un Codespace,
secrets `CLASPRC_JSON` et `APPS_SCRIPT_ID`, puis **Actions › Déployer sur Apps Script › Run workflow**. Ensuite, plus de copier-coller.

## E. Assistant Rubban
Actif dès la mise à jour (mode Guide, gratuit). Mode IA facultatif : propriétés `IMMO_AI_PROVIDER` (`anthropic` ou `gemini`) et
`IMMO_AI_API_KEY`, manifeste `3_appsscript_json_FACULTATIF.txt`, puis **testerAssistantIA** et nouvelle version.

## F. Abonnements
**Abonnements › Forfaits** : fixez le prix de l'« Option agences » (par agence et par période) sur chaque forfait.
Les agences créées par un propriétaire n'ont pas d'abonnement propre : elles sont facturées sur le sien.

## G. Google Play (en attente de la validation de votre compte)
Compte validé → test fermé (fichier `.aab` de PWABuilder, 12 testeurs pendant 14 jours), empreinte « signature d'application » Google Play
à ajouter dans `assetlinks.json`, compte de démonstration Jean Bernard à indiquer dans « Accès à l'application », puis publication.
