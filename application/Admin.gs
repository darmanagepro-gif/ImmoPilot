/**
 * Administration : fonctions à exécuter depuis l'ÉDITEUR Apps Script (installation, premier super administrateur,
 * sauvegarde/restauration, déclencheurs) et routes d'administration de la plateforme.
 *
 * IMPORTANT : toute fonction globale sans « _ » final est appelable depuis le navigateur (google.script.run).
 * Les fonctions d'installation sont donc protégées par assertEditor_() : elles refusent de s'exécuter
 * si l'utilisateur actif n'est pas le propriétaire du script (cas d'un visiteur anonyme de l'application web).
 */
function assertEditor_() {
  let active = "", effective = "";
  try { active = normalizeEmail_(Session.getActiveUser().getEmail()); effective = normalizeEmail_(Session.getEffectiveUser().getEmail()); } catch (e) { /* refus ci-dessous */ }
  if (!active || active !== effective) throw new AppError("FORBIDDEN", "Fonction réservée au propriétaire du script, depuis l'éditeur Apps Script.");
  return active;
}

/**
 * Installation / mise à jour NON DESTRUCTIVE, à exécuter depuis l'éditeur.
 * Installation à partir de rien : aucune propriété à renseigner. La fonction crée le dossier Drive privé,
 * la base Google Sheet (dans ce dossier) et désigne le propriétaire du script comme premier super administrateur.
 * Si IMMO_DATABASE_SPREADSHEET_ID est déjà renseignée, cette base est utilisée telle quelle (jamais recréée).
 */
function setupProject() {
  const owner = assertEditor_();
  ctxReset_();
  return withLock_(function () {
    const props = PropertiesService.getScriptProperties();
    const adminSetup = ensureAdminEmails_(props, owner);
    const root = driveRoot_();
    const dbSetup = ensureDatabase_(props, root);
    const mig = runMigrations_("setupProject:" + owner);
    ["Modeles", "Sauvegardes", "Exports", "Organisations"].forEach(function (n) { subFolder_(root, n); });
    const admins = createFirstSuperAdminInternal_(owner, props);
    return { ok: true, version: IMMO_CONFIG.VERSION, databaseCreated: dbSetup.created, spreadsheetId: dbSetup.id, spreadsheetUrl: dbSetup.url,
      adminEmailsDefaulted: adminSetup.defaulted, privateDriveFolderId: root.getId(), driveRootPrivate: driveRootIsPrivate_(),
      migrations: mig, superAdmins: admins, next: "Déployez l'application web, renseignez IMMO_APP_URL, exécutez createFirstSuperAdmin() puis installTriggers()." };
  }, 30000);
}

/** Si IMMO_ADMIN_EMAILS est vide, le propriétaire du script (seul à pouvoir lancer setupProject) devient le premier super administrateur. */
function ensureAdminEmails_(props, owner) {
  const raw = String(props.getProperty(IMMO_CONFIG.ADMIN_EMAILS_PROPERTY) || "").trim();
  if (raw) return { defaulted: false, emails: raw };
  validateEmail_(owner);
  props.setProperty(IMMO_CONFIG.ADMIN_EMAILS_PROPERTY, owner);
  return { defaulted: true, emails: owner };
}

/**
 * Crée la base Google Sheet si aucune n'est configurée : classeur privé « ImmoPilot_DB », rangé dans le dossier Drive privé,
 * fuseau Africa/Casablanca. Une base déjà configurée n'est jamais remplacée ; si elle est introuvable, l'installation s'arrête.
 */
