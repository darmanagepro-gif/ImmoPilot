# Audit du code existant (phase 4) — préalable à la version 2.0.0

Archive auditée : `ImmoPilot_Complet_.zip` › `immopilot_phase4_build/` — 12 fichiers `.gs` / `.html` de code, 5 fichiers de documentation. Méthode : lecture intégrale des sources, vérification de syntaxe de chaque fichier (`node --check`, aucune erreur), recherche de fonctions dupliquées entre fichiers (aucune), comparaison des en-têtes de tables avec le nouveau schéma (script de comparaison : les 23 tables existantes sont reprises avec leurs colonnes dans le même ordre).

## Inventaire

| Fichier | Contenu | Décision |
|---|---|---|
| Config.gs | Noms des propriétés du script, en-têtes de 23 tables, liste des rôles | Repris et étendu (48 tables, mêmes noms de propriétés) |
| Database.gs | Lecture ligne à ligne, contrôle d'en-têtes **exact** | Réécrit : lecture par nom de colonne, migration additive, encodage sûr des cellules |
| Auth.gs | Identité par `Session.getActiveUser()` | Réécrit : comptes applicatifs (voir constat 1) |
| Permissions.gs | Contrôle par rôle, 1 fonction | Réécrit : capacités par rôle + droits par bien + droits d'agence + assistance |
| Utils.gs | Quelques utilitaires | Repris (normalisation e-mail, identifiants) et étendu |
| Code.gs | `doGet`, `getAppBootstrap`, `getDashboardData` | Remplacé par un routeur unique `api()` / `apiPublic()` |
| Admin.gs | `setupProject`, organisations, utilisateurs, invitations à jeton haché SHA-256 (7 jours) | Repris : même empreinte de jeton (les invitations en cours restent valables), même durée ; super administrateur désormais créé uniquement depuis l'éditeur |
| PropertyService.gs | Biens, résidences, droits d'agence, affectations de personnel | Logique d'accès reprise (propriétaire / agence autorisée / personnel affecté) et complétée |
| ReservationService.gs | Disponibilité, création, annulation, blocages | Réécrit (voir constat 4) |
| Phase4Operations.gs | Check-in/out, missions de ménage avec expiration 2 h, incidents, artisans, devis, interventions, fichiers privés, e-mail, liens `wa.me`, déclencheur | Fonctionnalités reprises et réparties dans 8 services ; fichier à retirer du projet |
| Tests.gs | Tests unitaires et de santé (sans données) | Remplacé par une suite de 55 tests sur base temporaire, plus un scénario d'installation complète sur compte vierge |
| Index / Scripts / Styles.html | Interface simple, console de test JSON intégrée | Remplacés (application monopage, 30 écrans et 4 écrans publics, 3 langues) |

## Points forts conservés

- Choix de pile (Apps Script + Sheets + Drive) et noms des propriétés du script : aucune reconfiguration.
- Toutes les tables et colonnes existantes, dans le même ordre : les données ne sont pas déplacées.
- Bonnes intentions de sécurité déjà présentes : jetons d'invitation hachés, dossier Drive privé, refus côté serveur, `LockService` sur les opérations critiques, clés d'idempotence (`OperationRequests`), expiration des missions de ménage après 2 h.
- Normalisation des numéros marocains pour `wa.me` (reprise et testée).

## Constats et corrections

| # | Gravité | Constat dans la phase 4 | Correction 2.0.0 |
|---|---|---|---|
| 1 | Bloquant | L'identité reposait sur `Session.getActiveUser().getEmail()`. En application web exécutée par le propriétaire et ouverte à des comptes externes, Google renvoie une chaîne vide : les clients externes ne pouvaient pas être identifiés de façon fiable. | Comptes applicatifs : invitation à usage unique, mot de passe PBKDF2, sessions à jeton aléatoire dont seule l'empreinte est stockée, verrouillage après 5 échecs. |
| 2 | Élevée | Le super administrateur accédait à toutes les données de toutes les organisations actives (`getAccessibleOrganizationIds_`), sans trace ni accord du client. | Le super administrateur gère la plateforme (organisations, abonnements, santé, journaux) mais n'accède aux données privées d'un client que par une **assistance** demandée, approuvée par l'organisation, limitée dans le temps, en lecture seule et journalisée. Son rôle n'est créé que depuis l'éditeur (`assertEditor_`) et activé par lien à usage unique. |
| 3 | Élevée | Fonctions d'installation et de test appelables depuis le navigateur via `google.script.run` (toute fonction globale l'est) : `setupProject()`, `runUnitTests()` ou `p4ExpireCleaningMissions()` ne vérifiaient pas qui les lançait (seule `installPhase4Triggers()` exigeait un super administrateur). | Fonctions d'éditeur protégées ; une seule porte d'entrée applicative (`api`, `apiPublic`) ; les tâches planifiées ne renvoient qu'un résumé. |
| 4 | Élevée | Chevauchement calculé sur les seules dates : deux séjours le même jour sans battement de ménage. | Règle horaire : arrivée 15:00, départ 11:00, battement 120 min (paramétrables), contrôle sous verrou, y compris entre agences. `integrityReport_` signale les chevauchements hérités sans les modifier. |
| 5 | Moyenne | Écriture des cellules sans encodage : textes commençant par `=`, `+`, `-`, `@` interprétés comme formules ; numéros perdant leur zéro initial ; dates et heures converties par Sheets. | Toute valeur texte est écrite en texte forcé ; exports CSV neutralisés. |
| 6 | Moyenne | Contrôle d'en-têtes exact : tout ajout de colonne cassait la lecture. | Lecture par nom ; migrations versionnées, additives, avec sauvegarde préalable. |
| 7 | Moyenne | Fichiers Drive référencés dans des colonnes JSON, sans registre ni contrôle par fichier. | Table `Documents` (propriétaire, organisation, bien, sensibilité, empreinte SHA-256) ; fichiers historiques enregistrés par la migration ; téléchargement uniquement via le serveur après contrôle ; vérification du type réel (octets magiques), taille maximale 4 Mo. |
| 8 | Moyenne | Deux tables d'incidents (`Incidents` phase 3, `IncidentsV4` phase 4). | `IncidentsV4` devient la référence ; les anciens incidents y sont copiés, l'original n'est pas touché. |
| 9 | Moyenne | Lecture complète d'une feuille à chaque appel, plusieurs fois par requête. | Une lecture par table et par requête (mémoire de requête), pagination serveur. |
| 10 | Faible | Console de test JSON dans l'interface de production. | Supprimée de l'interface ; diagnostics réservés au super administrateur (Administration › Santé) et à l'éditeur. |
| 11 | Faible | Pas de manifeste `appsscript.json` livré (fuseau, mode d'exécution, portées implicites). | Manifeste fourni avec fuseau Africa/Casablanca et portées explicites. |
| 12 | Fonctionnel | Absents : finance, baux, abonnements, tableaux de bord par rôle, Pareto, rapports, notifications internes, multilingue. | Implémentés (voir CHANGELOG.md). |

## Correspondance des fonctions historiques

Voir CHANGELOG.md, section « Correspondance ». `Compat.gs` conserve `p4ExpireCleaningMissions()` et `installPhase4Triggers()` pour qu'un ancien déclencheur encore présent ne tombe pas en erreur ; `installTriggers()` le remplace.
