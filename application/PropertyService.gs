/**
 * Catalogue immobilier : biens, résidences, attributions d'agences, affectations du personnel, import/export.
 * Conserve les fonctions historiques (création, modification, droits d'agence, affectations) en les complétant.
 */
var PROPERTY_TYPES_ = ["APARTMENT", "STUDIO", "HOUSE", "VILLA", "RIAD", "COMMERCIAL", "OTHER"];
var PROPERTY_TEXT_FIELDS_ = { name: 120, address: 240, city: 80, neighborhood: 120, building: 80, floor: 30, doorNumber: 40, accessInstructions: 1000, description: 3000,
  houseRules: 3000, arrivalInstructions: 2000, departureInstructions: 2000, registrationNumber: 40 };
var PROPERTY_FIN_FIELDS_ = ["nightlyPrice", "cleaningFee", "monthlyRent", "charges", "managementCommissionRate", "touristTaxPerNight"];

function propertyInput_(a, isCreate) {
  const o = {};
  Object.keys(PROPERTY_TEXT_FIELDS_).forEach(function (k) { if (a[k] !== undefined) o[k] = safeText_(a[k], PROPERTY_TEXT_FIELDS_[k]); });
  if (isCreate || a.name !== undefined) assert_(String(o.name || "").length >= 2, "Le nom du bien est obligatoire.");
  if (isCreate || a.city !== undefined) assert_(String(o.city || "").length >= 2, "La ville est obligatoire.");
  if (a.propertyType !== undefined) o.propertyType = oneOf_(a.propertyType || "APARTMENT", PROPERTY_TYPES_, "Type de bien");
  if (a.rentalMode !== undefined) o.rentalMode = oneOf_(a.rentalMode || "SHORT_TERM", ["SHORT_TERM", "LONG_TERM", "BOTH"], "Mode de location");
  [["surfaceM2", 100000], ["bedrooms", 100], ["bathrooms", 100], ["capacity", 200], ["minTurnaroundMinutes", 1440]].forEach(function (x) {
    if (a[x[0]] === undefined) return;
    if (a[x[0]] === "" || a[x[0]] === null) { o[x[0]] = ""; return; }
    const n = Number(a[x[0]]); assert_(isFinite(n) && n >= 0 && n <= x[1], "Valeur invalide : " + x[0]); o[x[0]] = x[0] === "surfaceM2" ? round2_(n) : Math.round(n);
  });
  PROPERTY_FIN_FIELDS_.forEach(function (k) {
    if (a[k] === undefined) return;
    o[k] = k === "managementCommissionRate" ? (a[k] === "" ? "" : rate_(a[k], "Commission de gestion")) : money_(a[k], k, { optional: true });
  });
  if (a.latitude !== undefined) { o.latitude = a.latitude === "" ? "" : Number(a.latitude); assert_(o.latitude === "" || (isFinite(o.latitude) && Math.abs(o.latitude) <= 90), "Latitude invalide."); }
  if (a.longitude !== undefined) { o.longitude = a.longitude === "" ? "" : Number(a.longitude); assert_(o.longitude === "" || (isFinite(o.longitude) && Math.abs(o.longitude) <= 180), "Longitude invalide."); }
  ["checkInTime", "checkOutTime"].forEach(function (k) { if (a[k] !== undefined) { const s = safeText_(a[k], 5); assert_(!s || /^([01]\d|2[0-3]):[0-5]\d$/.test(s), "Heure invalide (HH:MM)."); o[k] = s; } });
  const list = function (v, max, len) { return (Array.isArray(v) ? v : String(v || "").split(/[,\n]/)).map(function (x) { return safeText_(x, len); }).filter(Boolean).slice(0, max); };
  if (a.equipment !== undefined) o.equipmentJson = list(a.equipment, 60, 60);
  if (a.rooms !== undefined) o.roomsJson = list(a.rooms, 30, 60);
  if (a.cleaningChecklist !== undefined) o.cleaningChecklistJson = list(a.cleaningChecklist, 60, 120);
  if (a.currency !== undefined) o.currency = oneOf_(String(a.currency || cur_()).toUpperCase(), ["MAD", "EUR", "USD"], "Devise");
  return o;
}

