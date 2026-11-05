/**
 * DarPilot — configuration centrale et schéma des données.
 * Les colonnes situées AVANT le séparateur "|" sont les colonnes historiques (phases 2 à 4) :
 * elles ne doivent jamais être renommées ni réordonnées. Les colonnes après "|" sont ajoutées
 * en fin de feuille par la migration (non destructif).
 * Suffixes de type : #n nombre, #b booléen, #d date AAAA-MM-JJ, #t horodatage ISO UTC, #j JSON (texte).
 */
/** Empreinte de la version installée (remplacée par tests/build-bundle.js ; « dev » = fichiers séparés). */
var IMMO_BUILD_ = "dev";
/**
 * Édition du logiciel : « MA » (Maroc, dirham) ou « FR » (France, euro). Même code, réglages et mentions propres au pays.
 * La version d'installation France est produite par : node tests/build-bundle.js --edition=fr (dossier dist-fr).
 */
var IMMO_EDITION_ = "MA";
/**
 * Démonstration publique (sans compte, vues au choix, lecture seule). Toujours false dans le code : seul le paquet
 * de DÉMONSTRATION (node tests/build-bundle.js --edition=fr --demo → dist-fr-demo) l'active. Jamais dans la version officielle.
 */
var IMMO_PUBLIC_DEMO_ = false;
var EDITIONS_ = {
  MA: {
    code: "MA", country: "MA", countryName: "Maroc", currency: "MAD", timezone: "Africa/Casablanca", city: "Marrakech", mapCenter: [31.6295, -7.9811],
    phoneCountry: "212", localMobileRe: "^0[5-7]\\d{8}$", tagline: "Marrakech · Maroc", taglineKey: "La gestion locative, de l'arrivée du voyageur au dernier dirham.",
    idTypes: ["CIN", "CNI", "PASSPORT", "RESIDENCE_PERMIT", "DRIVING_LICENSE", "OTHER"], nationalId: "CIN",
    dataLaw: "loi 09-08 (CNDP)", dataAuthority: "CNDP", leaseLaw: "droit marocain (loi 67-12 notamment)",
    taxIdLabel: "Identifiant fiscal (ICE / IF)", invoiceLegal: "Mentions légales du prestataire (ICE, IF, RC, patente) à compléter dans sa fiche si elles n'apparaissent pas ci-dessus.",
    quoteLegal: "", policeForms: false, registrationNumber: false, plans: { ESSENTIEL: 199, PRO: 499, BUSINESS: 1299 }, logoSvg: "<img src=\"/icons/icon-192.png\" alt=\"\" width=\"100%\" height=\"100%\" style=\"display:block;border-radius:inherit\">"
  },
  FR: {
    code: "FR", country: "FR", countryName: "France", currency: "EUR", timezone: "Europe/Paris", city: "Paris", mapCenter: [48.8566, 2.3522],
    phoneCountry: "33", localMobileRe: "^0[1-9]\\d{8}$", tagline: "Paris · France", taglineKey: "La gestion locative, de l'arrivée du voyageur au dernier centime.",
    idTypes: ["CNI", "CIN", "PASSPORT", "RESIDENCE_PERMIT", "DRIVING_LICENSE", "OTHER"], nationalId: "CNI",
    dataLaw: "RGPD (règlement UE 2016/679) et loi Informatique et Libertés (CNIL)", dataAuthority: "CNIL", leaseLaw: "droit français (loi n° 89-462 du 6 juillet 1989, contrat type du décret n° 2015-587)",
    taxIdLabel: "SIRET / n° de TVA intracommunautaire",
    invoiceLegal: "Mentions obligatoires du prestataire à vérifier : raison sociale, SIRET, n° de TVA intracommunautaire (ou « TVA non applicable, art. 293 B du CGI »), date d'échéance, taux des pénalités de retard ; entre professionnels, indemnité forfaitaire pour frais de recouvrement de 40 € (art. L. 441-10 du Code de commerce).",
    quoteLegal: "Devis gratuit sauf mention contraire. Pour être accepté, le devis doit être daté et signé avec la mention « Bon pour accord ». Prix exprimés en euros.",
    policeForms: true, registrationNumber: true, plans: { ESSENTIEL: 29, PRO: 59, BUSINESS: 149 }, logoSvg: "<img src=\"/icons/icon-192.png\" alt=\"\" width=\"100%\" height=\"100%\" style=\"display:block;border-radius:inherit\">"
  }
};
function edition_() { return EDITIONS_[IMMO_EDITION_] || EDITIONS_.MA; }
/** Devise par défaut de l'édition (MAD au Maroc, EUR en France). */
function cur_() { return edition_().currency; }
/** Langues de l'interface : français, anglais, arabe, espagnol, italien, néerlandais. */
var IMMO_LANGS_ = ["fr", "en", "ar", "es", "it", "nl"];
var IMMO_CONFIG = Object.freeze({
  APP_NAME: "DarPilot",
  VERSION: "2.8.0",
  SCHEMA_VERSION: 17,
  TIMEZONE: (EDITIONS_[IMMO_EDITION_] || EDITIONS_.MA).timezone,
  DATABASE_PROPERTY: "IMMO_DATABASE_SPREADSHEET_ID",
  DRIVE_ROOT_PROPERTY: "IMMO_PRIVATE_ROOT_FOLDER_ID",
  ADMIN_EMAILS_PROPERTY: "IMMO_ADMIN_EMAILS",
  ORGANIZATION_NAME_PROPERTY: "IMMO_INITIAL_ORGANIZATION_NAME",
  APP_URL_PROPERTY: "IMMO_APP_URL",
  PBKDF_ITERATIONS_PROPERTY: "IMMO_PBKDF_ITERATIONS",
  EMBED_ORIGINS_PROPERTY: "IMMO_EMBED_ORIGINS",
  ACTIVE_STATUS: "ACTIVE",
  MAX_UPLOAD_BYTES: 4 * 1024 * 1024,
  MAX_PAGE_SIZE: 200,
  MAX_EXPORT_ROWS: 5000,
  ROLES: ["SUPER_ADMIN", "OWNER", "AGENCY_ADMIN", "AGENCY_USER", "GUARD", "CLEANER", "ARTISAN", "TENANT"]
});

