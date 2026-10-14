# Architecture d'ImmoPilot 2.0.0

## Vue d'ensemble

```
Navigateur (application monopage HtmlService)
  Index ─ Styles ─ Components ─ I18n ─ Login ─ Dashboard ─ Pages ─ Scripts
        │  google.script.run.api(jeton, route, arguments)        (appels authentifiés)
        │  google.script.run.apiPublic(route, arguments)         (connexion, invitation, portail voyageur)
        ▼
Apps Script (exécuté en tant que propriétaire du script)
  Code.gs        doGet, routeur api/apiPublic, gestion d'erreurs (référence ERR-xxxx)
  Auth.gs        mots de passe, sessions, réinitialisation, limitation de débit
  Permissions.gs capacités par rôle, accès par bien, agences, assistance, forfaits
  *Service.gs    logique métier (un fichier par domaine)
  Database.gs    accès Sheets typé, lecture par nom de colonne, encodage sûr
  Utils.gs       dates, validation, CSV, verrou réentrant
  DriveService   fichiers privés, contrôle de type, PDF, modèles Docs
  Migrations.gs  migrations additives, sauvegarde, intégrité
  Triggers.gs    tâches planifiées (jobFrequent, jobDaily)
        ▼
Google Sheet (48 onglets)   Drive privé (Organisations/…/Biens/…)   MailApp
```

### Routeur unique

Toutes les fonctions serveur ont un nom terminé par `_` (privées : non appelables depuis le navigateur) sauf les points d'entrée listés dans DEPLOIEMENT.md § 5. Le navigateur n'appelle que `api(jeton, route, arguments)` et `apiPublic(route, arguments)`.

Pour chaque appel `api` :

1. validation du jeton de session (empreinte SHA-256 comparée à `Sessions`, expiration, statut de l'utilisateur) ;
2. construction du « principal » : utilisateur, rôles actifs, organisations, organisations suspendues exclues ;
3. recherche de la route (157 routes authentifiées, 9 publiques) dans une table construite à la demande (`routes_()`), ce qui évite toute dépendance à l'ordre de chargement des fichiers ;
4. le service vérifie la capacité requise **et** l'accès à l'objet (bien, réservation, mission…) ;
5. réponse `{ ok: true, data }` ou `{ ok: false, error: { code, message, ref } }`. Les erreurs internes ne renvoient jamais de trace technique : un identifiant `ERR-xxxx` relie le message affiché à l'entrée correspondante du journal (`ActivityLogs`, action `ERROR`) et aux journaux d'exécution Apps Script.

Écritures sensibles : sous `LockService` (`withLock_`, réentrant) et, pour les créations déclenchées par un formulaire, avec clé d'idempotence (`OperationRequests`) pour qu'une double soumission ne crée qu'un enregistrement.

### Modules

| Service | Domaine |
|---|---|
| OrganizationService | Organisations, statut (suspension sans perte de données), assistance du super administrateur |
| UserService | Invitations, utilisateurs, rôles, droits fins, préférences |
| PropertyService | Biens, résidences, import/export CSV, droits d'agence, affectation du personnel |
| ReservationService | Disponibilités, réservations, calendrier, blocages, annulation, fiche PDF |
| GuestService | Voyageurs, minimisation, purge, portail voyageur à jeton |
| CheckInOutService | Arrivées et départs mobiles (checklist, photos, signature, état des lieux) |
| CleaningService | Missions de ménage : attribution, acceptation sous 2 h, pièces, anomalies, validation |
| IncidentService | Incidents, commentaires, photos, suivi des coûts |
| ContractorService | Artisans et prestataires (spécialités, zones, taux de commission) |
| WorkOrderService | Devis et ordres d'intervention |
| InvoiceService | Factures prestataires, commission |
| FinanceService | Paiements, rapprochement, dépenses, revenus divers, moteur de calcul |
| LeaseService | Locataires, baux, échéancier, quittances, préavis, restitution de caution |
| SubscriptionService | Forfaits, abonnements, paiements manuels, adaptateur de prestataire |
| DashboardService | Tableaux de bord par rôle |
| ParetoService | 10 analyses de Pareto |
| ReportsService | Rapports et exports CSV / PDF |
| NotificationService | E-mail, notifications internes, liens `wa.me`, déduplication |
| AuditService | Journal d'audit |

### Interface

Application monopage : routeur par ancre (`#reservation/ID`), registre `PAGES` (30 écrans, plus 4 écrans publics), constructeur DOM `h()` qui n'utilise jamais `innerHTML` pour des données, menu calculé à partir des capacités renvoyées par `me.get` (le serveur reste l'autorité). Traductions : `I18n.html` (1 039 libellés et 364 codes de statut, FR/EN/AR), sens de lecture droite-gauche en arabe par propriétés CSS logiques. Graphiques Chart.js, carte Leaflet (tuiles OpenStreetMap). Les images sont réduites à 1 600 px côté navigateur avant envoi.