function propertyOut_(p, x, full) {
  const a = propertyAccess_(p, x) || { caps: {}, via: {} };
  const canFin = !!(a.caps["finance.view"] || a.caps["property.edit"]);
  const o = { propertyId: x.propertyId, organizationId: x.organizationId, name: x.name, city: x.city, neighborhood: x.neighborhood, address: x.address, propertyType: x.propertyType,
    rentalMode: x.rentalMode, status: x.status, bedrooms: x.bedrooms, bathrooms: x.bathrooms, surfaceM2: x.surfaceM2, capacity: x.capacity, latitude: x.latitude, longitude: x.longitude,
    access: Object.keys(a.via), canEdit: !!a.caps["property.edit"], canAssign: !!a.caps["property.assign"], canReserve: !!a.caps["reservation.edit"], updatedAt: x.updatedAt };
  if (full) {
    ["building", "floor", "doorNumber", "accessInstructions", "description", "houseRules", "arrivalInstructions", "departureInstructions", "checkInTime", "checkOutTime", "minTurnaroundMinutes", "currency", "residenceId", "createdAt", "createdBy", "registrationNumber"]
      .forEach(function (k) { o[k] = x[k]; });
    o.equipment = parseJson_(x.equipmentJson, []); o.rooms = parseJson_(x.roomsJson, []); o.cleaningChecklist = parseJson_(x.cleaningChecklistJson, []);
    o.caps = Object.keys(a.caps);
  }
  if (canFin) PROPERTY_FIN_FIELDS_.forEach(function (k) { o[k] = x[k]; });
  return o;
}

function propertyList_(p, a) {
  a = a || {};
  let rows = accessibleProps_(p).filter(function (x) {
    if (a.status) { if (x.status !== a.status) return false; } else if (x.status === "ARCHIVED" && !a.includeArchived) return false;
    if (a.city && String(x.city).toLowerCase() !== String(a.city).toLowerCase()) return false;
    if (a.rentalMode && x.rentalMode !== a.rentalMode) return false;
    if (a.organizationId && String(x.organizationId) !== String(a.organizationId)) return false;
    if (a.agencyOrganizationId) { const acc = propertyAccess_(p, x); if (acc.agencyOrgIds.indexOf(String(a.agencyOrganizationId)) < 0 && !dbAll_("AgencyPropertyPermissions").some(function (z) { return String(z.propertyId) === String(x.propertyId) && String(z.agencyOrganizationId) === String(a.agencyOrganizationId) && z.status === "ACTIVE"; })) return false; }
    return matchesQuery_(a.q, [x.name, x.city, x.neighborhood, x.address, x.propertyId]);
  }).map(function (x) { return propertyOut_(p, x, false); }).sort(function (x, y) { return String(x.name).localeCompare(String(y.name)); });
  return a.all ? { items: rows, total: rows.length } : pageOf_(rows, a);
}

/** Liste minimale (id, nom) pour les listes déroulantes, filtrée par capacité. */
function propertyChoices_(p, a) {
  return accessibleProps_(p, a && a.cap ? String(a.cap) : undefined).filter(function (x) { return x.status !== "ARCHIVED"; })
    .map(function (x) { return { propertyId: x.propertyId, name: x.name, city: x.city, rentalMode: x.rentalMode, status: x.status }; })
    .sort(function (x, y) { return String(x.name).localeCompare(String(y.name)); });
}

function propertyGet_(p, a) {
  const x = assertProp_(p, a.propertyId);
  const acc = propertyAccess_(p, x);
  const out = propertyOut_(p, x, true);
  const resv = dbAll_("Reservations").filter(function (r) { return String(r.propertyId) === String(x.propertyId); });
  if (acc.caps["reservation.view"]) {
    out.reservations = resv.filter(function (r) { return r.status !== "DRAFT"; }).sort(function (u, v) { return String(v.checkIn).localeCompare(String(u.checkIn)); }).slice(0, 15)
      .map(function (r) { return { reservationId: r.reservationId, guestName: r.guestName, checkIn: r.checkIn, checkOut: r.checkOut, status: r.status, totalPrice: acc.caps["finance.view"] || acc.caps["property.edit"] ? r.totalPrice : null }; });
  }
  if (acc.caps["incident.view"]) out.incidents = dbAll_("IncidentsV4").filter(function (i) { return String(i.propertyId) === String(x.propertyId); })
    .sort(function (u, v) { return String(v.createdAt).localeCompare(String(u.createdAt)); }).slice(0, 15)
    .map(function (i) { return { incidentId: i.incidentId, title: i.title || i.category, category: i.category, severity: i.severity, status: i.status, createdAt: i.createdAt, finalCost: i.finalCost }; });
  if (acc.caps["finance.view"] || acc.caps["property.edit"]) {
    const to = todayStr_(), from = addDaysStr_(addMonthsStr_(to, -12), 1);
    out.finance12m = finCompute_(p, { from: from, to: to, propertyId: x.propertyId }).totals;
  }
  if (acc.caps["property.assign"]) out.accessManagement = propertyAccessList_(p, { propertyId: x.propertyId });
  out.photos = docList_(p, { ownerType: "PROPERTY", ownerId: x.propertyId, category: "PHOTO" });
  if (acc.caps["document.view"] || acc.caps["property.edit"]) out.documents = docList_(p, { ownerType: "PROPERTY", ownerId: x.propertyId }).filter(function (d) { return d.category !== "PHOTO"; });
  if (acc.caps["property.edit"]) out.history = auditHistory_("Property", x.propertyId, 30);
  return out;
}

