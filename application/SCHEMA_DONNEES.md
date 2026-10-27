# Schéma des données — ImmoPilot 2.2.0

Généré à partir de `TABLES_SRC` (Config.gs), qui est la source unique du schéma : la migration v1 (`schema_sync`) crée chaque onglet et **ajoute** les colonnes manquantes à droite, sans jamais supprimer ni renommer une colonne existante. Les colonnes sont lues par **nom d'en-tête**, pas par position : un onglet peut contenir des colonnes supplémentaires (héritées), elles sont conservées et ignorées.

Conventions communes à toutes les tables :

- **Clé primaire** : identifiant texte préfixé (`org_…`, `prp_…`, `res_…`) généré côté serveur (`newId_`), jamais fourni par le navigateur.
- **Types** : texte, nombre, booléen, date `AAAA-MM-JJ` (fuseau Africa/Casablanca), horodatage ISO 8601 UTC, JSON (objet/tableau sérialisé). Toutes les valeurs texte sont écrites avec une apostrophe initiale : Sheets ne les convertit donc jamais en date/nombre et une valeur commençant par `= + - @` n'est jamais interprétée comme formule.
- **Organisation propriétaire** : la colonne d'organisation indiquée sert au cloisonnement multi-tenant ; chaque lecture passe par les contrôles de `Permissions.gs` (capacité du rôle + appartenance + accès au bien). Le navigateur ne fournit jamais un identifiant d'organisation qui serait cru sans vérification.
- **Ordre des colonnes** : le socle de chaque table vient en premier (pour les tables qui existaient en Phase 4, il reprend leurs colonnes à l'identique) ; les colonnes suivantes sont ajoutées par la migration, sans toucher aux données présentes.
- **Relations** : déduites des colonnes `…Id` qui portent le nom de la clé primaire d'une autre table. Elles sont vérifiées par les services à l'écriture et contrôlées par `integrityReport_` (Admin › Santé), pas par Sheets.
- **Optimisation** : les lectures se font en un seul `getDataRange().getValues()` par table et par exécution (mémoire de requête), filtrées en mémoire ; pagination serveur (`MAX_PAGE_SIZE` = 200), exports limités à 5 000 lignes. Au-delà de quelques dizaines de milliers de lignes par onglet, voir ARCHITECTURE.md › « Migration vers une base SQL ».

## Sommaire

- [Organizations](#organizations)
- [Users](#users)
- [Invitations](#invitations)
- [UserRoles](#userroles)
- [ActivityLogs](#activitylogs)
- [PlatformSettings](#platformsettings)
- [Settings](#settings)
- [Sessions](#sessions)
- [PasswordResets](#passwordresets)
- [SupportGrants](#supportgrants)
- [Residences](#residences)
- [Properties](#properties)
- [AgencyPropertyPermissions](#agencypropertypermissions)
- [PropertyAssignments](#propertyassignments)
- [AvailabilityBlocks](#availabilityblocks)
- [Reservations](#reservations)
- [GuestEvents](#guestevents)
- [Guests](#guests)
- [GuestDocuments](#guestdocuments)
- [GuestAccessTokens](#guestaccesstokens)
- [CheckIns](#checkins)
- [CheckOuts](#checkouts)
- [CleaningMissions](#cleaningmissions)
- [CleaningReports](#cleaningreports)
- [CleaningChecklists](#cleaningchecklists)
- [CleaningPhotos](#cleaningphotos)
- [Incidents](#incidents)
- [IncidentsV4](#incidentsv4)
- [IncidentComments](#incidentcomments)
- [Artisans](#artisans)
- [Quotes](#quotes)
- [QuoteDecisions](#quotedecisions)
- [WorkOrders](#workorders)
- [Invoices](#invoices)
- [Payments](#payments)
- [Tenants](#tenants)
- [Leases](#leases)
- [RentSchedules](#rentschedules)
- [RentMailings](#rentmailings)
- [LeaseDocs](#leasedocs)
- [LeaseInspections](#leaseinspections)
- [Expenses](#expenses)
- [RevenueRecords](#revenuerecords)
- [Documents](#documents)
- [Notifications](#notifications)
- [NotificationLogs](#notificationlogs)
- [ScheduledJobs](#scheduledjobs)
- [MigrationHistory](#migrationhistory)
- [SubscriptionPlans](#subscriptionplans)
- [Subscriptions](#subscriptions)
- [OperationRequests](#operationrequests)

## Organizations

- Clé primaire : `organizationId` (préfixe `org_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `name`
- Relations : `planCode` → SubscriptionPlans

| Colonne | Type | Remarque |
|---|---|---|
| organizationId | texte | clé primaire |
| name | texte | obligatoire |
| status | texte | valeurs : ACTIVE, SUSPENDED, INACTIVE |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| type | texte | valeurs : OWNER_ORG, AGENCY, PROVIDER, PLATFORM |
| country | texte |  |
| city | texte |  |
| timezone | texte |  |
| locale | texte |  |
| planCode | texte |  |
| billingEmail | texte |  |
| suspendedAt | horodatage ISO |  |
| suspensionReason | texte |  |
| updatedAt | horodatage ISO |  |

## Users

- Clé primaire : `userId` (préfixe `usr_`)
- Organisation propriétaire : aucune colonne directe (portée globale ou héritée du parent)
- Champs obligatoires : `email`

| Colonne | Type | Remarque |
|---|---|---|
| userId | texte | clé primaire |
| email | texte | obligatoire |
| displayName | texte |  |
| status | texte | valeurs : ACTIVE, SUSPENDED, DISABLED, INVITED |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| passwordHash | texte | secret dérivé, jamais renvoyé au navigateur |
| passwordSalt | texte | secret dérivé, jamais renvoyé au navigateur |
| passwordIters | nombre |  |
| failedAttempts | nombre |  |
| lockedUntil | horodatage ISO |  |
| lastLoginAt | horodatage ISO |  |
| locale | texte |  |
| phone | texte |  |
| notifPrefsJson | JSON |  |
| updatedAt | horodatage ISO |  |
| pwChangedAt | horodatage ISO |  |

## Invitations

- Clé primaire : `invitationId` (préfixe `inv_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `email`, `role`
- Relations : `organizationId` → Organizations · `propertyId` → Properties

| Colonne | Type | Remarque |
|---|---|---|
| invitationId | texte | clé primaire |
| email | texte | obligatoire |
| displayName | texte |  |
| organizationId | texte |  |
| role | texte | obligatoire |
| tokenHash | texte | secret dérivé, jamais renvoyé au navigateur |
| status | texte | valeurs : PENDING, ACCEPTED, REVOKED, EXPIRED, EMAIL_FAILED |
| expiresAt | horodatage ISO |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| acceptedAt | horodatage ISO |  |
| revokedAt | horodatage ISO |  |
| permissionsJson | JSON |  |
| propertyId | texte |  |

## UserRoles

- Clé primaire : `userRoleId` (préfixe `role_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `userId`, `role`
- Relations : `userId` → Users · `organizationId` → Organizations

| Colonne | Type | Remarque |
|---|---|---|
| userRoleId | texte | clé primaire |
| userId | texte | obligatoire |
| organizationId | texte |  |
| role | texte | obligatoire |
| status | texte | valeurs : ACTIVE, REVOKED, SUSPENDED |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| permissionsJson | JSON |  |
| revokedAt | horodatage ISO |  |
| revokedBy | texte |  |

## ActivityLogs

- Clé primaire : `logId` (préfixe `log_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `action`
- Relations : `organizationId` → Organizations

| Colonne | Type | Remarque |
|---|---|---|
| logId | texte | clé primaire |
| timestamp | horodatage ISO |  |
| actorEmail | texte |  |
| organizationId | texte |  |
| action | texte | obligatoire |
| entityType | texte |  |
| entityId | texte |  |
| detailsJson | JSON |  |
| actorUserId | texte |  |
| result | texte |  |
| errorId | texte |  |

## PlatformSettings

- Clé primaire : `settingKey` (préfixe `set_`)
- Organisation propriétaire : aucune colonne directe (portée globale ou héritée du parent)
- Champs obligatoires : `settingKey`

| Colonne | Type | Remarque |
|---|---|---|
| settingKey | texte | clé primaire ; obligatoire |
| settingValue | texte |  |
| updatedAt | horodatage ISO |  |
| updatedBy | texte |  |

## Settings

- Clé primaire : `settingId` (préfixe `stg_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `organizationId`, `settingKey`
- Relations : `organizationId` → Organizations · `settingKey` → PlatformSettings

| Colonne | Type | Remarque |
|---|---|---|
| settingId | texte | clé primaire |
| organizationId | texte | obligatoire |
| settingKey | texte | obligatoire |
| settingValue | texte |  |
| updatedAt | horodatage ISO |  |
| updatedBy | texte |  |

## Sessions

- Clé primaire : `sessionId` (préfixe `ses_`)
- Organisation propriétaire : aucune colonne directe (portée globale ou héritée du parent)
- Champs obligatoires : `userId`, `tokenHash`
- Relations : `userId` → Users

| Colonne | Type | Remarque |
|---|---|---|
| sessionId | texte | clé primaire |
| userId | texte | obligatoire |
| tokenHash | texte | obligatoire ; secret dérivé, jamais renvoyé au navigateur |
| createdAt | horodatage ISO |  |
| expiresAt | horodatage ISO |  |
| lastSeenAt | horodatage ISO |  |
| revokedAt | horodatage ISO |  |
| userAgent | texte |  |

## PasswordResets

- Clé primaire : `resetId` (préfixe `rst_`)
- Organisation propriétaire : aucune colonne directe (portée globale ou héritée du parent)
- Champs obligatoires : `userId`, `tokenHash`
- Relations : `userId` → Users

| Colonne | Type | Remarque |
|---|---|---|
| resetId | texte | clé primaire |
| userId | texte | obligatoire |
| tokenHash | texte | obligatoire ; secret dérivé, jamais renvoyé au navigateur |
| createdAt | horodatage ISO |  |
| expiresAt | horodatage ISO |  |
| usedAt | horodatage ISO |  |
| purpose | texte |  |

## SupportGrants

- Clé primaire : `grantId` (préfixe `sgr_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `superAdminUserId`, `organizationId`, `justification`
- Relations : `organizationId` → Organizations

| Colonne | Type | Remarque |
|---|---|---|
| grantId | texte | clé primaire |
| superAdminUserId | texte | obligatoire |
| organizationId | texte | obligatoire |
| justification | texte | obligatoire |
| status | texte | valeurs : REQUESTED, ACTIVE, DENIED, REVOKED, EXPIRED |
| requestedAt | horodatage ISO |  |
| approvedAt | horodatage ISO |  |
| approvedBy | texte |  |
| expiresAt | horodatage ISO |  |
| revokedAt | horodatage ISO |  |
| scope | texte |  |

## Residences

- Clé primaire : `residenceId` (préfixe `res_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `name`, `city`
- Relations : `organizationId` → Organizations

| Colonne | Type | Remarque |
|---|---|---|
| residenceId | texte | clé primaire |
| organizationId | texte |  |
| name | texte | obligatoire |
| city | texte | obligatoire |
| address | texte |  |
| status | texte |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |

## Properties

- Clé primaire : `propertyId` (préfixe `prop_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `organizationId`, `name`, `city`
- Relations : `organizationId` → Organizations · `residenceId` → Residences

| Colonne | Type | Remarque |
|---|---|---|
| propertyId | texte | clé primaire |
| organizationId | texte | obligatoire |
| ownerUserId | texte |  |
| residenceId | texte |  |
| name | texte | obligatoire |
| address | texte |  |
| city | texte | obligatoire |
| neighborhood | texte |  |
| building | texte |  |
| floor | texte |  |
| doorNumber | texte |  |
| propertyType | texte |  |
| surfaceM2 | nombre |  |
| bedrooms | nombre |  |
| bathrooms | nombre |  |
| equipmentJson | JSON |  |
| accessInstructions | texte |  |
| latitude | nombre |  |
| longitude | nombre |  |
| rentalMode | texte | valeurs : SHORT_TERM, LONG_TERM, BOTH |
| status | texte | valeurs : ACTIVE, INACTIVE, MAINTENANCE, ARCHIVED, DELETED |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| updatedAt | horodatage ISO |  |
| updatedBy | texte |  |
| capacity | nombre |  |
| description | texte |  |
| houseRules | texte |  |
| arrivalInstructions | texte |  |
| departureInstructions | texte |  |
| checkInTime | texte |  |
| checkOutTime | texte |  |
| minTurnaroundMinutes | nombre |  |
| nightlyPrice | nombre |  |
| cleaningFee | nombre |  |
| monthlyRent | nombre |  |
| charges | nombre |  |
| currency | texte |  |
| managementCommissionRate | nombre |  |
| touristTaxPerNight | nombre |  |
| roomsJson | JSON |  |
| cleaningChecklistJson | JSON |  |

## AgencyPropertyPermissions

- Clé primaire : `permissionId` (préfixe `perm_`)
- Organisation propriétaire : `ownerOrganizationId`
- Champs obligatoires : `propertyId`, `agencyOrganizationId`
- Relations : `propertyId` → Properties

| Colonne | Type | Remarque |
|---|---|---|
| permissionId | texte | clé primaire |
| propertyId | texte | obligatoire |
| ownerOrganizationId | texte |  |
| agencyOrganizationId | texte | obligatoire |
| canView | booléen |  |
| canManageReservations | booléen |  |
| canManageOperations | booléen |  |
| status | texte | valeurs : ACTIVE, REVOKED |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| canViewFinance | booléen |  |
| commissionRate | nombre |  |
| validFrom | date (AAAA-MM-JJ) |  |
| validTo | date (AAAA-MM-JJ) |  |
| updatedAt | horodatage ISO |  |
| updatedBy | texte |  |

## PropertyAssignments

- Clé primaire : `assignmentId` (préfixe `asgn_`)
- Organisation propriétaire : aucune colonne directe (portée globale ou héritée du parent)
- Champs obligatoires : `propertyId`, `userId`, `role`
- Relations : `propertyId` → Properties · `reservationId` → Reservations · `userId` → Users

| Colonne | Type | Remarque |
|---|---|---|
| assignmentId | texte | clé primaire |
| propertyId | texte | obligatoire |
| reservationId | texte |  |
| userId | texte | obligatoire |
| email | texte |  |
| role | texte | obligatoire |
| status | texte | valeurs : ACTIVE, REVOKED |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| revokedAt | horodatage ISO |  |
| revokedBy | texte |  |

## AvailabilityBlocks

- Clé primaire : `blockId` (préfixe `blk_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `propertyId`, `startDate`, `endDate`
- Relations : `organizationId` → Organizations · `propertyId` → Properties

| Colonne | Type | Remarque |
|---|---|---|
| blockId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte | obligatoire |
| startDate | date (AAAA-MM-JJ) | obligatoire |
| endDate | date (AAAA-MM-JJ) | obligatoire |
| reason | texte |  |
| status | texte | valeurs : ACTIVE, CANCELLED |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| blockType | texte |  |

## Reservations

- Clé primaire : `reservationId` (préfixe `resv_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `propertyId`, `checkIn`, `checkOut`, `guestName`
- Relations : `organizationId` → Organizations · `propertyId` → Properties

| Colonne | Type | Remarque |
|---|---|---|
| reservationId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte | obligatoire |
| agencyOrganizationId | texte |  |
| checkIn | date (AAAA-MM-JJ) | obligatoire |
| checkOut | date (AAAA-MM-JJ) | obligatoire |
| guestCount | nombre |  |
| guestName | texte | obligatoire |
| status | texte | valeurs : DRAFT, PENDING, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW |
| notes | texte |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| updatedAt | horodatage ISO |  |
| updatedBy | texte |  |
| checkInAt | horodatage ISO |  |
| checkOutAt | horodatage ISO |  |
| guestEmail | texte |  |
| guestPhone | texte |  |
| totalPrice | nombre |  |
| taxes | nombre |  |
| fees | nombre |  |
| commissionRate | nombre |  |
| commissionAmount | nombre |  |
| deposit | nombre |  |
| depositStatus | texte |  |
| paymentStatus | texte | valeurs : UNPAID, PARTIAL, PAID, REFUNDED, OVERPAID |
| source | texte |  |
| cancelReason | texte |  |
| cancelledAt | horodatage ISO |  |
| cancelledBy | texte |  |
| refundDue | nombre |  |
| version | nombre |  |
| idempotencyKey | texte |  |
| currency | texte |  |

## GuestEvents

- Clé primaire : `eventId` (préfixe `gev_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : —
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `reservationId` → Reservations

| Colonne | Type | Remarque |
|---|---|---|
| eventId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| reservationId | texte |  |
| travelerName | texte |  |
| eventType | texte |  |
| eventAt | horodatage ISO |  |
| eventDate | date (AAAA-MM-JJ) |  |
| actorEmail | texte |  |
| idempotencyKey | texte |  |
| notes | texte |  |

## Guests

- Clé primaire : `guestId` (préfixe `gst_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `reservationId`, `lastName`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `reservationId` → Reservations

| Colonne | Type | Remarque |
|---|---|---|
| guestId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| reservationId | texte | obligatoire |
| lastName | texte | obligatoire |
| firstName | texte |  |
| email | texte |  |
| phone | texte |  |
| nationality | texte |  |
| idType | texte |  |
| idRefMasked | texte |  |
| isPrimary | booléen |  |
| status | texte | valeurs : ACTIVE, PURGED |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| updatedAt | horodatage ISO |  |
| purgedAt | horodatage ISO |  |

## GuestDocuments

- Clé primaire : `guestDocId` (préfixe `gdc_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `reservationId`, `documentId`
- Relations : `organizationId` → Organizations · `reservationId` → Reservations · `guestId` → Guests · `documentId` → Documents

| Colonne | Type | Remarque |
|---|---|---|
| guestDocId | texte | clé primaire |
| organizationId | texte |  |
| reservationId | texte | obligatoire |
| guestId | texte |  |
| documentId | texte | obligatoire |
| docType | texte |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |

## GuestAccessTokens

- Clé primaire : `tokenId` (préfixe `gtk_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `reservationId`, `tokenHash`
- Relations : `organizationId` → Organizations · `reservationId` → Reservations

| Colonne | Type | Remarque |
|---|---|---|
| tokenId | texte | clé primaire |
| organizationId | texte |  |
| reservationId | texte | obligatoire |
| tokenHash | texte | obligatoire ; secret dérivé, jamais renvoyé au navigateur |
| status | texte | valeurs : ACTIVE, REVOKED, EXPIRED |
| expiresAt | horodatage ISO |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| lastUsedAt | horodatage ISO |  |
| useCount | nombre |  |

## CheckIns

- Clé primaire : `checkInId` (préfixe `cki_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `reservationId`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `reservationId` → Reservations · `incidentId` → IncidentsV4

| Colonne | Type | Remarque |
|---|---|---|
| checkInId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| reservationId | texte | obligatoire |
| plannedAt | horodatage ISO |  |
| actualAt | horodatage ISO |  |
| agentUserId | texte |  |
| agentEmail | texte |  |
| checklistJson | JSON |  |
| conditionNotes | texte |  |
| metersJson | JSON |  |
| photoDocIdsJson | JSON |  |
| comments | texte |  |
| incidentId | texte |  |
| status | texte |  |
| idempotencyKey | texte |  |
| createdAt | horodatage ISO |  |
| lateMinutes | nombre |  |

## CheckOuts

- Clé primaire : `checkOutId` (préfixe `cko_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `reservationId`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `reservationId` → Reservations · `incidentId` → IncidentsV4

| Colonne | Type | Remarque |
|---|---|---|
| checkOutId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| reservationId | texte | obligatoire |
| plannedAt | horodatage ISO |  |
| actualAt | horodatage ISO |  |
| agentUserId | texte |  |
| agentEmail | texte |  |
| checklistJson | JSON |  |
| conditionNotes | texte |  |
| metersJson | JSON |  |
| photoDocIdsJson | JSON |  |
| comments | texte |  |
| incidentId | texte |  |
| status | texte |  |
| idempotencyKey | texte |  |
| createdAt | horodatage ISO |  |
| lateMinutes | nombre |  |

## CleaningMissions

- Clé primaire : `missionId` (préfixe `cln_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `propertyId`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `reservationId` → Reservations

| Colonne | Type | Remarque |
|---|---|---|
| missionId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte | obligatoire |
| reservationId | texte |  |
| providerUserId | texte |  |
| providerEmail | texte |  |
| startAt | horodatage ISO |  |
| endAt | horodatage ISO |  |
| price | nombre |  |
| currency | texte |  |
| status | texte | valeurs : CREATED, OFFERED, ACCEPTED, DECLINED, EXPIRED, IN_PROGRESS, COMPLETED, VALIDATED, CANCELLED |
| responseAt | horodatage ISO |  |
| expiresAt | horodatage ISO |  |
| notes | texte |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| updatedAt | horodatage ISO |  |
| priority | texte |  |
| estimatedMinutes | nombre |  |
| acceptedAt | horodatage ISO |  |
| startedAt | horodatage ISO |  |
| completedAt | horodatage ISO |  |
| actualMinutes | nombre |  |
| validatedAt | horodatage ISO |  |
| validatedBy | texte |  |
| anomaliesJson | JSON |  |
| expiryAlertedAt | horodatage ISO |  |
| reassignCount | nombre |  |
| declineReason | texte |  |
| source | texte |  |
| qualityScore | nombre |  |
| validationNote | texte |  |
| lateAlertedAt | horodatage ISO |  |

## CleaningReports

- Clé primaire : `reportId` (préfixe `clr_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : —
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `missionId` → CleaningMissions

| Colonne | Type | Remarque |
|---|---|---|
| reportId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| missionId | texte |  |
| providerEmail | texte |  |
| checklistJson | JSON |  |
| photoFileIdsJson | JSON |  |
| notes | texte |  |
| submittedAt | horodatage ISO |  |
| createdAt | horodatage ISO |  |

## CleaningChecklists

- Clé primaire : `checklistId` (préfixe `clc_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `missionId`, `room`
- Relations : `organizationId` → Organizations · `missionId` → CleaningMissions

| Colonne | Type | Remarque |
|---|---|---|
| checklistId | texte | clé primaire |
| organizationId | texte |  |
| missionId | texte | obligatoire |
| room | texte | obligatoire |
| itemsJson | JSON |  |
| doneAt | horodatage ISO |  |
| updatedAt | horodatage ISO |  |

## CleaningPhotos

- Clé primaire : `photoId` (préfixe `clp_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `missionId`, `documentId`
- Relations : `organizationId` → Organizations · `missionId` → CleaningMissions · `propertyId` → Properties · `documentId` → Documents

| Colonne | Type | Remarque |
|---|---|---|
| photoId | texte | clé primaire |
| organizationId | texte |  |
| missionId | texte | obligatoire |
| propertyId | texte |  |
| room | texte |  |
| phase | texte | valeurs : BEFORE, AFTER |
| documentId | texte | obligatoire |
| takenAt | horodatage ISO |  |
| takenBy | texte |  |

## Incidents

- Clé primaire : `incidentId` (préfixe `inc_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : —
- Relations : `organizationId` → Organizations · `propertyId` → Properties

| Colonne | Type | Remarque |
|---|---|---|
| incidentId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| category | texte |  |
| description | texte |  |
| status | texte |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |

## IncidentsV4

- Clé primaire : `incidentId` (préfixe `inc_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `propertyId`, `category`, `description`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `reservationId` → Reservations · `missionId` → CleaningMissions

| Colonne | Type | Remarque |
|---|---|---|
| incidentId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte | obligatoire |
| reservationId | texte |  |
| category | texte | obligatoire |
| priority | texte | valeurs : LOW, NORMAL, HIGH, URGENT |
| description | texte | obligatoire |
| status | texte | valeurs : OPEN, QUALIFIED, ASSIGNED, QUOTE_PENDING, AWAITING_OWNER, APPROVED, IN_PROGRESS, RESOLVED, CLOSED, CANCELLED |
| photoFileIdsJson | JSON |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| updatedAt | horodatage ISO |  |
| updatedBy | texte |  |
| title | texte |  |
| severity | texte | valeurs : LOW, MEDIUM, HIGH, CRITICAL |
| reportedByUserId | texte |  |
| assignedToUserId | texte |  |
| contractorId | texte |  |
| estimatedCost | nombre |  |
| finalCost | nombre |  |
| resolvedAt | horodatage ISO |  |
| closedAt | horodatage ISO |  |
| missionId | texte |  |
| source | texte |  |
| alertedAt | horodatage ISO |  |
| legacyOrigin | texte |  |

## IncidentComments

- Clé primaire : `commentId` (préfixe `icm_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `incidentId`, `body`
- Relations : `organizationId` → Organizations · `incidentId` → IncidentsV4

| Colonne | Type | Remarque |
|---|---|---|
| commentId | texte | clé primaire |
| organizationId | texte |  |
| incidentId | texte | obligatoire |
| authorEmail | texte |  |
| body | texte | obligatoire |
| createdAt | horodatage ISO |  |
| visibility | texte |  |

## Artisans

- Clé primaire : `artisanId` (préfixe `art_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `name`, `email`
- Relations : `organizationId` → Organizations · `userId` → Users

| Colonne | Type | Remarque |
|---|---|---|
| artisanId | texte | clé primaire |
| organizationId | texte |  |
| name | texte | obligatoire |
| email | texte | obligatoire |
| phone | texte |  |
| categoriesJson | JSON |  |
| zonesJson | JSON |  |
| status | texte | valeurs : ACTIVE, INACTIVE, BLOCKED |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| userId | texte |  |
| notes | texte |  |
| legalName | texte |  |
| taxId | texte |  |
| commissionRate | nombre |  |
| billingInfo | texte |  |
| updatedAt | horodatage ISO |  |

## Quotes

- Clé primaire : `quoteId` (préfixe `quo_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `propertyId`, `incidentId`, `artisanId`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `incidentId` → IncidentsV4 · `artisanId` → Artisans

| Colonne | Type | Remarque |
|---|---|---|
| quoteId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte | obligatoire |
| incidentId | texte | obligatoire |
| artisanId | texte | obligatoire |
| status | texte | valeurs : REQUESTED, PENDING, APPROVED, REJECTED, DECLINED, EXPIRED, CANCELLED |
| currency | texte |  |
| totalAmount | nombre |  |
| validUntil | date (AAAA-MM-JJ) |  |
| linesJson | JSON |  |
| decisionAt | horodatage ISO |  |
| decisionBy | texte |  |
| decisionNote | texte |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| requestNote | texte |  |
| requestedAt | horodatage ISO |  |
| requestedBy | texte |  |
| submittedAt | horodatage ISO |  |
| amountHT | nombre |  |
| vatRate | nombre |  |
| amountTTC | nombre |  |
| estimatedDays | nombre |  |
| commissionRateEst | nombre |  |
| commissionEstimate | nombre |  |

## QuoteDecisions

- Clé primaire : `decisionId` (préfixe `qdc_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : —
- Relations : `organizationId` → Organizations · `quoteId` → Quotes

| Colonne | Type | Remarque |
|---|---|---|
| decisionId | texte | clé primaire |
| organizationId | texte |  |
| quoteId | texte |  |
| decision | texte |  |
| note | texte |  |
| decidedAt | horodatage ISO |  |
| decidedBy | texte |  |

## WorkOrders

- Clé primaire : `workOrderId` (préfixe `wo_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `propertyId`, `incidentId`, `artisanId`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `incidentId` → IncidentsV4 · `quoteId` → Quotes · `artisanId` → Artisans · `invoiceId` → Invoices

| Colonne | Type | Remarque |
|---|---|---|
| workOrderId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte | obligatoire |
| incidentId | texte | obligatoire |
| quoteId | texte |  |
| artisanId | texte | obligatoire |
| status | texte | valeurs : ASSIGNED, ACCEPTED, DECLINED, SCHEDULED, IN_PROGRESS, COMPLETED, VERIFIED, CANCELLED |
| scheduledAt | horodatage ISO |  |
| description | texte |  |
| report | texte |  |
| invoiceFileId | texte |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| updatedAt | horodatage ISO |  |
| updatedBy | texte |  |
| title | texte |  |
| desiredDate | date (AAAA-MM-JJ) |  |
| acceptedAt | horodatage ISO |  |
| startedAt | horodatage ISO |  |
| completedAt | horodatage ISO |  |
| verifiedAt | horodatage ISO |  |
| verifiedBy | texte |  |
| commissionRate | nombre |  |
| photoDocIdsJson | JSON |  |
| invoiceId | texte |  |
| declineReason | texte |  |

## Invoices

- Clé primaire : `invoiceId` (préfixe `ivc_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `propertyId`, `artisanId`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `workOrderId` → WorkOrders · `incidentId` → IncidentsV4 · `artisanId` → Artisans · `documentId` → Documents

| Colonne | Type | Remarque |
|---|---|---|
| invoiceId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte | obligatoire |
| workOrderId | texte |  |
| incidentId | texte |  |
| artisanId | texte | obligatoire |
| invoiceNumber | texte |  |
| issueDate | date (AAAA-MM-JJ) |  |
| dueDate | date (AAAA-MM-JJ) |  |
| amountHT | nombre |  |
| vatRate | nombre |  |
| vatAmount | nombre |  |
| amountTTC | nombre |  |
| commissionRate | nombre |  |
| commissionBase | nombre |  |
| commissionAmount | nombre |  |
| commissionVatRate | nombre |  |
| commissionVatAmount | nombre |  |
| commissionBeneficiaryOrgId | texte |  |
| commissionLocked | booléen |  |
| netToContractor | nombre |  |
| currency | texte |  |
| status | texte | valeurs : DRAFT, SUBMITTED, APPROVED, REJECTED, PARTIAL, PAID, CANCELLED |
| documentId | texte |  |
| approvedAt | horodatage ISO |  |
| approvedBy | texte |  |
| paidAmount | nombre |  |
| paidAt | horodatage ISO |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| notes | texte |  |

## Payments

- Clé primaire : `paymentId` (préfixe `pay_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `kind`, `refType`, `refId`, `direction`, `amount`
- Relations : `organizationId` → Organizations · `propertyId` → Properties

| Colonne | Type | Remarque |
|---|---|---|
| paymentId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| kind | texte | obligatoire ; valeurs : RESERVATION, DEPOSIT, REFUND, RENT, INVOICE, SUBSCRIPTION, DEPOSIT_REFUND, OTHER |
| refType | texte | obligatoire ; valeurs : RESERVATION, RENT_SCHEDULE, INVOICE, SUBSCRIPTION, LEASE, EXPENSE |
| refId | texte | obligatoire |
| direction | texte | obligatoire ; valeurs : IN, OUT |
| amount | nombre | obligatoire |
| currency | texte |  |
| method | texte |  |
| paidAt | horodatage ISO |  |
| reference | texte |  |
| proofDocId | texte |  |
| status | texte | valeurs : RECORDED, VOID |
| reconciled | booléen |  |
| reconciledAt | horodatage ISO |  |
| reconciledBy | texte |  |
| note | texte |  |
| idempotencyKey | texte |  |
| recordedBy | texte |  |
| createdAt | horodatage ISO |  |
| voidedAt | horodatage ISO |  |
| voidedBy | texte |  |

## Tenants

- Clé primaire : `tenantId` (préfixe `tnt_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `fullName`
- Relations : `organizationId` → Organizations · `userId` → Users

| Colonne | Type | Remarque |
|---|---|---|
| tenantId | texte | clé primaire |
| organizationId | texte |  |
| userId | texte |  |
| fullName | texte | obligatoire |
| email | texte |  |
| phone | texte |  |
| nationality | texte |  |
| idType | texte |  |
| status | texte | valeurs : ACTIVE, INACTIVE |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| updatedAt | horodatage ISO |  |

## Leases

- Clé primaire : `leaseId` (préfixe `lea_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `propertyId`, `tenantId`, `startDate`, `monthlyRent`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `tenantId` → Tenants · `documentId` → Documents

| Colonne | Type | Remarque |
|---|---|---|
| leaseId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte | obligatoire |
| tenantId | texte | obligatoire |
| startDate | date (AAAA-MM-JJ) | obligatoire |
| endDate | date (AAAA-MM-JJ) |  |
| durationMonths | nombre |  |
| monthlyRent | nombre | obligatoire |
| charges | nombre |  |
| deposit | nombre |  |
| dueDay | nombre |  |
| indexationRate | nombre |  |
| nextIndexationDate | date (AAAA-MM-JJ) |  |
| terms | texte |  |
| documentId | texte |  |
| status | texte | valeurs : DRAFT, ACTIVE, NOTICE, ENDED, RENEWED, CANCELLED |
| noticeDate | date (AAAA-MM-JJ) |  |
| noticeBy | texte |  |
| depositStatus | texte |  |
| depositReturned | nombre |  |
| depositDeductions | nombre |  |
| renewedFromLeaseId | texte |  |
| endReason | texte |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| updatedAt | horodatage ISO |  |
| updatedBy | texte |  |
| automationJson | JSON |  |

## RentSchedules

- Clé primaire : `scheduleId` (préfixe `rsc_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `leaseId`, `period`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `leaseId` → Leases

| Colonne | Type | Remarque |
|---|---|---|
| scheduleId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| leaseId | texte | obligatoire |
| period | texte | obligatoire |
| dueDate | date (AAAA-MM-JJ) |  |
| rentAmount | nombre |  |
| chargesAmount | nombre |  |
| amountDue | nombre |  |
| status | texte | valeurs : OPEN, CANCELLED |
| createdAt | horodatage ISO |  |
| uniqueKey | texte |  |

## RentMailings

- Clé primaire : `mailingId` (préfixe `rml_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `leaseId`, `kind`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `leaseId` → Leases · `scheduleId` → RentSchedules · `documentId` → Documents

| Colonne | Type | Remarque |
|---|---|---|
| mailingId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| leaseId | texte | obligatoire |
| scheduleId | texte |  |
| kind | texte | obligatoire · valeurs : CALL, REMINDER, RECEIPT, DOCUMENT |
| level | nombre |  |
| recipient | texte |  |
| status | texte | valeurs : SENT, FAILED, SKIPPED |
| trigger | texte | valeurs : AUTO, MANUAL |
| documentId | texte |  |
| subject | texte |  |
| sentAt | horodatage ISO |  |
| error | texte |  |
| attempts | nombre |  |
| uniqueKey | texte |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |

## LeaseDocs

- Clé primaire : `leaseDocId` (préfixe `ldc_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `leaseId`, `docType`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `leaseId` → Leases · `documentId` → Documents

| Colonne | Type | Remarque |
|---|---|---|
| leaseDocId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| leaseId | texte | obligatoire |
| docType | texte | obligatoire · valeurs : LEASE_CONTRACT, LETTER |
| subtype | texte |  |
| status | texte | valeurs : DRAFT, FINAL, CANCELLED |
| title | texte |  |
| inputsJson | JSON |  |
| sectionsJson | JSON |  |
| warningsJson | JSON |  |
| engine | texte |  |
| documentId | texte |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| updatedAt | horodatage ISO |  |
| updatedBy | texte |  |
| finalizedAt | horodatage ISO |  |
| finalizedBy | texte |  |
| sentAt | horodatage ISO |  |
| sentTo | texte |  |

## LeaseInspections

- Clé primaire : `inspectionId` (préfixe `edl_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `leaseId`, `type`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `leaseId` → Leases · `documentId` → Documents

| Colonne | Type | Remarque |
|---|---|---|
| inspectionId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| leaseId | texte | obligatoire |
| type | texte | obligatoire · valeurs : ENTRY, EXIT |
| inspectionDate | date (AAAA-MM-JJ) |  |
| status | texte | valeurs : DRAFT, FINAL, CANCELLED |
| roomsJson | JSON |  |
| metersJson | JSON |  |
| keysJson | JSON |  |
| generalNote | texte |  |
| attendees | texte |  |
| summaryJson | JSON |  |
| engine | texte |  |
| documentId | texte |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| updatedAt | horodatage ISO |  |
| updatedBy | texte |  |
| finalizedAt | horodatage ISO |  |
| finalizedBy | texte |  |
| sentAt | horodatage ISO |  |
| sentTo | texte |  |

## Expenses

- Clé primaire : `expenseId` (préfixe `exp_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `category`, `amount`
- Relations : `organizationId` → Organizations · `propertyId` → Properties · `documentId` → Documents

| Colonne | Type | Remarque |
|---|---|---|
| expenseId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| category | texte | obligatoire |
| description | texte |  |
| supplier | texte |  |
| amount | nombre | obligatoire |
| vatAmount | nombre |  |
| currency | texte |  |
| expenseDate | date (AAAA-MM-JJ) |  |
| status | texte | valeurs : PLANNED, INVOICED, PAID, CANCELLED |
| paidAt | horodatage ISO |  |
| refType | texte |  |
| refId | texte |  |
| uniqueKey | texte |  |
| documentId | texte |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |

## RevenueRecords

- Clé primaire : `revenueId` (préfixe `rev_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `category`, `amount`
- Relations : `organizationId` → Organizations · `propertyId` → Properties

| Colonne | Type | Remarque |
|---|---|---|
| revenueId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| category | texte | obligatoire |
| description | texte |  |
| amount | nombre | obligatoire |
| currency | texte |  |
| revenueDate | date (AAAA-MM-JJ) |  |
| status | texte | valeurs : EXPECTED, RECEIVED, CANCELLED |
| receivedAt | horodatage ISO |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |

## Documents

- Clé primaire : `documentId` (préfixe `doc_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `fileId`, `ownerType`, `category`
- Relations : `organizationId` → Organizations · `propertyId` → Properties

| Colonne | Type | Remarque |
|---|---|---|
| documentId | texte | clé primaire |
| organizationId | texte |  |
| propertyId | texte |  |
| ownerType | texte | obligatoire |
| ownerId | texte |  |
| category | texte | obligatoire |
| fileId | texte | obligatoire |
| fileName | texte |  |
| mimeType | texte |  |
| sizeBytes | nombre |  |
| sha256 | texte |  |
| sensitive | booléen |  |
| status | texte | valeurs : ACTIVE, ARCHIVED, PURGED |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| retainUntil | date (AAAA-MM-JJ) |  |
| purgedAt | horodatage ISO |  |
| legacy | booléen |  |

## Notifications

- Clé primaire : `notificationId` (préfixe `ntf_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `userId`, `title`
- Relations : `organizationId` → Organizations · `userId` → Users

| Colonne | Type | Remarque |
|---|---|---|
| notificationId | texte | clé primaire |
| organizationId | texte |  |
| userId | texte | obligatoire |
| type | texte |  |
| title | texte | obligatoire |
| body | texte |  |
| link | texte |  |
| createdAt | horodatage ISO |  |
| readAt | horodatage ISO |  |
| eventKey | texte |  |

## NotificationLogs

- Clé primaire : `logId` (préfixe `nlg_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `eventKey`, `channel`
- Relations : `organizationId` → Organizations

| Colonne | Type | Remarque |
|---|---|---|
| logId | texte | clé primaire |
| eventKey | texte | obligatoire |
| channel | texte | obligatoire |
| recipient | texte |  |
| type | texte |  |
| status | texte |  |
| sentAt | horodatage ISO |  |
| error | texte |  |
| organizationId | texte |  |

## ScheduledJobs

- Clé primaire : `jobRunId` (préfixe `job_`)
- Organisation propriétaire : aucune colonne directe (portée globale ou héritée du parent)
- Champs obligatoires : `jobName`

| Colonne | Type | Remarque |
|---|---|---|
| jobRunId | texte | clé primaire |
| jobName | texte | obligatoire |
| startedAt | horodatage ISO |  |
| finishedAt | horodatage ISO |  |
| status | texte |  |
| resultJson | JSON |  |
| error | texte |  |

## MigrationHistory

- Clé primaire : `migrationId` (préfixe `mig_`)
- Organisation propriétaire : aucune colonne directe (portée globale ou héritée du parent)
- Champs obligatoires : `version`

| Colonne | Type | Remarque |
|---|---|---|
| migrationId | texte | clé primaire |
| version | nombre | obligatoire |
| name | texte |  |
| appliedAt | horodatage ISO |  |
| appliedBy | texte |  |
| status | texte |  |
| detailsJson | JSON |  |

## SubscriptionPlans

- Clé primaire : `planCode` (préfixe `pln_`)
- Organisation propriétaire : aucune colonne directe (portée globale ou héritée du parent)
- Champs obligatoires : `planCode`, `name`

| Colonne | Type | Remarque |
|---|---|---|
| planCode | texte | clé primaire ; obligatoire |
| name | texte | obligatoire |
| price | nombre |  |
| currency | texte |  |
| periodicity | texte | valeurs : MONTHLY, QUARTERLY, YEARLY |
| maxProperties | nombre |  |
| maxUsers | nombre |  |
| storageMb | nombre |  |
| featuresJson | JSON |  |
| quotasJson | JSON |  |
| trialDays | nombre |  |
| status | texte | valeurs : ACTIVE, RETIRED |
| sortOrder | nombre |  |
| updatedAt | horodatage ISO |  |
| updatedBy | texte |  |

## Subscriptions

- Clé primaire : `subscriptionId` (préfixe `sub_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : `organizationId`, `planCode`
- Relations : `organizationId` → Organizations · `planCode` → SubscriptionPlans

| Colonne | Type | Remarque |
|---|---|---|
| subscriptionId | texte | clé primaire |
| organizationId | texte | obligatoire |
| planCode | texte | obligatoire |
| status | texte | valeurs : TRIAL, ACTIVE, PAST_DUE, SUSPENDED, CANCELLED, EXPIRED |
| startDate | date (AAAA-MM-JJ) |  |
| nextDueDate | date (AAAA-MM-JJ) |  |
| createdAt | horodatage ISO |  |
| createdBy | texte |  |
| periodEnd | date (AAAA-MM-JJ) |  |
| trialEnd | date (AAAA-MM-JJ) |  |
| cancelAtPeriodEnd | booléen |  |
| price | nombre |  |
| currency | texte |  |
| periodicity | texte |  |
| canceledAt | horodatage ISO |  |
| suspendedAt | horodatage ISO |  |
| paidThrough | date (AAAA-MM-JJ) |  |
| updatedAt | horodatage ISO |  |
| updatedBy | texte |  |
| lastReminderKey | texte |  |

## OperationRequests

- Clé primaire : `requestKey` (préfixe `opr_`)
- Organisation propriétaire : `organizationId`
- Champs obligatoires : —
- Relations : `organizationId` → Organizations

| Colonne | Type | Remarque |
|---|---|---|
| requestKey | texte | clé primaire |
| organizationId | texte |  |
| operation | texte |  |
| resourceId | texte |  |
| createdAt | horodatage ISO |  |