## Règles métier

### Dates et heures

- Fuseau unique : Africa/Casablanca. Les dates sont stockées `AAAA-MM-JJ`, les instants en ISO 8601 UTC.
- Une réservation occupe l'intervalle `[arrivée, départ + battement)`, où arrivée = date d'arrivée à l'heure d'arrivée du bien (15:00 par défaut), départ = date de départ à l'heure de départ (11:00), battement = `reservation.minTurnaroundMinutes` (120 min). Ainsi un départ 11:00 et une arrivée 15:00 le même jour sont compatibles, une arrivée 12:00 ne l'est pas.
- Statuts bloquants : `PENDING`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`. Les blocages de calendrier occupent `[début 12:00, fin 12:00)`. Un bail actif ou en préavis bloque le bien en courte durée.
- Le contrôle de chevauchement est refait **sous verrou** au moment de l'écriture, quelle que soit l'organisation qui réserve (propriétaire ou agence).
- Une réservation n'est jamais marquée payée automatiquement : `paymentStatus` découle uniquement des paiements enregistrés.

### Ménage

Au check-out, une mission est créée. Si elle n'est pas acceptée dans `cleaning.acceptanceMinutes` (120), `jobFrequent` la passe en `EXPIRED`, la remet « à attribuer » et alerte le gestionnaire. Photos avant/après obligatoires (`cleaning.requirePhotos`). La validation crée **une seule** dépense de ménage.

### Finances

Définitions (moteur unique `finCompute_`, utilisé par les tableaux de bord, les rapports et le Pareto) :

| Indicateur | Définition |
|---|---|
| Prévu | Revenu d'hébergement + frais des réservations confirmées / en cours / terminées, **proratisé** aux nuits de la période ; + loyers et charges des échéances de la période. Taxes de séjour suivies à part. |
| Facturé | Montants exigibles des réservations arrivant dans la période (prix + frais + taxes) + échéances de loyer de la période ; côté coûts, factures prestataires approuvées. |
| Encaissé | Paiements entrants enregistrés, datés dans la période. |
| Payé | Paiements sortants (remboursements, factures, cautions restituées, dépenses) datés dans la période. |
| Restant dû | Facturé − encaissé net à ce jour, pour les éléments de la période. |
| Résultat propriétaire | Prévu − dépenses − commissions de gestion proratisées. |
| Occupation | Nuits réservées / nuits disponibles (biens courte durée actifs × jours − nuits bloquées). |
| Prix moyen (ADR) / RevPAR | Revenu d'hébergement / nuits réservées ; revenu d'hébergement / nuits disponibles. |
| Annulations | Réservations annulées dont l'arrivée prévue tombe dans la période. |

Rapprochement : manuel (un paiement est marqué rapproché par un utilisateur habilité, avec référence). Les paiements ne sont jamais supprimés : ils sont annulés (statut `VOID`) avec motif, et l'annulation est journalisée.

### Commission prestataire

- Base : montant **HT** de la facture approuvée (ni le TTC, ni le devis).
- Taux : figé sur l'ordre d'intervention à sa création — saisie > fiche du prestataire > paramètre `commission.contractorRate` (15 %).
- Bénéficiaire : l'agence si l'ordre a été créé par un compte d'une agence autorisée sur le bien, sinon l'organisation propriétaire.
- La commission est retenue sur le versement à l'artisan : net = TTC − commission − TVA sur commission (`commission.vatRate`). Le propriétaire supporte le TTC de la facture (dépense MAINTENANCE) ; la commission est un revenu du bénéficiaire.
- Calcul **unique** à l'approbation, sous verrou, puis `commissionLocked = TRUE`. Aucun autre module ne la recalcule : pas de double comptage.
- Le traitement fiscal de la TVA sur commission est à valider par un comptable.

### Location longue durée

Échéancier mensuel généré à l'activation du bail (périodes mensuelles à partir de la date de début, dernière période partielle proratisée au nombre de jours, indexation annuelle `indexationRate` ; bail sans fin : échéancier glissant sur 12 mois prolongé par `jobDaily`), statut d'échéance calculé (à venir, due, en retard après `rent.graceDays`, partiellement payée, payée). Quittance uniquement pour une échéance intégralement payée.

### Pareto

Calcul pur `paretoCompute_` : agrégation par clé, exclusion des valeurs négatives et non numériques (avec avertissement), tri décroissant puis alphabétique en cas d'égalité, part et part cumulée, éléments « vitaux » = ceux nécessaires pour atteindre 80 % (l'élément qui franchit le seuil est inclus). Comparaison avec la période précédente de même durée. Analyses : incidents par catégorie (nombre et coût), maintenance par catégorie, coûts par prestataire, biens les plus coûteux, motifs d'annulation, anomalies de ménage, retards et non-conformités, dépenses par catégorie, impayés. Chaque analyse ne porte que sur les biens que l'utilisateur a le droit de voir pour la capacité concernée.

### Abonnements

Forfaits Essentiel (5 biens, 3 utilisateurs), Pro (25 / 15), Business (200 / 100), modifiables par le super administrateur. Essai, échéance, période de grâce, suspension **en lecture seule** (aucune donnée supprimée). Paiement : saisie manuelle uniquement ; `PAYMENT_PROVIDERS_` définit l'interface d'un futur prestataire, seul `MANUAL` est implémenté.

## Limites de la plateforme Google

| Limite | Effet | Parade dans ImmoPilot |
|---|---|---|
| 6 min par exécution | Requêtes très lourdes interrompues | Pagination, exports plafonnés à 5 000 lignes, tâches planifiées arrêtées à 4 min 30 |
| Nombre limité d'exécutions simultanées (de l'ordre de 30, voir la page des quotas Google) | Avec « exécuter en tant que moi », les requêtes peuvent être comptées pour le compte déployeur | Convient à quelques dizaines d'utilisateurs actifs simultanés ; au-delà, voir SQL |
| Verrou de script unique | Les écritures sont sérialisées | Sections critiques courtes ; lectures hors verrou |
| 10 millions de cellules par classeur | Plafond de volume | Suivi dans `healthCheck()` ; archivage ou SQL |
| Quota d'e-mails | Envois refusés au-delà | Contrôle préalable, statut `EMAIL_FAILED`, notification interne |
| Latence Sheets (≈ 0,5 à 2 s par appel) | Interface moins réactive qu'une base | Une lecture par table et par requête, indicateurs calculés en mémoire |

## Migration vers une base SQL

L'accès aux données est concentré dans `Database.gs` (`dbAll_`, `dbGet_`, `dbFind_`, `dbInsert_`, `dbInsertMany_`, `dbUpdate_`, `dbDelete_`) et le schéma est décrit une seule fois dans `TABLES_SRC`. Chemin recommandé :

1. Générer le DDL depuis `TABLES_SRC` (types : texte → `TEXT`, nombre → `NUMERIC`, booléen → `BOOLEAN`, date → `DATE`, horodatage → `TIMESTAMPTZ`, JSON → `JSONB`), clés primaires et index sur `organizationId`, `propertyId`, dates.
2. Réimplémenter les fonctions de `Database.gs` sur Cloud SQL (service JDBC d'Apps Script) ou derrière une API — les services métier ne changent pas.
3. Remplacer `withLock_` par des transactions et une contrainte d'exclusion sur les intervalles de réservation (PostgreSQL `EXCLUDE USING gist`).
4. Exporter chaque onglet en CSV, importer, comparer les nombres de lignes et les totaux financiers, basculer par propriété du script.
5. À plus grande échelle, sortir l'interface d'Apps Script (hébergement web classique) et remplacer les sessions par un fournisseur d'identité.