function propertyOrgChoices_(p) {
  return dbAll_("Organizations").filter(function (o) { return o.status === "ACTIVE" && hasOrgCap_(p, o.organizationId, "property.create"); })
    .map(function (o) { return { organizationId: o.organizationId, name: o.name }; });
}

function propertyCreate_(p, a) {
  const orgId = safeText_(a.organizationId || (propertyOrgChoices_(p)[0] || {}).organizationId, 120);
  assertOrgCap_(p, orgId, "property.create");
  assertOrgWritable_(orgId);
  const data = propertyInput_(a, true);
  if (a.residenceId) { const res = dbGet_("Residences", a.residenceId); assert_(res && String(res.organizationId) === orgId && res.status === "ACTIVE", "Résidence inconnue ou non autorisée."); data.residenceId = res.residenceId; }
  return withLock_(function () {
    assertQuota_(orgId, "properties");
    const row = dbInsert_("Properties", Object.assign({ propertyType: "APARTMENT", rentalMode: "SHORT_TERM", currency: getSetting_("currency", orgId), equipmentJson: [], roomsJson: ["Séjour", "Chambre", "Cuisine", "Salle de bain"] }, data, {
      organizationId: orgId, ownerUserId: p.userId, status: "ACTIVE", createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_(), updatedBy: p.email }));
    audit_("PROPERTY_CREATED", "Property", row.propertyId, orgId, { name: row.name, city: row.city });
    return { ok: true, propertyId: row.propertyId };
  });
}

function propertyUpdate_(p, a) {
  const x = assertProp_(p, a.propertyId, "property.edit");
  const patch = propertyInput_(a, false);
  if (a.status !== undefined) {
    patch.status = oneOf_(a.status, ["ACTIVE", "INACTIVE", "MAINTENANCE"], "Statut");
  }
  if (a.residenceId !== undefined) { if (a.residenceId) { const res = dbGet_("Residences", a.residenceId); assert_(res && String(res.organizationId) === String(x.organizationId), "Résidence non autorisée."); } patch.residenceId = safeText_(a.residenceId, 120); }
  patch.updatedAt = nowIso_(); patch.updatedBy = p.email;
  dbUpdate_("Properties", x.propertyId, patch);
  audit_("PROPERTY_UPDATED", "Property", x.propertyId, x.organizationId, diff_(x, patch, Object.keys(patch).filter(function (k) { return k !== "updatedAt" && k !== "updatedBy"; })));
  return { ok: true };
}

/** Archivage (jamais de suppression) : refusé s'il reste des réservations à venir ou un bail actif. */
function propertyArchive_(p, a) {
  const x = assertProp_(p, a.propertyId, "property.archive");
  const today = todayStr_();
  const future = dbAll_("Reservations").some(function (r) { return String(r.propertyId) === String(x.propertyId) && ["PENDING", "CONFIRMED", "IN_PROGRESS"].indexOf(r.status) >= 0 && r.checkOut >= today; });
  assert_(!future, "Impossible d'archiver : des réservations à venir ou en cours existent.");
  assert_(!dbAll_("Leases").some(function (l) { return String(l.propertyId) === String(x.propertyId) && ["ACTIVE", "NOTICE"].indexOf(l.status) >= 0; }), "Impossible d'archiver : un bail est actif.");
  dbUpdate_("Properties", x.propertyId, { status: a.restore ? "INACTIVE" : "ARCHIVED", updatedAt: nowIso_(), updatedBy: p.email });
  audit_(a.restore ? "PROPERTY_RESTORED" : "PROPERTY_ARCHIVED", "Property", x.propertyId, x.organizationId, {});
  return { ok: true };
}