/** Capacités par rôle (plafond). UserRoles.permissionsJson peut seulement retirer ("-cap") ou restaurer ("+cap") dans ce plafond. */
var ROLE_CAPS = Object.freeze({
  SUPER_ADMIN: ["platform.admin", "audit.view", "subscription.manage", "org.manage", "settings.platform", "support.request"],
  OWNER: ["property.create", "property.edit", "property.archive", "property.assign", "reservation.view", "reservation.edit", "reservation.cancel",
    "guest.view", "guestdoc.view", "checkin.operate", "cleaning.manage", "incident.view", "incident.manage", "incident.report", "quote.decide",
    "contractor.manage", "workorder.manage", "invoice.view", "invoice.manage", "finance.view", "finance.manage", "lease.view", "lease.manage", "inspection.manage", "rent.manage",
    "report.view", "report.export", "user.invite", "user.manage", "settings.manage", "subscription.view", "audit.view.org", "support.approve", "document.view"],
  AGENCY_ADMIN: ["reservation.view", "reservation.edit", "reservation.cancel", "guest.view", "guestdoc.view", "checkin.operate", "cleaning.manage",
    "incident.view", "incident.manage", "incident.report", "quote.decide", "contractor.manage", "workorder.manage", "invoice.view", "finance.view",
    "lease.view", "lease.manage", "inspection.manage", "rent.manage", "report.view", "report.export", "user.invite", "user.manage", "settings.manage", "subscription.view",
    "audit.view.org", "support.approve", "document.view"],
  AGENCY_USER: ["reservation.view", "reservation.edit", "guest.view", "checkin.operate", "cleaning.manage", "incident.view", "incident.manage",
    "incident.report", "workorder.manage", "lease.view", "inspection.manage", "report.view", "document.view"],
  GUARD: ["checkin.operate", "incident.report", "guest.view.min"],
  CLEANER: ["cleaning.operate", "incident.report"],
  ARTISAN: ["workorder.operate", "quote.submit", "invoice.submit"],
  TENANT: ["lease.self", "incident.report"]
});

/** Droits portés par une attribution agence↔bien (AgencyPropertyPermissions). */
var AGENCY_FLAG_CAPS = Object.freeze({
  canView: ["reservation.view", "incident.view", "incident.report", "guest.view", "lease.view", "report.view", "document.view", "report.export"],
  canManageReservations: ["reservation.edit", "reservation.cancel", "checkin.operate", "guestdoc.view"],
  canManageOperations: ["cleaning.manage"],
  canManageIncidents: ["incident.manage", "workorder.manage", "contractor.manage", "quote.decide"],
  canManageLeases: ["lease.manage"],
  canManageInspections: ["inspection.manage"],
  canManageRent: ["rent.manage"],
  canViewFinance: ["finance.view", "invoice.view"]
});
/**
 * Missions détaillées confiées à une agence (location longue durée et incidents). Une attribution enregistrée avant
 * leur création (detailFlags vide) garde son ancien sens : « opérations » = ménage, incidents, devis, baux, états des lieux et loyers.
 */
var AGENCY_DETAIL_FLAGS_ = ["canManageIncidents", "canManageLeases", "canManageInspections", "canManageRent"];
function agencyFlagOn_(a, f) {
  if (AGENCY_DETAIL_FLAGS_.indexOf(f) >= 0 && !bool_(a.detailFlags)) return bool_(a.canManageOperations);
  return bool_(a[f]);
}

/** Rôles qu'un rôle donné peut inviter (prévention de l'élévation de privilèges). */
var INVITABLE_ROLES = Object.freeze({
  SUPER_ADMIN: ["OWNER", "AGENCY_ADMIN", "AGENCY_USER", "GUARD", "CLEANER", "ARTISAN", "TENANT"],
  OWNER: ["OWNER", "GUARD", "CLEANER", "ARTISAN", "TENANT"],
  AGENCY_ADMIN: ["AGENCY_ADMIN", "AGENCY_USER", "GUARD", "CLEANER", "ARTISAN"]
});

