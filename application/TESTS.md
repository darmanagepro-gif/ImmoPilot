# Tests d'ImmoPilot 2.0.0

Règle suivie : un test n'est déclaré « réussi » que s'il a réellement été exécuté. Ce qui n'a pas pu l'être dans l'environnement de développement est listé comme tel, avec le test manuel à faire dans Google.

## Environnement d'exécution

Les tests ont été exécutés **hors de Google** le 13 octobre 2026, avec Node.js 22, dans un simulateur des services Apps Script (`tests/gas-mock.js`). Le simulateur reproduit SpreadsheetApp (y compris les conversions automatiques de Sheets : textes en dates, heures, pourcentages, perte des zéros initiaux, formules), DriveApp, DocumentApp (partiel), MailApp (boîte d'envoi fictive), LockService, CacheService, PropertiesService, Utilities (SHA-256, HMAC, base64, UUID, formatage de dates). **Il ne remplace pas une exécution dans Google** : voir la dernière section.

Commandes (depuis le dossier du projet) :

```
node tests/run-tests.js                                  # suite serveur + cohérence des routes + rendu doGet
NODE_PATH=<node_modules avec jsdom> node tests/ui-smoke.js   # interface, 8 rôles, 3 langues
NODE_PATH=<node_modules avec chart.js, leaflet> node tests/preview-server.js   # prévisualisation locale
```

## Synthèse des résultats

| Catégorie | Nombre | Détail |
|---|---|---|
| Exécutés et réussis | 55 tests serveur + scénario d'installation sur compte vierge (10 étapes) + 4 contrôles automatiques + test d'interface (8 profils, 155 écrans) + 11 captures dans Chromium | ci-dessous |
| Exécutés et échoués | 0 | — |
| Non exécutés | voir « Non exécutés » | M-01 à M-12 |
| Nécessitant Google | `runAllTests()` dans Apps Script et les tests manuels M-01 à M-12 | à faire avant production |

## 1. Suite serveur (Tests.gs) — 55 / 55 réussis dans le simulateur

Résultat brut : `tests/results.json` — `{"total":55,"passed":55,"failed":0,"skipped":0}`. Chaque test s'exécute sur une base et un dossier temporaires, avec de vraies données (organisations, utilisateurs, biens, réservations…) créées via les routes de l'API, donc avec les contrôles d'accès réels.

| Groupe | Test | Résultat |
|---|---|---|
| Comptes et sécurité | Mot de passe haché (PBKDF2 vecteurs RFC) et jamais stocké en clair | Réussi |
| | Invitation valide → compte activé → connexion | Réussi |
| | Invitation expirée refusée | Réussi |
| | Invitation déjà utilisée refusée | Réussi |
| | Invitation révoquée inutilisable | Réussi |
| | E-mail non autorisé / identifiants invalides / jeton forgé | Réussi |
| | Verrouillage après 5 échecs de connexion | Réussi |
| | Utilisateur suspendu : sessions révoquées et connexion refusée | Réussi |
| | Organisation suspendue : accès coupé, données conservées | Réussi |
| | Accès au bien d'un autre propriétaire refusé (IDOR) | Réussi |
| | Super administrateur sans accès aux données privées sauf assistance approuvée | Réussi |
| | Élévation de privilèges impossible | Réussi |
| | Attribution d'agence, cloisonnement entre agences et révocation | Réussi |
| | Agence en consultation seule ne peut pas réserver | Réussi |
| | Document privé : téléchargement refusé sans droit | Réussi |
| | Modèle de document : seul un Google Docs du dossier « Modeles » est accepté (le document d'un autre client est refusé, contrôle refait à la génération) | Réussi |
| | Fichier refusé si le contenu ne correspond pas au type annoncé | Réussi |
| | Injection de formule neutralisée (Sheets et CSV) | Réussi |
| | Fonctions d'installation refusées hors éditeur | Réussi (simulateur) — dans Google : SKIP, voir M-02 |
| Réservations | Réservation valide, montants calculés côté serveur | Réussi |
| | Double réservation refusée (chevauchement) | Réussi |
| | Double réservation refusée même via une autre agence | Réussi |
| | Départ 11:00 et arrivée 15:00 le même jour autorisés ; arrivée 12:00 refusée (battement 120 min) | Réussi |
| | Double soumission (même clé) : un seul enregistrement | Réussi |
| | Requêtes concurrentes : contrôle de chevauchement sous verrou | Réussi (simulateur, concurrence simulée) — dans Google : SKIP, voir M-05 |
| | Modification avec contrôle de version | Réussi |
| | Paiement partiel, solde restant, remboursement plafonné | Réussi |
| | Annulation selon la politique (pénalité) et remboursement dû | Réussi |
| | Blocage de calendrier respecté | Réussi |
| Check-in / check-out et ménage | Gardien affecté à une réservation : accès limité à celle-ci | Réussi |
| | Check-in avec photo et checklist, puis check-out → mission de ménage auto | Réussi |
| | Expiration après 2 h (tâche planifiée) puis réattribution | Réussi |
| | Acceptation, photos avant/après obligatoires, fin, validation et dépense unique | Réussi |
| | Refus de mission → retour à attribuer + alerte | Réussi |
| Maintenance | Chaîne complète incident → devis → intervention → facture, commission de 15 % calculée une seule fois | Réussi |
| | Taux de commission configurable (prestataire et intervention) | Réussi |
| | Intervention sans devis refusée (sauf urgence critique) | Réussi |
| Longue durée | Bail : échéancier, paiement partiel, retard, quittance, fin | Réussi |
| | Échéancier : proratisation et indexation (calcul pur) | Réussi |
| KPI et Pareto | Pareto : classement, parts, cumul, seuil 80 % | Réussi |
| | Pareto : données vides, valeurs nulles, négatives, catégories inconnues, égalités | Réussi |
| | Pareto serveur, filtre de période et cohérence tableau / export CSV | Réussi |
| | KPI : revenus proratisés, dépenses, occupation, annulations | Réussi |
| | Tableaux de bord par rôle sur données réelles | Réussi |
| | Rapports : export respectant les permissions | Réussi |
| Abonnements | Essai, échéance impayée, suspension en lecture seule, paiement manuel | Réussi |
| | Quota de biens du forfait appliqué | Réussi |
| Données, migration, robustesse | Installation à partir de rien : base créée privée dans le dossier privé, 48 onglets, forfaits, organisation plateforme, propriétaire du script super administrateur, aucune recréation à la seconde exécution, aucune sauvegarde inutile | Réussi |
| | Migration non destructive d'une base de la phase 4 (lignes conservées, identifiants complétés, colonnes ajoutées à droite, incidents historiques copiés, réservations non marquées payées, dates héritées relues correctement, chevauchement hérité signalé, migration rejouable sans doublon) | Réussi |
| | Détection des doublons d'identifiants | Réussi |
| | Sauvegarde et restauration non destructive | Réussi (simulateur) — dans Google : sauvegarde testée, restauration SKIP, voir M-09 |
| | Erreur d'écriture : réponse propre avec référence, sans fuite technique | Réussi (simulateur, panne injectée) — dans Google : SKIP |
| | Quota e-mail épuisé : invitation enregistrée, statut EMAIL_FAILED | Réussi |
| | Lien WhatsApp encodé (sans envoi automatique) | Réussi |
| | Notifications sans doublon (clé d'événement) | Réussi |

Pendant cette livraison, deux défauts réels ont été trouvés et corrigés avant le résultat ci-dessus : (1) un administrateur d'organisation pouvait désigner comme « modèle » n'importe quel fichier du compte déployeur, y compris un document d'un autre client — un contrôle a été ajouté et on a vérifié que le test échoue si on le retire ; (2) le test de migration a révélé un défaut (dates d'une ancienne base relues sous la forme « Sun Mar 01 ») , corrigé par `isDateObj_`.

## 2. Installation sur un compte Google vierge (run-tests.js) — 10 / 10 étapes réussies

Scénario rejoué dans un simulateur neuf, sans aucune propriété du script ni aucun fichier, en suivant exactement DEPLOIEMENT.md :

| Étape | Résultat |
|---|---|
| Propriétés du script vides au départ | Réussi |
| `setupProject()` crée la base, le dossier privé et le schéma ; votre adresse devient super administrateur | Réussi |
| Avant déploiement : pas de lien envoyé, message explicite | Réussi |
| `setupProject()` relancé : même base, rien de recréé | Réussi |
| Déploiement simulé, `IMMO_APP_URL` renseignée, `createFirstSuperAdmin()` envoie le lien | Réussi |
| `installTriggers()` puis `healthCheck()` entièrement au vert | Réussi |
| Activation par le lien puis connexion du super administrateur | Réussi |
| Le lien d'activation ne peut pas être réutilisé | Réussi |
| Création de la première organisation cliente et invitation du propriétaire | Réussi |
| Le propriétaire accepte l'invitation, se connecte, crée son premier bien ; le super administrateur ne le voit pas sans assistance | Réussi |

## 3. Contrôles automatiques (run-tests.js) — réussis

| Contrôle | Résultat |
|---|---|
| Routes : chaque appel de l'interface correspond à une route serveur | 157 routes authentifiées, 9 publiques ; 0 route absente ; 0 fonction de traitement indéfinie |
| Rendu de `doGet()` (application, invitation, réinitialisation, portail) | Réussi |
| Syntaxe de tous les fichiers (`node --check`) | Réussi |
| Variables non définies (ESLint `no-undef`, serveur et client) | 0 erreur |

Limite : la vérification des routes ne détecte que les appels écrits littéralement dans le code client (37 routes distinctes) ; les autres routes sont couvertes par le test d'interface et par la suite serveur.

## 4. Test d'interface de bout en bout (ui-smoke.js) — réussi

L'interface complète (les 8 fichiers HTML) est chargée dans jsdom, connectée au code serveur réel via le simulateur, avec un jeu de données de démonstration. Pour chaque profil, toutes les entrées du menu et les fiches de détail sont ouvertes ; on vérifie l'absence d'erreur JavaScript et d'erreur serveur, la présence du titre de la page, puis on tente d'ouvrir des fiches **hors du périmètre** de l'utilisateur, qui doivent être refusées.

| Profil | Langue | Écrans ouverts | Appels serveur réussis | Fiches hors périmètre refusées |
|---|---|---|---|---|
| Propriétaire | FR | 30 | 38 | 0 (tout est dans son périmètre) |
| Agence (administrateur) | FR | 30 | 36 | 2 |
| Agence (collaborateur) | EN | 24 | 29 | 3 |
| Gardien | FR | 14 | 12 | 6 |
| Ménage | FR | 13 | 10 | 6 |
| Artisan | FR | 15 | 15 | 3 |
| Locataire | AR (droite-gauche) | 13 | 9 | 7 |
| Super administrateur (sans assistance) | FR | 16 | 11 | 8 |
| Écrans publics : connexion, portail voyageur, invitation, réinitialisation | FR | 4 | — | — |

Total : 155 écrans, 160 appels réussis, 35 refus attendus, **0 problème**. Dernière exécution après les dernières modifications du code. Les traductions sont complètes (1 039 libellés, 364 codes de statut, 0 manquant).

## 5. Rendu dans un vrai navigateur — réalisé

11 écrans ouverts dans Chromium (Playwright) via le serveur de prévisualisation, sans erreur JavaScript, et vérifiés visuellement : connexion, tableau de bord propriétaire, biens, calendrier, Pareto (graphique Chart.js avec courbe cumulée et seuil 80 %), finances, gardien sur mobile, ménage sur mobile, bail du locataire en arabe (droite-gauche), administration, portail voyageur.

## 6. Non exécutés — à faire dans Google avant production

Ces tests dépendent du vrai environnement Google et **n'ont pas été exécutés**.

| Réf. | Test | Procédure | Attendu |
|---|---|---|---|
| M-01 | Installation réelle puis suite complète dans Apps Script | Procédure DEPLOIEMENT.md sur votre compte, puis éditeur › `runAllTests()` | `failed: 0` ; SKIP attendus : M-02, M-05, M-09, injection de panne |
| M-02 | Fonctions d'éditeur refusées depuis le web | Connecté à l'application, console du navigateur : `google.script.run.withFailureHandler(console.log).setupProject()` (idem `backupNow`, `runAllTests`) | Erreur « Fonction réservée au propriétaire du script » ; rien n'est modifié |
| M-03 | Cloisonnement avec de vrais comptes | Deux propriétaires, une agence autorisée sur un seul bien, un gardien, un locataire ; essayer d'ouvrir les URL `#property/ID` des autres | « Introuvable ou accès refusé » partout hors périmètre |
| M-04 | Utilisateur externe sans compte Google | Navigation privée, sans être connecté à Google : invitation → activation → connexion | Fonctionne ; aucune demande de connexion Google |
| M-05 | Double réservation simultanée | Deux navigateurs, même bien, mêmes dates, valider au même instant | Une seule réservation créée, l'autre reçoit « Conflit » |
| M-06 | E-mails réels | Invitation, activation, mot de passe oublié, notification | Reçus (vérifier les indésirables), liens vers l'URL `/exec`, expéditeur = compte déployeur |
| M-07 | Confidentialité Drive | Téléverser photo et pièce d'identité ; ouvrir le dossier racine dans Drive › Partager | « Accès limité », aucun autre compte ; un utilisateur sans droit ne peut pas télécharger |
| M-08 | PDF et modèles Docs | Générer fiche de réservation, bail, quittance, avec et sans modèle `{{balises}}` | PDF corrects, copie du modèle privée, balises remplacées |
| M-09 | Restauration | Sur une **copie** du projet : `backupNow()`, modifier une donnée, `restoreFromBackup("ID")` | Base restaurée, ancienne base et sauvegarde intactes |
| M-10 | Temps de connexion | Chronométrer une connexion avec 2 000 itérations puis avec la valeur visée | Moins de 3 s environ ; ajuster `IMMO_PBKDF_ITERATIONS` |
| M-11 | Téléchargements sur mobile | Export CSV, PDF de bail sur Android et iOS | Fichier enregistré ou ouvert |
| M-12 | Intégration dans un site tiers | Insérer l'URL `/exec` dans une `<iframe>` d'une autre page | Affichage refusé par le navigateur |
| M-13 | Tâches planifiées | Après `installTriggers()`, attendre 15 min puis consulter Administration › Tâches | Exécutions `jobFrequent` réussies ; `jobDaily` le lendemain |
| M-14 | Volume | Base avec 2 000 réservations : temps d'ouverture du tableau de bord et du calendrier | Acceptable pour vos utilisateurs ; sinon voir ARCHITECTURE.md › SQL |
| M-15 | Ressources externes dans HtmlService | Ouvrir l'application sur le réseau de vos utilisateurs | Police IBM Plex, graphiques et carte affichés |
