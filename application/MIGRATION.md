# Migration depuis la phase 4 vers ImmoPilot 2.0.0

> **Installation neuve, sans données existantes : ce document ne vous concerne pas.** Suivez DEPLOIEMENT.md : `setupProject()` crée tout à partir de rien.

Principe : **aucune donnée n'est supprimée, vidée, renommée ni réordonnée.** La migration ajoute des onglets et des colonnes, complète des valeurs vides et copie certaines lignes ; les onglets historiques restent en place.

## Avant de commencer

1. Copie manuelle du Google Sheet de base (Fichier › Créer une copie) et du projet Apps Script. Notez les identifiants.
2. Prévenez les utilisateurs : après la migration, chacun devra **activer son compte ImmoPilot** (voir « Comptes »).
3. Choisissez un moment creux : `setupProject()` prend le verrou du script pendant la migration (jusqu'à quelques minutes sur une grosse base).

## Ce que fait `setupProject()`

La fonction exécute les migrations versionnées enregistrées dans l'onglet `MigrationHistory`. Une migration marquée `DONE` n'est jamais rejouée ; une migration en échec est marquée `FAILED` avec le message, sans annuler les précédentes, et pourra être relancée.

**Sauvegarde automatique préalable** : s'il reste au moins une migration à appliquer et que la base contient des données, une copie complète et privée du classeur est créée dans `Sauvegardes` (`pre-migration`) avant toute écriture.

| Version | Nom | Effet |
|---|---|---|
| 1 | `schema_sync` | Crée les onglets absents ; ajoute à droite les colonnes manquantes (lecture des en-têtes par nom). Refuse de continuer si un onglet contient deux en-têtes identiques (rien n'est modifié, l'erreur liste les en-têtes à corriger). Rejouée à chaque `setupProject()`, idempotente. |
| 2 | `backfill_phase4_to_v2` | Complète les données existantes (détail ci-dessous). |
| 3 | `platform_seed` | Crée les forfaits Essentiel, Pro, Business s'ils n'existent pas, et l'organisation technique « ImmoPilot Plateforme » qui porte les rôles super administrateur. |

### Détail de la migration 2

- **Identifiants manquants** : toute ligne non vide sans clé primaire reçoit un identifiant stable.
- **Organisations** : type déduit des rôles (`AGENCY` si des rôles agence y sont rattachés, `PLATFORM` si uniquement super administrateur, sinon `OWNER_ORG`) ; fuseau et langue par défaut.
- **Utilisateurs** : préférences de notification par défaut (e-mail activé), langue `fr`.
- **Réservations** : `paymentStatus = UNPAID` (jamais « payé » par défaut), `version = 0`, devise MAD, source `DIRECT`, calcul des instants `checkInAt` / `checkOutAt` à partir des dates et des heures du bien (15:00 / 11:00 par défaut). Un statut inconnu devient `CONFIRMED`.
  ⚠️ La phase 4 autorisait deux séjours le même jour sans battement. Les réservations existantes ne sont pas modifiées, mais `integrityReport_` (Administration › Santé, ou `healthCheck()`) signale les chevauchements à arbitrer manuellement.
- **Incidents** : l'ancien onglet `Incidents` (phase 3) est **copié** dans `IncidentsV4` (l'original reste intact, chaque copie porte `legacyOrigin = Incidents`). Les priorités `LOW/NORMAL/HIGH/URGENT` deviennent des gravités `LOW/MEDIUM/HIGH/CRITICAL`.
- **Devis** : `totalAmount` historique recopié dans `amountHT` / `amountTTC` (TVA 0, à corriger si besoin).
- **Artisans** : rattachement au compte utilisateur portant le même e-mail.
- **Missions de ménage** : priorité `NORMAL`, compteur de réattribution, origine `LEGACY`.
- **Fichiers Drive historiques** : les identifiants de photos et factures stockés dans des colonnes JSON (`CleaningReports.photoFileIdsJson`, `IncidentsV4.photoFileIdsJson`, `WorkOrders.invoiceFileId`) sont enregistrés dans l'onglet `Documents`, afin d'être servis uniquement après contrôle d'accès. Les fichiers eux-mêmes ne sont ni déplacés ni modifiés.