var PROPERTY_CSV_COLS_ = ["name", "city", "neighborhood", "address", "propertyType", "rentalMode", "bedrooms", "bathrooms", "surfaceM2", "capacity", "nightlyPrice", "cleaningFee", "monthlyRent", "charges", "managementCommissionRate", "checkInTime", "checkOutTime"];
/** Import CSV (séparateur , ou ;). Validation ligne par ligne ; mode simulation par défaut (dryRun). */
function propertyImport_(p, a) {
  const orgId = safeText_(a.organizationId, 120);
  assertOrgCap_(p, orgId, "property.create"); assertOrgWritable_(orgId);
  const rows = parseCsv_(String(a.csv || ""), 501);
  assert_(rows.length >= 2, "Fichier CSV vide (en-tête + au moins une ligne).");
  assert_(rows.length <= 501, "Import limité à 500 biens par fichier.");
  const headers = rows[0].map(function (h) { return String(h).trim(); });
  assert_(headers.indexOf("name") >= 0 && headers.indexOf("city") >= 0, "Colonnes obligatoires : name, city. Colonnes reconnues : " + PROPERTY_CSV_COLS_.join(", "));
  const results = [], valid = [];
  rows.slice(1).forEach(function (r, i) {
    const o = {}; headers.forEach(function (h, j) { if (PROPERTY_CSV_COLS_.indexOf(h) >= 0) o[h] = r[j] === undefined ? "" : String(r[j]).trim(); });
    if (!o.propertyType) delete o.propertyType; if (!o.rentalMode) delete o.rentalMode;
    try { valid.push(propertyInput_(o, true)); results.push({ line: i + 2, ok: true, name: o.name }); }
    catch (e) { results.push({ line: i + 2, ok: false, error: e.message }); }
  });
  if (a.dryRun !== false) return { dryRun: true, valid: valid.length, invalid: results.filter(function (x) { return !x.ok; }).length, results: results };
  assert_(results.every(function (x) { return x.ok; }), "Corrigez les lignes en erreur avant l'import réel.");
  return withLock_(function () {
    const e = entitlement_(orgId);
    if (billingEnforced_() && e.plan) {
      const n = dbAll_("Properties").filter(function (x) { return String(x.organizationId) === orgId && ["ARCHIVED", "DELETED"].indexOf(x.status) < 0; }).length;
      assert_(n + valid.length <= Number(e.plan.maxProperties), "L'import dépasserait le quota de biens du forfait (" + e.plan.maxProperties + ").", "QUOTA");
    }
    const ins = dbInsertMany_("Properties", valid.map(function (d) { return Object.assign({ propertyType: "APARTMENT", rentalMode: "SHORT_TERM", currency: cur_(), roomsJson: ["Séjour", "Chambre", "Cuisine", "Salle de bain"] }, d,
      { organizationId: orgId, ownerUserId: p.userId, status: "ACTIVE", createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_(), updatedBy: p.email }); }));
    audit_("PROPERTIES_IMPORTED", "Property", "", orgId, { count: ins.length });
    return { ok: true, imported: ins.length };
  });
}
function propertyExport_(p, a) {
  const list = propertyList_(p, Object.assign({}, a, { all: true })).items;
  assert_(list.length <= IMMO_CONFIG.MAX_EXPORT_ROWS, "Export limité à " + IMMO_CONFIG.MAX_EXPORT_ROWS + " lignes.");
  const cols = ["propertyId"].concat(PROPERTY_CSV_COLS_).concat(["status"]);
  audit_("PROPERTIES_EXPORTED", "Property", "", "", { count: list.length });
  return { fileName: "biens_" + todayStr_() + ".csv", mimeType: "text/csv", content: toCsv_(cols, list.map(function (x) { return cols.map(function (c) { return x[c] == null ? "" : x[c]; }); })) };
}