var DEFAULT_SETTINGS = Object.freeze({
  "currency": (EDITIONS_[IMMO_EDITION_] || EDITIONS_.MA).currency,
  "locale": "fr",
  "reservation.defaultCheckIn": "15:00",
  "reservation.defaultCheckOut": "11:00",
  "reservation.minTurnaroundMinutes": 120,
  "reservation.cancellationPolicy": [{ daysBefore: 7, penaltyPercent: 0 }, { daysBefore: 2, penaltyPercent: 50 }, { daysBefore: 0, penaltyPercent: 100 }],
  "checkin.graceMinutes": 120,
  "cleaning.acceptanceMinutes": 120,
  "cleaning.requirePhotos": true,
  "commission.contractorRate": 15,
  "commission.clientRate": 6,
  "commission.vatRate": 20,
  "finance.vatRate": 20,
  "quote.agencyApprovalLimit": 0,
  "workorder.requireQuote": true,
  "invoice.tolerancePercent": 5,
  "rent.graceDays": 5,
  "alerts.rentDueDays": 3,
  "alerts.leaseEndDays": [60, 30],
  "alerts.incidentAgeDays": 3,
  "alerts.incidentCost": 5000,
  "alerts.quotaPercent": 80,
  "retention.sensitiveDocDays": 30,
  "retention.logDays": 730,
  "guests.storeIdReference": false,
  "session.hours": 12,
  "session.idleMinutes": 120,
  "backup.keep": 14,
  "billing.enforce": true,
  "notify.emailEnabled": true,
  "template.leaseDocId": "",
  "template.receiptDocId": "",
  "template.reservationDocId": "",
  "template.receipt": "", "template.lease": "", "template.reservation": "",
  // Location longue durée : envois automatiques au locataire (désactivés par défaut, à activer par l'organisation).
  "rent.autoCall": true,
  "rent.callDaysBefore": 5,
  "rent.autoReminders": false,
  "rent.reminderDays": [5, 15, 30],
  "rent.autoReceipt": false,
  "rent.copyEmail": "",
  "rent.paymentInstructions": "", "rent.cardPaymentUrl": "",
  "list.incidentCategories": ["PLUMBING", "ELECTRICITY", "AC", "HUMIDITY", "LOCKSMITH", "FURNITURE", "APPLIANCE", "CLEANING", "DAMAGE", "SECURITY", "OTHER"],
  "list.expenseCategories": ["MAINTENANCE", "CLEANING", "UTILITIES", "TAXES", "INSURANCE", "AGENCY_FEES", "SUPPLIES", "OTHER"],
  "list.cancelReasons": ["GUEST_REQUEST", "NO_PAYMENT", "OVERBOOKING", "OWNER_REQUEST", "FORCE_MAJEURE", "OTHER"],
  "list.cleaningAnomalies": ["MISSING_ITEM", "DAMAGE", "DIRT", "BREAKAGE", "OTHER"],
  "list.specialties": ["CLEANING", "PLUMBING", "ELECTRICITY", "AC", "PAINTING", "LOCKSMITH", "CARPENTRY", "APPLIANCE", "GARDENING", "POOL", "OTHER"],
  "contractors.platformOnly": true,
  // Identité de l'éditeur pour les pages légales (Paramètres › Plateforme) ; vide = « À compléter » surligné.
  "legal.publisherName": "ECO SYNERGY", "legal.legalForm": "société par actions simplifiée (SAS) au capital de 500 €", "legal.address": "16 chemin de Garrabot, 31770 Colomiers, France",
  "legal.registration": "immatriculée au RCS de Toulouse sous le n° 932 443 005 (SIRET 932 443 005 00016)", "legal.vatNumber": "FR56932443005", "legal.director": "la société RENEWCO, présidente d'ECO SYNERGY",
  "legal.contactEmail": "ecosynergy31@gmail.com", "legal.phone": "+33 7 49 98 09 18", "legal.hostName": "", "legal.hostAddress": "", "legal.hostPhone": "", "legal.mediator": "",
  "legal.dataAuthorityRef": "", "legal.dpoEmail": "", "legal.platformInsurance": ""
});

var DEFAULT_PLANS = Object.freeze([
  { planCode: "ESSENTIEL", name: "Essentiel", price: (EDITIONS_[IMMO_EDITION_] || EDITIONS_.MA).plans.ESSENTIEL, periodicity: "MONTHLY", maxProperties: 5, maxUsers: 3, storageMb: 500, trialDays: 60, sortOrder: 1,
    features: ["properties", "reservations", "checkin", "cleaning", "incidents", "finance_basic"] },
  { planCode: "PRO", name: "Pro", price: (EDITIONS_[IMMO_EDITION_] || EDITIONS_.MA).plans.PRO, periodicity: "MONTHLY", maxProperties: 25, maxUsers: 15, storageMb: 3000, trialDays: 60, sortOrder: 2,
    features: ["properties", "reservations", "checkin", "cleaning", "incidents", "finance_basic", "finance_advanced", "leases", "contractors", "pareto", "reports", "automations", "guest_portal"] },
  { planCode: "BUSINESS", name: "Business", price: (EDITIONS_[IMMO_EDITION_] || EDITIONS_.MA).plans.BUSINESS, periodicity: "MONTHLY", maxProperties: 200, maxUsers: 100, storageMb: 20000, trialDays: 60, sortOrder: 3,
    features: ["properties", "reservations", "checkin", "cleaning", "incidents", "finance_basic", "finance_advanced", "leases", "contractors", "pareto", "reports", "automations", "guest_portal", "multi_agency", "exports_unlimited"] }
]);

/** Espace Prospects : valeurs autorisées (voir ProspectService.gs). */
var PROSPECT_TARGETS_ = ["AGENCE", "CONCIERGERIE", "SYNDIC", "PROPRIETAIRE", "ARTISAN", "AUTRE"];
var PROSPECT_STATUSES_ = ["a_qualifier", "froid", "qualifie", "a_envoyer", "contacte", "en_discussion", "rdv_pris", "demo_faite", "devis_envoye", "decouverte_2_mois",
  "client_payant", "en_pause", "perdu", "desinscrit", "a_contacter", "interesse", "dossier_en_cours", "dossier_complet", "verifie", "actif", "suspendu", "refuse"];