function ensureDatabase_(props, rootFolder) {
  const existing = props.getProperty(IMMO_CONFIG.DATABASE_PROPERTY);
  if (existing) {
    let ss;
    try { ss = SpreadsheetApp.openById(existing); }
    catch (e) { throw new AppError("CONFIG", "La base indiquée dans IMMO_DATABASE_SPREADSHEET_ID est introuvable ou inaccessible. Corrigez l'identifiant, ou videz la propriété pour créer une nouvelle base."); }
    dbSetSpreadsheet_(ss);
    return { created: false, id: ss.getId(), url: "https://docs.google.com/spreadsheets/d/" + ss.getId() + "/edit" };
  }
  const ss = SpreadsheetApp.create("ImmoPilot_DB");
  try { ss.setSpreadsheetTimeZone(IMMO_CONFIG.TIMEZONE); } catch (e) { console.warn("Fuseau du classeur non modifié : " + e.message); }
  const file = DriveApp.getFileById(ss.getId());
  file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  if (rootFolder) { try { file.moveTo(rootFolder); } catch (e) { console.warn("Classeur laissé à la racine du Drive : " + e.message); } }
  const first = ss.getSheets()[0];
  if (first && ss.getSheets().length === 1 && first.getLastRow() === 0) {
    first.setName("Accueil");
    first.getRange(1, 1, 3, 1).setValues([["'Base de données ImmoPilot " + IMMO_CONFIG.VERSION], ["'Ne modifiez, ne triez et ne supprimez aucun onglet à la main : passez par l'application."], ["'Créée le " + nowIso_()]]);
  }
  props.setProperty(IMMO_CONFIG.DATABASE_PROPERTY, ss.getId());
  dbSetSpreadsheet_(ss);
  return { created: true, id: ss.getId(), url: "https://docs.google.com/spreadsheets/d/" + ss.getId() + "/edit" };
}

/** Crée (ou complète) les super administrateurs listés dans IMMO_ADMIN_EMAILS et envoie un lien d'activation. */
function createFirstSuperAdmin() {
  const owner = assertEditor_();
  ctxReset_();
  return withLock_(function () { return createFirstSuperAdminInternal_(owner); });
}
function createFirstSuperAdminInternal_(owner, props) {
  const raw = (props || PropertiesService.getScriptProperties()).getProperty(IMMO_CONFIG.ADMIN_EMAILS_PROPERTY) || "";
  const emails = raw.split(",").map(normalizeEmail_).filter(Boolean);
  assert_(emails.length, "Renseignez IMMO_ADMIN_EMAILS (propriétés du script) avec au moins une adresse.", "CONFIG");
  let platform = dbAll_("Organizations").find(function (o) { return o.type === "PLATFORM"; });
  if (!platform) platform = dbInsert_("Organizations", { name: "ImmoPilot Plateforme", status: "ACTIVE", type: "PLATFORM", country: "MA", city: "Marrakech", timezone: tz_(), locale: "fr", createdAt: nowIso_(), createdBy: owner });
  return emails.map(function (email) {
    validateEmail_(email);
    let user = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === email; });
    if (!user) user = dbInsert_("Users", { email: email, displayName: email.split("@")[0], status: "ACTIVE", createdAt: nowIso_(), createdBy: "editor:" + owner, locale: "fr", notifPrefsJson: { email: true, mutedTypes: [] } });
    else if (user.status !== "ACTIVE") dbUpdate_("Users", user.userId, { status: "ACTIVE" });
    const hasRole = dbAll_("UserRoles").some(function (r) { return String(r.userId) === String(user.userId) && r.role === "SUPER_ADMIN" && r.status === "ACTIVE"; });
    if (!hasRole) dbInsert_("UserRoles", { userId: user.userId, organizationId: platform.organizationId, role: "SUPER_ADMIN", status: "ACTIVE", createdAt: nowIso_(), createdBy: "editor:" + owner, permissionsJson: "[]" });
    let link = "";
    if (!user.passwordHash) {
      try { link = sendPasswordLink_(user, "ACTIVATION"); Logger.log("Lien d'activation pour " + email + " (confidentiel, valable 72 h) : " + link); }
      catch (e) { link = "ERREUR : " + e.message + " — déployez l'application web puis relancez createFirstSuperAdmin()."; }
    }
    auditAs_(owner, "", "SUPER_ADMIN_PROVISIONED", "User", user.userId, platform.organizationId, { email: email });
    return { email: email, userId: user.userId, roleCreated: !hasRole, activationLinkSent: !!link && link.indexOf("ERREUR") < 0, activationNote: link ? "Lien envoyé par e-mail et écrit dans le journal d'exécution." : "Compte déjà activé." };
  });
}

