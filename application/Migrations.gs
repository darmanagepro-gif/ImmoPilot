/**
 * Migrations versionnées et NON DESTRUCTIVES.
 * - Les feuilles et colonnes existantes ne sont jamais supprimées, renommées ni réordonnées.
 * - Les colonnes manquantes sont ajoutées à droite ; les données sont lues par NOM de colonne.
 * - Une sauvegarde complète du classeur est créée avant toute migration en attente.
 * - Chaque migration est inscrite dans MigrationHistory (DONE / FAILED) et n'est jamais rejouée une fois DONE.
 * - La migration de schéma (v1) est idempotente et s'exécute à chaque setupProject().
 */
var MIGRATIONS_ = [
  { version: 1, name: "schema_sync", run: function () { return migSchemaSync_(); } },
  { version: 2, name: "backfill_phase4_to_v2", run: function () { return migBackfill_(); } },
  { version: 3, name: "platform_seed", run: function () { return migSeed_(); } }
];

function migSchemaSync_() {
  const ss = dbSpreadsheet_(), report = { created: [], columnsAdded: {}, duplicates: [] };
  Object.keys(schema_()).forEach(function (name) {
    const S = schema_()[name];
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      if (sh.getMaxColumns() < S.cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), S.cols.length - sh.getMaxColumns());
      sh.getRange(1, 1, 1, S.cols.length).setValues([S.cols]).setFontWeight("bold");
      sh.setFrozenRows(1);
      report.created.push(name);
      return;
    }
    const lc = sh.getLastColumn();
    if (lc === 0 || sh.getLastRow() === 0) {
      if (sh.getMaxColumns() < S.cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), S.cols.length - sh.getMaxColumns());
      sh.getRange(1, 1, 1, S.cols.length).setValues([S.cols]).setFontWeight("bold"); sh.setFrozenRows(1); return;
    }
    const headers = sh.getRange(1, 1, 1, lc).getValues()[0].map(String);
    const seen = {};
    headers.forEach(function (h) { if (h) { if (seen[h]) report.duplicates.push(name + "." + h); seen[h] = true; } });
    const missing = S.cols.filter(function (c) { return !seen[c]; });
    if (missing.length) {
      if (sh.getMaxColumns() < lc + missing.length) sh.insertColumnsAfter(sh.getMaxColumns(), lc + missing.length - sh.getMaxColumns());
      sh.getRange(1, lc + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
      report.columnsAdded[name] = missing;
    }
  });
  dbReset_();
  if (report.duplicates.length) throw new AppError("SCHEMA", "En-têtes dupliqués détectés (corrigez-les manuellement, aucune donnée n'a été modifiée) : " + report.duplicates.join(", "));
  return report;
}

/** Applique patchFn(objet) à chaque ligne ; réécrit uniquement les colonnes modifiées, ré-encodées proprement. */
function migPatch_(table, patchFn) {
  const S = tableDef_(table), sh = dbSheet_(table), lr = sh.getLastRow();
  if (lr < 2) return 0;
  const headers = dbHeaders_(table), vals = sh.getRange(2, 1, lr - 1, headers.length).getValues();
  const objs = vals.map(function (row) { const o = {}; headers.forEach(function (h, i) { if (h) o[h] = normOut_(S, h, row[i]); }); o.__empty = !row.some(function (c) { return c !== "" && c !== null; }); return o; });
  const changed = {}; let n = 0;
  objs.forEach(function (o) {
    if (o.__empty) return;
    const patch = patchFn(o);
    if (!patch) return;
    let any = false;
    Object.keys(patch).forEach(function (k) {
      assert_(headers.indexOf(k) >= 0, "Colonne absente " + table + "." + k, "SCHEMA");
      if (String(o[k] == null ? "" : o[k]) !== String(patch[k] == null ? "" : patch[k])) { o[k] = patch[k]; changed[k] = true; any = true; }
    });
    if (any) n++;
  });
  Object.keys(changed).forEach(function (col) {
    const ci = headers.indexOf(col);
    sh.getRange(2, ci + 1, objs.length, 1).setValues(objs.map(function (o) { return [o.__empty ? "" : toCell_(S, col, o[col])]; }));
  });
  dbReset_();
  return n;
}