var PROSPECT_EVENT_KINDS_ = ["DRAFT", "SENT", "REPLY", "FOLLOWUP", "STATUS", "NOTE", "CALL", "MEETING", "IMPORT", "SYNC", "EDIT"];
var TABLES_SRC = {
  // Espace Prospects (super administrateur) : voir ProspectService.gs.
  Prospects: { pk: "prospectId", idp: "pro", req: "target", enums: { target: PROSPECT_TARGETS_, status: PROSPECT_STATUSES_, sourceType: ["AGENTS", "IMPORT", "MANUAL"], country: ["FR", "MA"] },
    cols: "prospectId,target,status,createdAt#t,createdBy|country,territory,city,company,contactName,role,email,phone,address,website,trade,sourceType,sourceUrl,sourceFile,importId,legalBasis,consent,score#n,angle,nextAction,nextActionDate,followUps#n,lastContactAt#t,lastReplyAt#t,plan,notes,doNotContact#b,agentPending#b,externalKey,updatedAt#t,updatedBy,updatedSource" },
  ProspectEvents: { pk: "eventId", idp: "pev", req: "prospectId,kind", enums: { kind: PROSPECT_EVENT_KINDS_ },
    cols: "eventId,prospectId,kind,at#t,source|summary,channel,detailsJson#j,actorEmail" },
  ProspectSyncs: { pk: "syncId", idp: "psy", req: "direction", enums: { direction: ["IN", "OUT"], status: ["OK", "PARTIAL", "REJECTED", "FAILED"] },
    cols: "syncId,direction,at#t,status|items#n,created#n,updated#n,events#n,error,ref,detailsJson#j" },
  Organizations: { pk: "organizationId", idp: "org", org: "organizationId", req: "name", enums: { status: ["ACTIVE", "SUSPENDED", "INACTIVE"], type: ["OWNER_ORG", "AGENCY", "PROVIDER", "PLATFORM"] },
    cols: "organizationId,name,status,createdAt#t,createdBy|type,country,city,timezone,locale,planCode,billingEmail,suspendedAt#t,suspensionReason,updatedAt#t,isDemo#b,managedByOrgId,phone,address,contactName,legalJson#j,signupSource" },
  Users: { pk: "userId", idp: "usr", req: "email", enums: { status: ["ACTIVE", "SUSPENDED", "DISABLED", "INVITED"] },
    cols: "userId,email,displayName,status,createdAt#t,createdBy|passwordHash,passwordSalt,passwordIters#n,failedAttempts#n,lockedUntil#t,lastLoginAt#t,locale,phone,notifPrefsJson#j,updatedAt#t,pwChangedAt#t" },
  Invitations: { pk: "invitationId", idp: "inv", org: "organizationId", req: "email,role", enums: { status: ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED", "EMAIL_FAILED"] },
    cols: "invitationId,email,displayName,organizationId,role,tokenHash,status,expiresAt#t,createdAt#t,createdBy,acceptedAt#t,revokedAt#t|permissionsJson#j,propertyId" },
  UserRoles: { pk: "userRoleId", idp: "role", org: "organizationId", req: "userId,role", enums: { status: ["ACTIVE", "REVOKED", "SUSPENDED"] },
    cols: "userRoleId,userId,organizationId,role,status,createdAt#t,createdBy|permissionsJson#j,revokedAt#t,revokedBy" },
  ActivityLogs: { pk: "logId", idp: "log", org: "organizationId", req: "action",
    cols: "logId,timestamp#t,actorEmail,organizationId,action,entityType,entityId,detailsJson#j|actorUserId,result,errorId" },
  PlatformSettings: { pk: "settingKey", idp: "set", req: "settingKey", cols: "settingKey,settingValue,updatedAt#t,updatedBy" },
  Settings: { pk: "settingId", idp: "stg", org: "organizationId", req: "organizationId,settingKey", cols: "settingId,organizationId,settingKey,settingValue,updatedAt#t,updatedBy" },
  Sessions: { pk: "sessionId", idp: "ses", req: "userId,tokenHash", cols: "sessionId,userId,tokenHash,createdAt#t,expiresAt#t,lastSeenAt#t,revokedAt#t,userAgent,impersonatorUserId,mode" },
  PlatformFees: { pk: "feeId", idp: "fee", org: "organizationId", req: "kind,invoiceId", enums: { kind: ["ARTISAN", "CLIENT"], status: ["PENDING", "BILLED", "DUE", "LINK_SENT", "PAID", "DEDUCTED", "CANCELLED"] },
    cols: "feeId,kind,organizationId,propertyId,invoiceId,workOrderId,artisanId,baseHT#n,rate#n,amount#n,vatAmount#n,total#n,currency,status,payMode,createdAt#t|checkoutId,payUrl,linkSentAt#t,reminders#n,paidAt#t,paidRef,statementId,period,note,updatedAt#t" },
  CommissionStatements: { pk: "statementId", idp: "cst", org: "organizationId", req: "organizationId,period", enums: { status: ["DUE", "LINK_SENT", "PAID", "CANCELLED"] },
    cols: "statementId,organizationId,period,count#n,totalHT#n,vatAmount#n,total#n,currency,status,createdAt#t|checkoutId,payUrl,paidAt#t,paidRef,attempts#n,lastError,updatedAt#t" },
  SignupRequests: { pk: "requestId", idp: "sgn", req: "email,kind", enums: { status: ["PENDING", "DONE", "FAILED", "REPLACED", "EXPIRED"] },
    cols: "requestId,kind,email,codeHash,attempts#n,expiresAt#t,payloadJson#j,status,createdAt#t,usedAt#t,ip,sends#n,lastSentAt#t" },
  PasswordResets: { pk: "resetId", idp: "rst", req: "userId,tokenHash", cols: "resetId,userId,tokenHash,createdAt#t,expiresAt#t,usedAt#t,purpose" },
  SupportGrants: { pk: "grantId", idp: "sgr", org: "organizationId", req: "superAdminUserId,organizationId,justification",
    enums: { status: ["REQUESTED", "ACTIVE", "DENIED", "REVOKED", "EXPIRED"] },
    cols: "grantId,superAdminUserId,organizationId,justification,status,requestedAt#t,approvedAt#t,approvedBy,expiresAt#t,revokedAt#t,scope" },
  Residences: { pk: "residenceId", idp: "res", org: "organizationId", req: "name,city", cols: "residenceId,organizationId,name,city,address,status,createdAt#t,createdBy" },
  Properties: { pk: "propertyId", idp: "prop", org: "organizationId", req: "organizationId,name,city",
    enums: { status: ["ACTIVE", "INACTIVE", "MAINTENANCE", "ARCHIVED", "DELETED"], rentalMode: ["SHORT_TERM", "LONG_TERM", "BOTH"] },
    cols: "propertyId,organizationId,ownerUserId,residenceId,name,address,city,neighborhood,building,floor,doorNumber,propertyType,surfaceM2#n,bedrooms#n,bathrooms#n,equipmentJson#j,accessInstructions,latitude#n,longitude#n,rentalMode,status,createdAt#t,createdBy,updatedAt#t,updatedBy|capacity#n,description,houseRules,arrivalInstructions,departureInstructions,checkInTime,checkOutTime,minTurnaroundMinutes#n,nightlyPrice#n,cleaningFee#n,monthlyRent#n,charges#n,currency,managementCommissionRate#n,touristTaxPerNight#n,roomsJson#j,cleaningChecklistJson#j,registrationNumber" },
  AgencyPropertyPermissions: { pk: "permissionId", idp: "perm", org: "ownerOrganizationId", req: "propertyId,agencyOrganizationId", enums: { status: ["ACTIVE", "REVOKED"] },
    cols: "permissionId,propertyId,ownerOrganizationId,agencyOrganizationId,canView#b,canManageReservations#b,canManageOperations#b,status,createdAt#t,createdBy|canViewFinance#b,commissionRate#n,validFrom#d,validTo#d,updatedAt#t,updatedBy,detailFlags#b,canManageIncidents#b,canManageLeases#b,canManageInspections#b,canManageRent#b" },
  PropertyAssignments: { pk: "assignmentId", idp: "asgn", req: "propertyId,userId,role", enums: { status: ["ACTIVE", "REVOKED"] },
    cols: "assignmentId,propertyId,reservationId,userId,email,role,status,createdAt#t,createdBy,revokedAt#t,revokedBy" },
  AvailabilityBlocks: { pk: "blockId", idp: "blk", org: "organizationId", req: "propertyId,startDate,endDate", enums: { status: ["ACTIVE", "CANCELLED"] },
    cols: "blockId,organizationId,propertyId,startDate#d,endDate#d,reason,status,createdAt#t,createdBy|blockType" },
  Reservations: { pk: "reservationId", idp: "resv", org: "organizationId", req: "propertyId,checkIn,checkOut,guestName",
    enums: { status: ["DRAFT", "PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"], paymentStatus: ["UNPAID", "PARTIAL", "PAID", "REFUNDED", "OVERPAID"] },
    cols: "reservationId,organizationId,propertyId,agencyOrganizationId,checkIn#d,checkOut#d,guestCount#n,guestName,status,notes,createdAt#t,createdBy,updatedAt#t,updatedBy|checkInAt#t,checkOutAt#t,guestEmail,guestPhone,totalPrice#n,taxes#n,fees#n,commissionRate#n,commissionAmount#n,deposit#n,depositStatus,paymentStatus,source,cancelReason,cancelledAt#t,cancelledBy,refundDue#n,version#n,idempotencyKey,currency" },
  GuestEvents: { pk: "eventId", idp: "gev", org: "organizationId", cols: "eventId,organizationId,propertyId,reservationId,travelerName,eventType,eventAt#t,eventDate#d,actorEmail,idempotencyKey,notes" },
  Guests: { pk: "guestId", idp: "gst", org: "organizationId", req: "reservationId,lastName", enums: { status: ["ACTIVE", "PURGED"] },
    cols: "guestId,organizationId,propertyId,reservationId,lastName,firstName,email,phone,nationality,idType,idRefMasked,isPrimary#b,status,createdAt#t,createdBy,updatedAt#t,purgedAt#t,birthDate#d,birthPlace,homeAddress" },
  GuestDocuments: { pk: "guestDocId", idp: "gdc", org: "organizationId", req: "reservationId,documentId", cols: "guestDocId,organizationId,reservationId,guestId,documentId,docType,createdAt#t,createdBy" },
  GuestAccessTokens: { pk: "tokenId", idp: "gtk", org: "organizationId", req: "reservationId,tokenHash", enums: { status: ["ACTIVE", "REVOKED", "EXPIRED"] },
    cols: "tokenId,organizationId,reservationId,tokenHash,status,expiresAt#t,createdAt#t,createdBy,lastUsedAt#t,useCount#n" },
  CheckIns: { pk: "checkInId", idp: "cki", org: "organizationId", req: "reservationId",
    cols: "checkInId,organizationId,propertyId,reservationId,plannedAt#t,actualAt#t,agentUserId,agentEmail,checklistJson#j,conditionNotes,metersJson#j,photoDocIdsJson#j,comments,incidentId,status,idempotencyKey,createdAt#t,lateMinutes#n" },
  CheckOuts: { pk: "checkOutId", idp: "cko", org: "organizationId", req: "reservationId",
    cols: "checkOutId,organizationId,propertyId,reservationId,plannedAt#t,actualAt#t,agentUserId,agentEmail,checklistJson#j,conditionNotes,metersJson#j,photoDocIdsJson#j,comments,incidentId,status,idempotencyKey,createdAt#t,lateMinutes#n" },
  CleaningMissions: { pk: "missionId", idp: "cln", org: "organizationId", req: "propertyId",
    enums: { status: ["CREATED", "OFFERED", "ACCEPTED", "DECLINED", "EXPIRED", "IN_PROGRESS", "COMPLETED", "VALIDATED", "CANCELLED"] },
    cols: "missionId,organizationId,propertyId,reservationId,providerUserId,providerEmail,startAt#t,endAt#t,price#n,currency,status,responseAt#t,expiresAt#t,notes,createdAt#t,createdBy,updatedAt#t|priority,estimatedMinutes#n,acceptedAt#t,startedAt#t,completedAt#t,actualMinutes#n,validatedAt#t,validatedBy,anomaliesJson#j,expiryAlertedAt#t,reassignCount#n,declineReason,source,qualityScore#n,validationNote,lateAlertedAt#t" },
  CleaningReports: { pk: "reportId", idp: "clr", org: "organizationId", cols: "reportId,organizationId,propertyId,missionId,providerEmail,checklistJson#j,photoFileIdsJson#j,notes,submittedAt#t,createdAt#t" },
  CleaningChecklists: { pk: "checklistId", idp: "clc", org: "organizationId", req: "missionId,room", cols: "checklistId,organizationId,missionId,room,itemsJson#j,doneAt#t,updatedAt#t" },
  CleaningPhotos: { pk: "photoId", idp: "clp", org: "organizationId", req: "missionId,documentId", enums: { phase: ["BEFORE", "AFTER"] },
    cols: "photoId,organizationId,missionId,propertyId,room,phase,documentId,takenAt#t,takenBy" },
  Incidents: { pk: "incidentId", idp: "inc", org: "organizationId", cols: "incidentId,organizationId,propertyId,category,description,status,createdAt#t,createdBy" },
  IncidentsV4: { pk: "incidentId", idp: "inc", org: "organizationId", req: "propertyId,category,description",
    enums: { severity: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], priority: ["LOW", "NORMAL", "HIGH", "URGENT"],
      status: ["OPEN", "QUALIFIED", "ASSIGNED", "QUOTE_PENDING", "AWAITING_OWNER", "APPROVED", "IN_PROGRESS", "RESOLVED", "CLOSED", "CANCELLED"] },
    cols: "incidentId,organizationId,propertyId,reservationId,category,priority,description,status,photoFileIdsJson#j,createdAt#t,createdBy,updatedAt#t,updatedBy|title,severity,reportedByUserId,assignedToUserId,contractorId,estimatedCost#n,finalCost#n,resolvedAt#t,closedAt#t,missionId,source,alertedAt#t,legacyOrigin" },
  IncidentComments: { pk: "commentId", idp: "icm", org: "organizationId", req: "incidentId,body", cols: "commentId,organizationId,incidentId,authorEmail,body,createdAt#t,visibility" },
  Artisans: { pk: "artisanId", idp: "art", org: "organizationId", req: "name,email", enums: { status: ["ACTIVE", "INACTIVE", "BLOCKED", "PENDING", "REJECTED"] },
    cols: "artisanId,organizationId,name,email,phone,categoriesJson#j,zonesJson#j,status,createdAt#t,createdBy|userId,notes,legalName,taxId,commissionRate#n,billingInfo,updatedAt#t,businessType,legalJson#j,insuranceJson#j,reviewJson#j,submittedAt#t,verifiedAt#t,verifiedBy,rejectReason,source,stripeAccountId,stripeReady#b" },
  Quotes: { pk: "quoteId", idp: "quo", org: "organizationId", req: "propertyId,incidentId,artisanId",
    enums: { status: ["REQUESTED", "PENDING", "APPROVED", "REJECTED", "DECLINED", "EXPIRED", "CANCELLED"] },
    cols: "quoteId,organizationId,propertyId,incidentId,artisanId,status,currency,totalAmount#n,validUntil#d,linesJson#j,decisionAt#t,decisionBy,decisionNote,createdAt#t,createdBy|requestNote,requestedAt#t,requestedBy,submittedAt#t,amountHT#n,vatRate#n,amountTTC#n,estimatedDays#n,commissionRateEst#n,commissionEstimate#n" },
  QuoteDecisions: { pk: "decisionId", idp: "qdc", org: "organizationId", cols: "decisionId,organizationId,quoteId,decision,note,decidedAt#t,decidedBy" },
  WorkOrders: { pk: "workOrderId", idp: "wo", org: "organizationId", req: "propertyId,incidentId,artisanId",
    enums: { status: ["ASSIGNED", "ACCEPTED", "DECLINED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "VERIFIED", "CANCELLED"] },
    cols: "workOrderId,organizationId,propertyId,incidentId,quoteId,artisanId,status,scheduledAt#t,description,report,invoiceFileId,createdAt#t,createdBy,updatedAt#t,updatedBy|title,desiredDate#d,acceptedAt#t,startedAt#t,completedAt#t,verifiedAt#t,verifiedBy,commissionRate#n,photoDocIdsJson#j,invoiceId,declineReason" },
  Invoices: { pk: "invoiceId", idp: "ivc", org: "organizationId", req: "propertyId,artisanId",
    enums: { status: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "PARTIAL", "PAID", "CANCELLED"] },
    cols: "invoiceId,organizationId,propertyId,workOrderId,incidentId,artisanId,invoiceNumber,issueDate#d,dueDate#d,amountHT#n,vatRate#n,vatAmount#n,amountTTC#n,commissionRate#n,commissionBase#n,commissionAmount#n,commissionVatRate#n,commissionVatAmount#n,commissionBeneficiaryOrgId,commissionLocked#b,netToContractor#n,currency,status,documentId,approvedAt#t,approvedBy,paidAmount#n,paidAt#t,createdAt#t,createdBy,notes" },
  Payments: { pk: "paymentId", idp: "pay", org: "organizationId", req: "kind,refType,refId,direction,amount",
    enums: { kind: ["RESERVATION", "DEPOSIT", "REFUND", "RENT", "INVOICE", "SUBSCRIPTION", "DEPOSIT_REFUND", "OTHER"], refType: ["RESERVATION", "RENT_SCHEDULE", "INVOICE", "SUBSCRIPTION", "LEASE", "EXPENSE"], direction: ["IN", "OUT"], status: ["RECORDED", "VOID"] },
    cols: "paymentId,organizationId,propertyId,kind,refType,refId,direction,amount#n,currency,method,paidAt#t,reference,proofDocId,status,reconciled#b,reconciledAt#t,reconciledBy,note,idempotencyKey,recordedBy,createdAt#t,voidedAt#t,voidedBy" },
  Tenants: { pk: "tenantId", idp: "tnt", org: "organizationId", req: "fullName", enums: { status: ["ACTIVE", "INACTIVE"] },
    cols: "tenantId,organizationId,userId,fullName,email,phone,nationality,idType,status,createdAt#t,createdBy,updatedAt#t|birthDate#d,birthPlace,idNumber,idExpiry#d,address,idDocumentId,idDocumentBackId" },
  Leases: { pk: "leaseId", idp: "lea", org: "organizationId", req: "propertyId,tenantId,startDate,monthlyRent",
    enums: { status: ["DRAFT", "ACTIVE", "NOTICE", "ENDED", "RENEWED", "CANCELLED"] },
    cols: "leaseId,organizationId,propertyId,tenantId,startDate#d,endDate#d,durationMonths#n,monthlyRent#n,charges#n,deposit#n,dueDay#n,indexationRate#n,nextIndexationDate#d,terms,documentId,status,noticeDate#d,noticeBy,depositStatus,depositReturned#n,depositDeductions#n,renewedFromLeaseId,endReason,createdAt#t,createdBy,updatedAt#t,updatedBy|automationJson#j" },
  RentSchedules: { pk: "scheduleId", idp: "rsc", org: "organizationId", req: "leaseId,period", enums: { status: ["OPEN", "CANCELLED"] },
    cols: "scheduleId,organizationId,propertyId,leaseId,period,dueDate#d,rentAmount#n,chargesAmount#n,amountDue#n,status,createdAt#t,uniqueKey" },
  // Envois au locataire (appels de loyer, relances, quittances, documents) : une ligne par envoi, clé unique contre les doublons.
  RentMailings: { pk: "mailingId", idp: "rml", org: "organizationId", req: "leaseId,kind",
    enums: { kind: ["CALL", "REMINDER", "RECEIPT", "DOCUMENT"], status: ["SENT", "FAILED", "SKIPPED"], trigger: ["AUTO", "MANUAL"] },
    cols: "mailingId,organizationId,propertyId,leaseId,scheduleId,kind,level#n,recipient,status,trigger,documentId,subject,sentAt#t,error,attempts#n,uniqueKey,createdAt#t,createdBy|delivery,deliveryAt#t,deliveryReason" },
  // Documents rédigés par l'agent (IA ou modèle intégré) : contrat de bail, courriers. Brouillon modifiable, puis PDF définitif.
  LeaseDocs: { pk: "leaseDocId", idp: "ldc", org: "organizationId", req: "leaseId,docType",
    enums: { docType: ["LEASE_CONTRACT", "LETTER"], status: ["DRAFT", "FINAL", "CANCELLED"] },
    cols: "leaseDocId,organizationId,propertyId,leaseId,docType,subtype,status,title,inputsJson#j,sectionsJson#j,warningsJson#j,engine,documentId,createdAt#t,createdBy,updatedAt#t,updatedBy,finalizedAt#t,finalizedBy,sentAt#t,sentTo" },
  // États des lieux d'entrée et de sortie : relevé pièce par pièce, compteurs, clés, photos, rédaction de l'agent.
  LeaseInspections: { pk: "inspectionId", idp: "edl", org: "organizationId", req: "leaseId,type",
    enums: { type: ["ENTRY", "EXIT"], status: ["DRAFT", "FINAL", "CANCELLED"] },
    cols: "inspectionId,organizationId,propertyId,leaseId,type,inspectionDate#d,status,roomsJson#j,metersJson#j,keysJson#j,generalNote,attendees,summaryJson#j,engine,documentId,createdAt#t,createdBy,updatedAt#t,updatedBy,finalizedAt#t,finalizedBy,sentAt#t,sentTo|tenantNewAddress,entryDate#d,metersEntryJson#j,landlordSignDocId,landlordSignName,landlordSignedAt#t,tenantSignDocId,tenantSignName,tenantSignedAt#t,signIp" },
  Expenses: { pk: "expenseId", idp: "exp", org: "organizationId", req: "category,amount", enums: { status: ["PLANNED", "INVOICED", "PAID", "CANCELLED"] },
    cols: "expenseId,organizationId,propertyId,category,description,supplier,amount#n,vatAmount#n,currency,expenseDate#d,status,paidAt#t,refType,refId,uniqueKey,documentId,createdAt#t,createdBy" },
  RevenueRecords: { pk: "revenueId", idp: "rev", org: "organizationId", req: "category,amount", enums: { status: ["EXPECTED", "RECEIVED", "CANCELLED"] },
    cols: "revenueId,organizationId,propertyId,category,description,amount#n,currency,revenueDate#d,status,receivedAt#t,createdAt#t,createdBy" },
  Documents: { pk: "documentId", idp: "doc", org: "organizationId", req: "fileId,ownerType,category", enums: { status: ["ACTIVE", "ARCHIVED", "PURGED"] },
    cols: "documentId,organizationId,propertyId,ownerType,ownerId,category,fileId,fileName,mimeType,sizeBytes#n,sha256,sensitive#b,status,createdAt#t,createdBy,retainUntil#d,purgedAt#t,legacy#b" },
  Notifications: { pk: "notificationId", idp: "ntf", org: "organizationId", req: "userId,title", cols: "notificationId,organizationId,userId,type,title,body,link,createdAt#t,readAt#t,eventKey" },
  NotificationLogs: { pk: "logId", idp: "nlg", org: "organizationId", req: "eventKey,channel", cols: "logId,eventKey,channel,recipient,type,status,sentAt#t,error,organizationId|delivery,deliveryAt#t,deliveryReason,providerId" },
  ScheduledJobs: { pk: "jobRunId", idp: "job", req: "jobName", cols: "jobRunId,jobName,startedAt#t,finishedAt#t,status,resultJson#j,error" },
  MigrationHistory: { pk: "migrationId", idp: "mig", req: "version", cols: "migrationId,version#n,name,appliedAt#t,appliedBy,status,detailsJson#j" },
  SubscriptionPlans: { pk: "planCode", idp: "pln", req: "planCode,name", enums: { status: ["ACTIVE", "RETIRED"], periodicity: ["MONTHLY", "QUARTERLY", "YEARLY"] },
    cols: "planCode,name,price#n,currency,periodicity,maxProperties#n,maxUsers#n,storageMb#n,featuresJson#j,quotasJson#j,trialDays#n,status,sortOrder#n,updatedAt#t,updatedBy,agencyOptionPrice#n" },
  Subscriptions: { pk: "subscriptionId", idp: "sub", org: "organizationId", req: "organizationId,planCode",
    enums: { status: ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"] },
    cols: "subscriptionId,organizationId,planCode,status,startDate#d,nextDueDate#d,createdAt#t,createdBy|periodEnd#d,trialEnd#d,cancelAtPeriodEnd#b,price#n,currency,periodicity,canceledAt#t,suspendedAt#t,paidThrough#d,updatedAt#t,updatedBy,lastReminderKey,agencyOptionPrice#n" },
  ContractSignatures: { pk: "signatureId", idp: "sig", org: "organizationId", req: "organizationId,subscriptionId",
    enums: { status: ["PENDING", "SIGNED", "EXPIRED"], channel: ["EMAIL", "SMS"] },
    cols: "signatureId,organizationId,subscriptionId,planCode,totalPrice#n,currency,contractHash,legalVersion,signerUserId,signerEmail,signerName,channel,destination,otpHash,otpExpires#t,otpAttempts#n,status,createdAt#t,signedAt#t,ip,userAgent,documentId" },
  BillingCards: { pk: "cardId", idp: "card", org: "organizationId", req: "organizationId",
    enums: { status: ["PENDING", "ACTIVE", "FAILED", "REPLACED", "REMOVED"] },
    cols: "cardId,organizationId,status,customerId,token,label,setupCheckoutId,createdAt#t,createdBy,updatedAt#t,lastChargeKey,chargeAttempts#n,chargeSeq#n,lastChargeAt#t,lastChargeError" },
  OperationRequests: { pk: "requestKey", idp: "opr", org: "organizationId", cols: "requestKey,organizationId,operation,resourceId,createdAt#t" }
};

function include(filename) {
  const allowed = ["Styles", "Components", "Login", "Dashboard", "Pages", "I18n", "Scripts"];
  if (allowed.indexOf(String(filename)) < 0) throw new Error("Inclusion non autorisée.");
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