/** Sauvegarde manuelle (copie privée du classeur dans Sauvegardes/). */
function backupNow() { assertEditor_(); return backupDatabase_("manuel"); }

/**
 * Restauration NON DESTRUCTIVE : la base courante est d'abord sauvegardée, puis une COPIE de la sauvegarde
 * devient la base active (la base courante et la sauvegarde restent intactes). Exemple : restoreFromBackup("1AbC...").
 */
function restoreFromBackup(backupFileId) {
  const owner = assertEditor_();
  assert_(/^[\w-]{20,}$/.test(String(backupFileId || "")), "Identifiant de sauvegarde invalide.");
  return withLock_(function () {
    const before = backupDatabase_("pre-restore");
    const src = DriveApp.getFileById(backupFileId);
    const restored = src.makeCopy("ImmoPilot_DB_restored_" + Utilities.formatDate(new Date(), tz_(), "yyyyMMdd_HHmmss"), systemFolder_("Sauvegardes"));
    restored.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    const old = PropertiesService.getScriptProperties().getProperty(IMMO_CONFIG.DATABASE_PROPERTY);
    PropertiesService.getScriptProperties().setProperty(IMMO_CONFIG.DATABASE_PROPERTY, restored.getId());
    DB_SS_ = null; dbReset_();
    auditAs_(owner, "", "DATABASE_RESTORED", "System", restored.getId(), "", { from: backupFileId, previousDatabase: old, safetyBackup: before.fileId });
    return { ok: true, activeDatabaseId: restored.getId(), previousDatabaseId: old, safetyBackup: before, note: "Pour annuler : remettre previousDatabaseId dans IMMO_DATABASE_SPREADSHEET_ID." };
  }, 30000);
}

/** Diagnostic non destructif (éditeur). */
function healthCheck() { assertEditor_(); ctxReset_(); return diagnostics_(); }