Note technique : lorsqu'une colonne est complétée, la colonne entière est réécrite avec un encodage homogène (les textes sont préfixés d'une apostrophe pour que Sheets ne les convertisse pas en dates ou en nombres). Les valeurs ne changent pas ; seule leur représentation dans la cellule est normalisée.

## Comptes utilisateurs

La phase 4 identifiait les utilisateurs par leur compte Google (`Session.getActiveUser()`), ce qui ne fonctionne pas pour des utilisateurs externes au domaine. La version 2.0.0 utilise des comptes applicatifs avec mot de passe. Les utilisateurs existants **conservent leurs rôles et leurs accès**, mais n'ont pas encore de mot de passe :

- soit ils cliquent sur « Mot de passe oublié » sur l'écran de connexion : un compte actif sans mot de passe reçoit un **lien d'activation** ;
- soit un administrateur ouvre Utilisateurs › « Envoyer un lien d'activation ».

Les invitations en attente créées par la phase 4 restent utilisables jusqu'à leur expiration (même méthode d'empreinte du jeton).

Le rôle super administrateur n'est créé que par `setupProject()` / `createFirstSuperAdmin()` exécutés **depuis l'éditeur** par le propriétaire du script (en phase 4, `setupProject()` pouvait être appelée depuis le navigateur). Les super administrateurs existants conservent leur rôle mais n'ont plus accès aux données privées des clients sans assistance approuvée (voir SECURITE.md).

## Abonnements

Une organisation qui n'a **aucun** abonnement (cas de toutes les organisations migrées) garde l'accès complet. Le super administrateur leur attribue ensuite un forfait (Abonnements › Attribuer). Le paramètre plateforme `billing.enforce` permet de désactiver toute restriction liée aux forfaits.

## Fichiers du projet Apps Script

| Ancien fichier | Action |
|---|---|
| `Code.gs`, `Config.gs`, `Auth.gs`, `Permissions.gs`, `Database.gs`, `Utils.gs`, `Admin.gs`, `PropertyService.gs`, `ReservationService.gs`, `Tests.gs` | Remplacer entièrement par la nouvelle version |
| `Index.html`, `Styles.html`, `Scripts.html` | Remplacer entièrement (la console de test JSON de la phase 4 n'existe plus dans l'interface) |
| `Phase4Operations.gs` | **Supprimer** : ses fonctions sont reprises par CheckInOutService, CleaningService, IncidentService, ContractorService, WorkOrderService, NotificationService, DriveService. Le fichier `Compat.gs` garde les noms `p4ExpireCleaningMissions` et `installPhase4Triggers` pour qu'un ancien déclencheur ne tombe pas en erreur. |
| Documentation collée dans le projet (`README`, `README_Phase4`, `CODE_COMPLET_A_COPIER`, `TESTS_ET_LIVRAISON`, `LIRE_EN_PREMIER`) | Supprimer du projet Apps Script (garder vos copies locales si vous le souhaitez) |

`installTriggers()` supprime l'ancien déclencheur `p4ExpireCleaningMissions` et installe `jobFrequent` / `jobDaily`.

## Vérifications après migration

1. `healthCheck()` : `ok: true`, aucune colonne manquante, migrations `[1, 2, 3]`, rapport d'intégrité.
2. Onglet `MigrationHistory` : trois lignes `DONE` et le détail JSON de chaque migration (nombre de lignes complétées, incidents copiés, documents enregistrés).
3. Comparez le nombre de lignes de chaque onglet avec la copie de l'étape 1 : il doit être **identique ou supérieur** (jamais inférieur).
4. Ouvrez trois biens, trois réservations et un incident migrés dans l'application avec un compte propriétaire et un compte agence.

## Retour arrière

- **Avant d'avoir de nouvelles saisies** : remettez dans `IMMO_DATABASE_SPREADSHEET_ID` l'identifiant de la copie de l'étape 1 (ou de la sauvegarde `pre-migration`) et revenez au projet Apps Script copié.
- **Après de nouvelles saisies** : `restoreFromBackup("ID_DE_LA_SAUVEGARDE")` crée d'abord une sauvegarde de sécurité, puis une **copie** de la sauvegarde choisie devient la base active. Aucune base n'est écrasée ; l'identifiant de la base précédente est renvoyé pour pouvoir y revenir.

## Évolution ultérieure vers une base SQL

Voir ARCHITECTURE.md, section « Migration vers une base SQL ».