function migBackfill_() {
  const r = {};
  // Identifiants manquants : chaque ligne reçoit un identifiant stable.
  r.missingIds = {};
  Object.keys(schema_()).forEach(function (t) {
    const S = schema_()[t];
    if (t === "PlatformSettings" || t === "OperationRequests") return;
    const n = migPatch_(t, function (o) { return o[S.pk] ? null : (function () { const x = {}; x[S.pk] = newId_(S.idp); return x; })(); });
    if (n) r.missingIds[t] = n;
  });
  const roles = dbAll_("UserRoles");
  r.organizations = migPatch_("Organizations", function (o) {
    if (o.type) return null;
    const rs = roles.filter(function (x) { return String(x.organizationId) === String(o.organizationId); });
    const type = rs.some(function (x) { return x.role === "AGENCY_ADMIN" || x.role === "AGENCY_USER"; }) ? "AGENCY" : (rs.length && rs.every(function (x) { return x.role === "SUPER_ADMIN"; }) ? "PLATFORM" : "OWNER_ORG");
    return { type: type, timezone: o.timezone || tz_(), locale: o.locale || "fr" };
  });
  r.users = migPatch_("Users", function (u) { return u.notifPrefsJson ? null : { notifPrefsJson: jsonSafe_({ email: true, mutedTypes: [] }), locale: u.locale || "fr" }; });
  const props = indexBy_(dbAll_("Properties"), "propertyId");
  r.reservations = migPatch_("Reservations", function (x) {
    const pr = props[String(x.propertyId)] || {};
    const patch = {};
    if (!x.paymentStatus) patch.paymentStatus = "UNPAID";
    if (x.version === null || x.version === "") patch.version = 0;
    if (!x.currency) patch.currency = "MAD";
    if (!x.source) patch.source = "DIRECT";
    if (!x.checkInAt && isDateStr_(x.checkIn)) patch.checkInAt = localToDate_(x.checkIn, pr.checkInTime || DEFAULT_SETTINGS["reservation.defaultCheckIn"]).toISOString();
    if (!x.checkOutAt && isDateStr_(x.checkOut)) patch.checkOutAt = localToDate_(x.checkOut, pr.checkOutTime || DEFAULT_SETTINGS["reservation.defaultCheckOut"]).toISOString();
    if (IMMO_CONFIG && schema_().Reservations.enums.status.indexOf(x.status) < 0) patch.status = "CONFIRMED";
    return Object.keys(patch).length ? patch : null;
  });
  const sevMap = { LOW: "LOW", NORMAL: "MEDIUM", HIGH: "HIGH", URGENT: "CRITICAL" };
  const incStatuses = schema_().IncidentsV4.enums.status;
  r.incidentsV4 = migPatch_("IncidentsV4", function (i) {
    const patch = {};
    if (!i.severity) patch.severity = sevMap[i.priority] || "MEDIUM";
    if (incStatuses.indexOf(i.status) < 0) patch.status = "OPEN";
    if (!i.title) patch.title = String(i.description || i.category || "Incident").slice(0, 80);
    return Object.keys(patch).length ? patch : null;
  });
  // Copie (sans toucher la feuille historique) des incidents de la phase 3 vers IncidentsV4.
  const existingInc = indexBy_(dbAll_("IncidentsV4"), "incidentId");
  const toCopy = dbAll_("Incidents").filter(function (i) { return i.incidentId && !existingInc[String(i.incidentId)]; }).map(function (i) {
    return { incidentId: i.incidentId, organizationId: i.organizationId, propertyId: i.propertyId, reservationId: "", category: i.category || "OTHER", priority: "NORMAL", severity: "MEDIUM",
      description: i.description || "(incident historique)", status: incStatuses.indexOf(i.status) >= 0 ? i.status : "OPEN", photoFileIdsJson: "[]", createdAt: i.createdAt || nowIso_(),
      createdBy: i.createdBy || "", updatedAt: nowIso_(), updatedBy: "migration", title: String(i.description || i.category || "Incident").slice(0, 80), legacyOrigin: "Incidents" };
  }).filter(function (x) { return x.propertyId; });
  dbInsertMany_("IncidentsV4", toCopy); r.legacyIncidentsCopied = toCopy.length;
  r.quotes = migPatch_("Quotes", function (q) { return (q.amountHT === null || q.amountHT === "") && q.totalAmount !== null ? { amountHT: q.totalAmount, vatRate: 0, amountTTC: q.totalAmount, submittedAt: q.createdAt } : null; });
  const users = dbAll_("Users");
  r.artisans = migPatch_("Artisans", function (a) {
    if (a.userId) return null;
    const u = users.find(function (x) { return normalizeEmail_(x.email) === normalizeEmail_(a.email); });
    return u ? { userId: u.userId } : null;
  });
  r.missions = migPatch_("CleaningMissions", function (m) { return m.priority ? null : { priority: "NORMAL", reassignCount: 0, source: "LEGACY" }; });
  // Enregistrement des fichiers Drive historiques dans Documents, afin qu'ils soient servis via le contrôle d'accès.
  const known = {}; dbAll_("Documents").forEach(function (d) { known[d.fileId] = true; });
  const docs = [];
  const reg = function (fileId, ownerType, ownerId, category, row) {
    if (!fileId || known[fileId]) return; known[fileId] = true;
    docs.push({ organizationId: row.organizationId || "", propertyId: row.propertyId || "", ownerType: ownerType, ownerId: ownerId, category: category, fileId: fileId,
      fileName: "historique_" + fileId.slice(0, 8), mimeType: "", sizeBytes: null, sha256: "", sensitive: false, status: "ACTIVE", createdAt: row.createdAt || nowIso_(), createdBy: "migration", legacy: true });
  };
  dbAll_("CleaningReports").forEach(function (c) { parseJson_(c.photoFileIdsJson, []).forEach(function (f) { reg(f, "CLEANING", c.missionId, "PHOTO_AFTER", c); }); });
  dbAll_("IncidentsV4").forEach(function (i) { parseJson_(i.photoFileIdsJson, []).forEach(function (f) { reg(f, "INCIDENT", i.incidentId, "PHOTO", i); }); });
  dbAll_("WorkOrders").forEach(function (w) { reg(w.invoiceFileId, "WORKORDER", w.workOrderId, "INVOICE", w); });
  dbInsertMany_("Documents", docs); r.legacyDocumentsRegistered = docs.length;
  return r;
}