/** Fonction d'éditeur : mesure le temps des étapes de la connexion et de la lecture des tables (aucune donnée modifiée). */
function mesurerPerformance() {
  assertEditor_(); ctxReset_(); dbReset_();
  const out = {}, time = function (label, fn) { const t = Date.now(); const r = fn(); out[label] = (Date.now() - t) + " ms"; return r; };
  time("Mot de passe (PBKDF2, " + pbkdfIters_() + " itérations)", function () { return pbkdf2Hex_("Mesure-Perf1", "0123456789abcdef0123456789abcdef", pbkdfIters_()); });
  time("Ouverture de la base", function () { return dbSpreadsheet_(); });
  ["Users", "UserRoles", "Organizations", "Sessions", "Notifications", "Reservations", "Payments", "Expenses", "ActivityLogs", "Documents"].forEach(function (t) {
    const n = time("Lecture " + t, function () { return dbAll_(t).length; }); out["Lignes " + t] = n;
  });
  dbReset_();
  const s = dbAll_("Sessions").slice(-1)[0]; dbReset_();
  if (s) time("Recherche ciblée d'une session", function () { return dbFindFast_("Sessions", "tokenHash", s.tokenHash); });
  out.conseil = "Si une lecture dépasse 2 000 ms, envoyez ce résultat au support : la table concernée peut être allégée (archivage) sans perte.";
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
function diagnostics_() {
  const ss = dbSpreadsheet_();
  const missing = Object.keys(schema_()).filter(function (n) { return !ss.getSheetByName(n); });
  const missingCols = {};
  Object.keys(schema_()).forEach(function (n) {
    if (missing.indexOf(n) >= 0) return;
    const h = dbHeaders_(n); const m = schema_()[n].cols.filter(function (c) { return h.indexOf(c) < 0; });
    if (m.length) missingCols[n] = m;
  });
  const done = missing.indexOf("MigrationHistory") >= 0 ? [] : dbAll_("MigrationHistory").filter(function (m) { return m.status === "DONE"; }).map(function (m) { return m.version; });
  const triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  let mailQuota = null; try { mailQuota = MailApp.getRemainingDailyQuota(); } catch (e) { mailQuota = "indisponible"; }
  const sizes = {}; Object.keys(schema_()).forEach(function (n) { const sh = ss.getSheetByName(n); if (sh) sizes[n] = Math.max(sh.getLastRow() - 1, 0); });
  const cells = ss.getSheets().reduce(function (a, s) { return a + s.getMaxRows() * s.getMaxColumns(); }, 0);
  return { ok: missing.length === 0 && !Object.keys(missingCols).length, version: IMMO_CONFIG.VERSION, schemaVersion: IMMO_CONFIG.SCHEMA_VERSION, migrationsDone: done,
    missingSheets: missing, missingColumns: missingCols, triggers: triggers, triggersOk: ["jobFrequent", "jobDaily"].every(function (t) { return triggers.indexOf(t) >= 0; }),
    mailQuotaRemaining: mailQuota, driveRoot: driveRootIsPrivate_(), rows: sizes, spreadsheetCells: cells, cellLimit: 10000000,
    appUrlConfigured: !!safeAppUrl_(), checkedAt: nowIso_(), integrity: missing.length ? null : integrityReport_() };
}

/* ----------------------------- Routes super administrateur ----------------------------- */
function adminDiagnostics_(p) { requireSuper_(p); return diagnostics_(); }
function adminBackup_(p) { requireSuper_(p); const b = withLock_(function () { return backupDatabase_("admin"); }, 30000); audit_("BACKUP_CREATED", "System", b.fileId, "", { name: b.name }); return b; }
function adminBackups_(p) { requireSuper_(p); return listBackups_(); }
function adminErrors_(p, a) {
  requireSuper_(p);
  const rows = dbAll_("ActivityLogs").filter(function (l) { return l.action === "ERROR" || l.result === "ERROR"; })
    .sort(function (x, y) { return String(y.timestamp).localeCompare(String(x.timestamp)); })
    .map(function (l) { const d = parseJson_(l.detailsJson, {}); return { timestamp: l.timestamp, errorId: l.errorId || d.errorId || "", route: d.route || "", message: d.message || "", actorEmail: l.actorEmail }; });
  return pageOf_(rows, a);
}
function adminJobs_(p, a) {
  requireSuper_(p);
  return pageOf_(dbAll_("ScheduledJobs").slice().sort(function (x, y) { return String(y.startedAt).localeCompare(String(x.startedAt)); })
    .map(function (j) { return { jobName: j.jobName, startedAt: j.startedAt, finishedAt: j.finishedAt, status: j.status, result: parseJson_(j.resultJson, {}), error: j.error }; }), a);
}
/** Paramètres : plateforme (super admin) ou organisation (settings.manage). */
function settingsGet_(p, a) {
  const orgId = safeText_(a.organizationId || "", 120);
  if (orgId) { if (!p.isSuper) assertOrgCap_(p, orgId, "settings.manage"); } else requireSuper_(p);
  const out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { out[k] = getSetting_(k, orgId || null); });
  return { organizationId: orgId, settings: out };
}
var ORG_EDITABLE_SETTINGS_ = ["reservation.defaultCheckIn", "reservation.defaultCheckOut", "reservation.minTurnaroundMinutes", "reservation.cancellationPolicy", "checkin.graceMinutes",
  "cleaning.acceptanceMinutes", "cleaning.requirePhotos", "commission.contractorRate", "commission.vatRate", "finance.vatRate", "quote.agencyApprovalLimit", "workorder.requireQuote",
  "invoice.tolerancePercent", "rent.graceDays", "alerts.rentDueDays", "alerts.leaseEndDays", "alerts.incidentAgeDays", "alerts.incidentCost", "retention.sensitiveDocDays",
  "guests.storeIdReference", "notify.emailEnabled", "template.leaseDocId", "template.receiptDocId", "template.reservationDocId", "list.incidentCategories", "list.expenseCategories",
  "list.cancelReasons", "list.cleaningAnomalies", "list.specialties", "locale", "currency"];