/* ---------------- Résidences (conservées de la phase 3) ---------------- */
function residenceList_(p, a) {
  const orgId = safeText_(a.organizationId, 120);
  if (!hasOrgCap_(p, orgId, "property.create") && !hasOrgCap_(p, orgId, "property.edit")) forbid_();
  return dbAll_("Residences").filter(function (r) { return String(r.organizationId) === orgId && r.status === "ACTIVE"; })
    .map(function (r) { return { residenceId: r.residenceId, name: r.name, city: r.city, address: r.address }; });
}
function residenceCreate_(p, a) {
  const orgId = safeText_(a.organizationId, 120);
  assertOrgCap_(p, orgId, "property.create");
  const r = dbInsert_("Residences", { organizationId: orgId, name: reqText_(a.name, "Nom", 2, 120), city: reqText_(a.city, "Ville", 2, 80), address: safeText_(a.address, 240), status: "ACTIVE", createdAt: nowIso_(), createdBy: p.email });
  audit_("RESIDENCE_CREATED", "Residence", r.residenceId, orgId, { name: r.name });
  return { ok: true, residenceId: r.residenceId };
}

/* ---------------- Agences et personnel ---------------- */
function propertyAgencyChoices_(p, a) {
  const x = assertProp_(p, a.propertyId, "property.assign");
  const agencyOrgs = {};
  dbAll_("UserRoles").forEach(function (r) { if (r.status === "ACTIVE" && (r.role === "AGENCY_ADMIN" || r.role === "AGENCY_USER")) agencyOrgs[String(r.organizationId)] = true; });
  return dbAll_("Organizations").filter(function (o) { return o.status === "ACTIVE" && String(o.organizationId) !== String(x.organizationId) && (agencyOrgs[String(o.organizationId)] || o.type === "AGENCY"); })
    .map(function (o) { return { organizationId: o.organizationId, name: o.name }; });
}
/** Attribue ou modifie les droits d'une agence sur un bien. Retirer canView révoque l'attribution. */
function propertyAgencySet_(p, a) {
  const x = assertProp_(p, a.propertyId, "property.assign");
  const agencyOrgId = safeText_(a.agencyOrganizationId, 120), agency = dbGet_("Organizations", agencyOrgId);
  assert_(agency && agency.status === "ACTIVE" && agencyOrgId !== String(x.organizationId), "Organisation agence invalide.");
  assert_(agency.type === "AGENCY" || dbAll_("UserRoles").some(function (r) { return String(r.organizationId) === agencyOrgId && (r.role === "AGENCY_ADMIN" || r.role === "AGENCY_USER") && r.status === "ACTIVE"; }), "Cette organisation n'est pas une agence active.");
  const flags = { canView: a.canView === true, canManageReservations: a.canManageReservations === true, canManageOperations: a.canManageOperations === true, canViewFinance: a.canViewFinance === true };
  assert_(flags.canView || (!flags.canManageReservations && !flags.canManageOperations && !flags.canViewFinance), "Les droits de gestion exigent le droit de consultation.");
  const validFrom = a.validFrom ? dateOnly_(a.validFrom, "Début") : "", validTo = a.validTo ? dateOnly_(a.validTo, "Fin") : "";
  assert_(!validFrom || !validTo || validFrom <= validTo, "Période d'attribution invalide.");
  const commissionRate = a.commissionRate === "" || a.commissionRate == null ? "" : rate_(a.commissionRate, "Commission agence");
  return withLock_(function () {
    const ex = dbAll_("AgencyPropertyPermissions").find(function (z) { return String(z.propertyId) === String(x.propertyId) && String(z.agencyOrganizationId) === agencyOrgId; });
    const patch = Object.assign({}, flags, { status: flags.canView ? "ACTIVE" : "REVOKED", commissionRate: commissionRate, validFrom: validFrom, validTo: validTo, updatedAt: nowIso_(), updatedBy: p.email });
    let id;
    if (ex) { dbUpdate_("AgencyPropertyPermissions", ex.permissionId, patch); id = ex.permissionId; }
    else id = dbInsert_("AgencyPropertyPermissions", Object.assign(patch, { propertyId: x.propertyId, ownerOrganizationId: x.organizationId, agencyOrganizationId: agencyOrgId, createdAt: nowIso_(), createdBy: p.email })).permissionId;
    audit_("AGENCY_PROPERTY_PERMISSION_UPDATED", "PropertyPermission", id, x.organizationId, Object.assign({ propertyId: x.propertyId, agencyOrganizationId: agencyOrgId }, flags));
    const agencyUsers = dbAll_("UserRoles").filter(function (r) { return String(r.organizationId) === agencyOrgId && r.role === "AGENCY_ADMIN" && r.status === "ACTIVE"; }).map(function (r) { return r.userId; });
    notify_({ eventKey: "agency-perm:" + id + ":" + patch.status + ":" + JSON.stringify(flags), userIds: agencyUsers, type: "AGENCY_ASSIGNMENT", organizationId: agencyOrgId,
      title: flags.canView ? "Bien attribué : " + x.name : "Attribution retirée : " + x.name, body: "Droits : " + Object.keys(flags).filter(function (k) { return flags[k]; }).join(", "), link: "#properties" });
    return { ok: true, permissionId: id, status: patch.status };
  });
}
function propertyAccessList_(p, a) {
  const x = assertProp_(p, a.propertyId, "property.assign");
  const orgs = indexBy_(dbAll_("Organizations"), "organizationId");
  return {
    agencies: dbAll_("AgencyPropertyPermissions").filter(function (z) { return String(z.propertyId) === String(x.propertyId); }).map(function (z) {
      return { permissionId: z.permissionId, agencyOrganizationId: z.agencyOrganizationId, agencyName: (orgs[z.agencyOrganizationId] || {}).name || z.agencyOrganizationId, canView: bool_(z.canView),
        canManageReservations: bool_(z.canManageReservations), canManageOperations: bool_(z.canManageOperations), canViewFinance: bool_(z.canViewFinance), commissionRate: z.commissionRate, validFrom: z.validFrom, validTo: z.validTo, status: z.status };
    }),
    staff: dbAll_("PropertyAssignments").filter(function (z) { return String(z.propertyId) === String(x.propertyId); }).map(function (z) {
      return { assignmentId: z.assignmentId, email: z.email, role: z.role, reservationId: z.reservationId || "", status: z.status, createdAt: z.createdAt };
    })
  };
}
/** Affecte un gardien / agent de ménage / artisan / locataire (compte existant titulaire du rôle). Réservation précise facultative pour un gardien. */
function propertyStaffAssign_(p, a) {
  const x = assertProp_(p, a.propertyId, "property.assign");
  const email = validateEmail_(a.email), role = oneOf_(a.role, ["GUARD", "CLEANER", "ARTISAN", "TENANT"], "Rôle");
  const user = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === email && u.status === "ACTIVE"; });
  const hasRole = user && dbAll_("UserRoles").some(function (r) { return String(r.userId) === String(user.userId) && r.role === role && r.status === "ACTIVE"; });
  assert_(hasRole, "Aucun compte actif avec ce rôle pour cette adresse. Invitez d'abord la personne (vous pouvez lier l'invitation au bien).");
  let reservationId = safeText_(a.reservationId || "", 120);
  if (reservationId) { assert_(role === "GUARD", "Seul un gardien peut être limité à une réservation."); const r = dbGet_("Reservations", reservationId); assert_(r && String(r.propertyId) === String(x.propertyId), "Réservation de ce bien introuvable."); }
  return withLock_(function () {
    const ex = dbAll_("PropertyAssignments").find(function (z) { return String(z.propertyId) === String(x.propertyId) && String(z.userId) === String(user.userId) && z.role === role && z.status === "ACTIVE" && String(z.reservationId || "") === reservationId; });
    if (ex) return { ok: true, assignmentId: ex.assignmentId, alreadyAssigned: true };
    const row = dbInsert_("PropertyAssignments", { propertyId: x.propertyId, reservationId: reservationId, userId: user.userId, email: email, role: role, status: "ACTIVE", createdAt: nowIso_(), createdBy: p.email });
    audit_("PROPERTY_USER_ASSIGNED", "PropertyAssignment", row.assignmentId, x.organizationId, { propertyId: x.propertyId, role: role, email: email });
    notify_({ eventKey: "assign:" + row.assignmentId, userIds: [user.userId], type: "ASSIGNMENT", organizationId: x.organizationId, title: "Nouvelle affectation : " + x.name, body: "Rôle : " + role, link: "#dashboard" });
    return { ok: true, assignmentId: row.assignmentId };
  });
}
function propertyStaffRevoke_(p, a) {
  const row = dbGet_("PropertyAssignments", safeText_(a.assignmentId, 120));
  if (!row) notFound_("Affectation");
  const x = assertProp_(p, row.propertyId, "property.assign");
  dbUpdate_("PropertyAssignments", row.assignmentId, { status: "REVOKED", revokedAt: nowIso_(), revokedBy: p.email });
  audit_("PROPERTY_USER_ASSIGNMENT_REVOKED", "PropertyAssignment", row.assignmentId, x.organizationId, { role: row.role, email: row.email });
  return { ok: true };
}