function migSeed_() {
  const r = { plans: 0, platformOrg: false };
  DEFAULT_PLANS.forEach(function (pl) {
    if (dbGet_("SubscriptionPlans", pl.planCode)) return;
    dbInsert_("SubscriptionPlans", { planCode: pl.planCode, name: pl.name, price: pl.price, currency: "MAD", periodicity: pl.periodicity, maxProperties: pl.maxProperties,
      maxUsers: pl.maxUsers, storageMb: pl.storageMb, featuresJson: pl.features, quotasJson: { exportRows: IMMO_CONFIG.MAX_EXPORT_ROWS }, trialDays: pl.trialDays, status: "ACTIVE", sortOrder: pl.sortOrder, updatedAt: nowIso_(), updatedBy: "migration" });
    r.plans++;
  });
  if (!dbAll_("Organizations").some(function (o) { return o.type === "PLATFORM"; })) {
    dbInsert_("Organizations", { name: "ImmoPilot Plateforme", status: "ACTIVE", type: "PLATFORM", country: "MA", city: "Marrakech", timezone: tz_(), locale: "fr", createdAt: nowIso_(), createdBy: "migration" });
    r.platformOrg = true;
  }
  return r;
}

/** Exécute les migrations en attente, avec sauvegarde préalable. Doit être appelé sous verrou. */
function runMigrations_(actor) {
  const ss = dbSpreadsheet_();
  const hasHistory = !!ss.getSheetByName("MigrationHistory");
  const done = hasHistory ? dbAll_("MigrationHistory").filter(function (m) { return m.status === "DONE"; }).map(function (m) { return Number(m.version); }) : [];
  const pending = MIGRATIONS_.filter(function (m) { return done.indexOf(m.version) < 0; });
  const results = [];
  let backup = null;
  if (pending.length && ss.getSheets().some(function (s) { return schema_()[s.getName()] && s.getLastRow() > 1; })) backup = backupDatabase_("pre-migration");
  results.push({ version: 1, name: "schema_sync", details: migSchemaSync_() });
  pending.forEach(function (m) {
    if (m.version === 1) { dbInsert_("MigrationHistory", { version: 1, name: m.name, appliedAt: nowIso_(), appliedBy: actor, status: "DONE", detailsJson: results[0].details }); return; }
    try {
      const d = m.run();
      dbInsert_("MigrationHistory", { version: m.version, name: m.name, appliedAt: nowIso_(), appliedBy: actor, status: "DONE", detailsJson: d });
      results.push({ version: m.version, name: m.name, details: d });
    } catch (e) {
      dbInsert_("MigrationHistory", { version: m.version, name: m.name, appliedAt: nowIso_(), appliedBy: actor, status: "FAILED", detailsJson: { error: e.message } });
      throw new AppError("MIGRATION", "Migration v" + m.version + " échouée : " + e.message + (backup ? " — sauvegarde disponible : " + backup.name : ""));
    }
  });
  return { backup: backup, applied: results, schemaVersion: IMMO_CONFIG.SCHEMA_VERSION };
}