function settingsSet_(p, a) {
  const orgId = safeText_(a.organizationId || "", 120), key = String(a.key || "");
  assert_(Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key), "Paramètre inconnu.");
  if (orgId) { if (!p.isSuper) assertOrgCap_(p, orgId, "settings.manage"); assert_(ORG_EDITABLE_SETTINGS_.indexOf(key) >= 0, "Paramètre réservé à la plateforme."); }
  else requireSuper_(p);
  const v = validateSettingValue_(key, a.value);
  setSetting_(key, v, orgId || null, p.email);
  audit_("SETTING_UPDATED", "Setting", key, orgId, { key: key, value: v });
  return { ok: true, key: key, value: v };
}
function validateSettingValue_(key, v) {
  const def = DEFAULT_SETTINGS[key];
  if (typeof def === "boolean") return bool_(v);
  if (typeof def === "number") { const n = Number(v); assert_(isFinite(n) && n >= 0 && n <= 1e7, "Valeur numérique invalide."); return n; }
  if (Array.isArray(def)) {
    const arr = Array.isArray(v) ? v : String(v || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    if (key === "reservation.cancellationPolicy") return arr.map(function (x) { const o = typeof x === "object" ? x : {}; return { daysBefore: Math.max(0, parseInt(o.daysBefore, 10) || 0), penaltyPercent: rate_(o.penaltyPercent, "Pénalité") }; }).sort(function (x, y) { return y.daysBefore - x.daysBefore; });
    if (key === "alerts.leaseEndDays") return arr.map(function (x) { return Math.max(1, parseInt(x, 10) || 30); }).slice(0, 5);
    return arr.slice(0, 40).map(function (x) { return safeText_(String(x).toUpperCase().replace(/[^A-Z0-9_]/g, "_"), 40); }).filter(Boolean);
  }
  if (/^template\./.test(key)) { const s = safeText_(v, 100); assert_(!s || /^[\w-]{20,}$/.test(s), "Identifiant de document Google invalide."); if (s) assertTemplateAllowed_(s); return s; }
  if (/Check(In|Out)$/.test(key)) { const s = safeText_(v, 5); assert_(/^([01]\d|2[0-3]):[0-5]\d$/.test(s), "Heure au format HH:MM attendue."); return s; }
  if (key === "locale") return oneOf_(v, IMMO_LANGS_, "Langue");
  if (key === "currency") return oneOf_(String(v).toUpperCase(), ["MAD", "EUR", "USD"], "Devise");
  return safeText_(v, 500);
}

/* ----------------------------- Journal d'audit ----------------------------- */
function auditList_(p, a) {
  a = a || {};
  const orgId = safeText_(a.organizationId || "", 120);
  let allowedOrgs = null;
  if (!p.isSuper) {
    allowedOrgs = p.roles.filter(function (r) { return r.caps.indexOf("audit.view.org") >= 0; }).map(function (r) { return r.organizationId; });
    if (!allowedOrgs.length) forbid_("Accès au journal d'audit refusé.");
    if (orgId) assert_(allowedOrgs.indexOf(orgId) >= 0, "Organisation non autorisée.", "FORBIDDEN");
  }
  const from = a.from ? dateOnly_(a.from, "Début") : "", to = a.to ? dateOnly_(a.to, "Fin") : "";
  const rows = dbAll_("ActivityLogs").filter(function (l) {
    if (allowedOrgs && allowedOrgs.indexOf(String(l.organizationId)) < 0) return false;
    if (orgId && String(l.organizationId) !== orgId) return false;
    const d = String(l.timestamp).slice(0, 10);
    if (from && d < from) return false; if (to && d > to) return false;
    if (a.action && String(l.action).indexOf(String(a.action).toUpperCase()) < 0) return false;
    return matchesQuery_(a.q, [l.actorEmail, l.entityType, l.entityId, l.action]);
  }).sort(function (x, y) { return String(y.timestamp).localeCompare(String(x.timestamp)); })
    .map(function (l) { return { timestamp: l.timestamp, actorEmail: l.actorEmail, organizationId: l.organizationId, action: l.action, entityType: l.entityType, entityId: l.entityId, result: l.result || "OK", details: parseJson_(l.detailsJson, {}) }; });
  return pageOf_(rows, a);
}