/** Rapport d'intégrité : identifiants manquants ou dupliqués, références orphelines principales. Lecture seule. */
function integrityReport_() {
  const out = { duplicates: {}, missingIds: {}, orphans: {} };
  Object.keys(schema_()).forEach(function (t) {
    const S = schema_()[t]; const seen = {}; let missing = 0, dup = 0;
    dbAll_(t).forEach(function (r) { const id = String(r[S.pk] || ""); if (!id) missing++; else if (seen[id]) dup++; else seen[id] = true; });
    if (missing) out.missingIds[t] = missing;
    if (dup) out.duplicates[t] = dup;
  });
  const props = indexBy_(dbAll_("Properties"), "propertyId");
  ["Reservations", "IncidentsV4", "CleaningMissions", "Leases", "WorkOrders"].forEach(function (t) {
    const n = dbAll_(t).filter(function (r) { return r.propertyId && !props[String(r.propertyId)]; }).length;
    if (n) out.orphans[t] = n;
  });
  // Séjours qui se chevauchent (nuits communes), par exemple hérités d'une version antérieure : signalés, jamais modifiés.
  out.overlaps = [];
  const byProp = {};
  dbAll_("Reservations").filter(function (r) { return RESV_BLOCKING_.indexOf(r.status) >= 0 && isDateStr_(r.checkIn) && isDateStr_(r.checkOut); })
    .forEach(function (r) { (byProp[String(r.propertyId)] = byProp[String(r.propertyId)] || []).push(r); });
  Object.keys(byProp).forEach(function (pid) {
    const list = byProp[pid].sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0; });
    let maxEnd = null, maxId = null;
    list.forEach(function (r) {
      if (maxEnd && r.checkIn < maxEnd && out.overlaps.length < 100) out.overlaps.push({ propertyId: pid, reservationA: maxId, reservationB: r.reservationId });
      if (!maxEnd || r.checkOut > maxEnd) { maxEnd = r.checkOut; maxId = r.reservationId; }
    });
  });
  out.ok = !Object.keys(out.duplicates).length && !Object.keys(out.missingIds).length && !out.overlaps.length;
  return out;
}

/* ------------------------- Sauvegarde / restauration ------------------------- */
function backupDatabase_(label) {
  const ss = dbSpreadsheet_();
  const name = "ImmoPilot_backup_" + Utilities.formatDate(new Date(), tz_(), "yyyyMMdd_HHmmss") + "_" + String(label || "manuel").replace(/[^\w-]/g, "");
  const folder = systemFolder_("Sauvegardes");
  const copy = DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  copy.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  const keep = Number(getSettingSafe_("backup.keep")) || 14;
  const files = [], it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(); if (/^ImmoPilot_backup_/.test(f.getName())) files.push(f); }
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  files.slice(keep).forEach(function (f) { if (!/pre-migration|pre-restore/.test(f.getName())) f.setTrashed(true); });
  return { fileId: copy.getId(), name: name };
}
function getSettingSafe_(k) { try { return getSetting_(k); } catch (e) { return DEFAULT_SETTINGS[k]; } }
function listBackups_() {
  const folder = systemFolder_("Sauvegardes"), out = [], it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(); out.push({ fileId: f.getId(), name: f.getName(), createdAt: f.getDateCreated().toISOString(), sizeBytes: f.getSize() }); }
  return out.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
}
