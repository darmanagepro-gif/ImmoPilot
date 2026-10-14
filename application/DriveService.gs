/**
 * Google Drive : stockage privé des documents.
 * - Tous les fichiers appartiennent au compte propriétaire du script, dans un dossier racine PRIVÉ, jamais partagé.
 * - Aucun lien « toute personne disposant du lien ». Les utilisateurs ne reçoivent jamais d'URL Drive :
 *   le contenu est renvoyé (base64) uniquement après contrôle des droits côté serveur.
 * - Arborescence : ImmoPilot_PRIVATE/Organisations/<orgId>/Biens/<propertyId>/<Catégorie>, + Rapports, Exports, Modeles, Sauvegardes.
 */
var DOC_FOLDERS_ = { PROPERTY: "Photos", RESERVATION: "Reservations", GUEST: "Voyageurs", CHECKIN: "CheckIn_CheckOut", CLEANING: "Menage",
  INCIDENT: "Incidents", WORKORDER: "Maintenance", QUOTE: "Maintenance", INVOICE: "Factures", LEASE: "Contrats", TENANT: "Contrats", PAYMENT: "Factures", CONTRACTOR: "Documents_administratifs", REPORT: "Rapports" };
var DOC_OWNER_TYPES_ = Object.keys(DOC_FOLDERS_);
var MIME_SIGNATURES_ = {
  "image/jpeg": function (b) { return b[0] === -1 && b[1] === -40 && b[2] === -1; },
  "image/png": function (b) { return b[0] === -119 && b[1] === 80 && b[2] === 78 && b[3] === 71; },
  "image/webp": function (b) { return b[0] === 82 && b[1] === 73 && b[2] === 70 && b[3] === 70 && b[8] === 87 && b[9] === 69 && b[10] === 66 && b[11] === 80; },
  "application/pdf": function (b) { return b[0] === 37 && b[1] === 80 && b[2] === 68 && b[3] === 70; }
};

function driveRoot_() {
  if (TEST_HOOKS_.driveRoot) return TEST_HOOKS_.driveRoot;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(IMMO_CONFIG.DRIVE_ROOT_PROPERTY);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { throw new AppError("CONFIG", "Dossier Drive privé introuvable (IMMO_PRIVATE_ROOT_FOLDER_ID). Vérifiez la configuration."); } }
  const f = DriveApp.createFolder("ImmoPilot_PRIVATE_FILES_DO_NOT_SHARE");
  f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  props.setProperty(IMMO_CONFIG.DRIVE_ROOT_PROPERTY, f.getId());
  return f;
}
/** Sous-dossier par nom (identifiant de dossier mis en cache : ce n'est pas une donnée d'autorisation). */
function subFolder_(parent, name) {
  const cache = CacheService.getScriptCache(), key = "fld_" + sha256Hex_(parent.getId() + "/" + name).slice(0, 40);
  const cached = cache.get(key);
  if (cached) { try { return DriveApp.getFolderById(cached); } catch (e) { cache.remove(key); } }
  const it = parent.getFoldersByName(name);
  const f = it.hasNext() ? it.next() : parent.createFolder(name);
  cache.put(key, f.getId(), 21600);
  return f;
}
function orgFolder_(orgId) { return subFolder_(subFolder_(driveRoot_(), "Organisations"), String(orgId)); }
function propertyFolder_(orgId, propertyId, ownerType) { return subFolder_(subFolder_(subFolder_(orgFolder_(orgId), "Biens"), String(propertyId)), DOC_FOLDERS_[ownerType] || "Divers"); }
function systemFolder_(name) { return subFolder_(driveRoot_(), name); }
function driveRootIsPrivate_() {
  try { const f = driveRoot_(); return { ok: f.getSharingAccess() === DriveApp.Access.PRIVATE, access: String(f.getSharingAccess()), folderId: f.getId() }; }
  catch (e) { return { ok: false, error: e.message }; }
}

/**
 * Contexte d'un propriétaire de document : bien, organisation, droits de lecture et d'écriture.
 * C'est LA fonction de contrôle d'accès des fichiers (lecture, dépôt, archivage).
 */
function docOwnerCtx_(p, ownerType, ownerId, category) {
  oneOf_(ownerType, DOC_OWNER_TYPES_, "Type de document");
  ownerId = safeText_(ownerId, 120);
  const ctx = { propertyId: "", organizationId: "", canRead: false, canWrite: false, sensitive: false };
  const setProp = function (propId) { const pr = dbGet_("Properties", propId); if (pr) { ctx.propertyId = pr.propertyId; ctx.organizationId = pr.organizationId; } return pr; };
  if (ownerType === "PROPERTY") {
    const pr = setProp(ownerId); if (!pr) return ctx;
    ctx.canRead = canProp_(p, pr, "document.view") || canProp_(p, pr, "property.edit") || (category === "PHOTO" && !!propertyAccess_(p, pr));
    ctx.canWrite = canProp_(p, pr, "property.edit");
  } else if (ownerType === "RESERVATION" || ownerType === "CHECKIN") {
    const r = dbGet_("Reservations", ownerId); if (!r) return ctx; setProp(r.propertyId);
    ctx.canRead = canResv_(p, r, "reservation.view") || canResv_(p, r, "checkin.operate");
    ctx.canWrite = canResv_(p, r, "reservation.edit") || canResv_(p, r, "checkin.operate");
  } else if (ownerType === "GUEST") {
    const g = dbGet_("Guests", ownerId); if (!g) return ctx; const r = dbGet_("Reservations", g.reservationId); if (!r) return ctx; setProp(r.propertyId);
    ctx.sensitive = true;
    ctx.canRead = canResv_(p, r, "guestdoc.view");
    ctx.canWrite = canResv_(p, r, "reservation.edit") || canResv_(p, r, "guestdoc.view");
  } else if (ownerType === "CLEANING") {
    const m = dbGet_("CleaningMissions", ownerId); if (!m) return ctx; const pr = setProp(m.propertyId);
    const mine = String(m.providerUserId) === p.userId || normalizeEmail_(m.providerEmail) === p.email;
    ctx.canRead = mine || canProp_(p, pr, "cleaning.manage");
    ctx.canWrite = (mine && ["ACCEPTED", "IN_PROGRESS"].indexOf(m.status) >= 0) || canProp_(p, pr, "cleaning.manage");
  } else if (ownerType === "INCIDENT") {
    const i = dbGet_("IncidentsV4", ownerId); if (!i) return ctx; const pr = setProp(i.propertyId);
    const artIds = myArtisanIds_(p);
    const artisanLinked = artIds.length && (artIds.indexOf(String(i.contractorId)) >= 0 || dbAll_("WorkOrders").some(function (w) { return String(w.incidentId) === String(i.incidentId) && artIds.indexOf(String(w.artisanId)) >= 0; }));
    const reporter = normalizeEmail_(i.createdBy) === p.email;
    ctx.canRead = canProp_(p, pr, "incident.view") || reporter || !!artisanLinked;
    ctx.canWrite = canProp_(p, pr, "incident.manage") || (reporter && canProp_(p, pr, "incident.report")) || !!artisanLinked;
  } else if (ownerType === "WORKORDER" || ownerType === "QUOTE" || ownerType === "INVOICE") {
    const tbl = ownerType === "WORKORDER" ? "WorkOrders" : (ownerType === "QUOTE" ? "Quotes" : "Invoices");
    const row = dbGet_(tbl, ownerId); if (!row) return ctx; const pr = setProp(row.propertyId);
    const mine = myArtisanIds_(p).indexOf(String(row.artisanId)) >= 0;
    const mgrCap = ownerType === "INVOICE" ? "invoice.view" : "workorder.manage";
    ctx.canRead = mine || canProp_(p, pr, mgrCap) || canProp_(p, pr, "incident.view");
    ctx.canWrite = mine || canProp_(p, pr, ownerType === "INVOICE" ? "invoice.manage" : "workorder.manage");
  } else if (ownerType === "LEASE" || ownerType === "PAYMENT") {
    let leaseId = ownerId, propId = "";
    if (ownerType === "PAYMENT") { const pay = dbGet_("Payments", ownerId); if (!pay) return ctx; propId = pay.propertyId; leaseId = ""; }
    const l = leaseId ? dbGet_("Leases", leaseId) : null; if (l) propId = l.propertyId;
    const pr = setProp(propId); if (!pr) return ctx;
    const self = l && myTenantIds_(p).indexOf(String(l.tenantId)) >= 0;
    ctx.canRead = canProp_(p, pr, "lease.view") || canProp_(p, pr, "finance.view") || !!self;
    ctx.canWrite = canProp_(p, pr, "lease.manage") || canProp_(p, pr, "finance.manage") || (self && category === "PAYMENT_PROOF");
  } else if (ownerType === "TENANT") {
    const t = dbGet_("Tenants", ownerId); if (!t) return ctx; ctx.organizationId = t.organizationId; ctx.sensitive = true;
    ctx.canRead = hasOrgCap_(p, t.organizationId, "lease.manage") || myTenantIds_(p).indexOf(String(t.tenantId)) >= 0;
    ctx.canWrite = hasOrgCap_(p, t.organizationId, "lease.manage");
  } else if (ownerType === "CONTRACTOR") {
    const c = dbGet_("Artisans", ownerId); if (!c) return ctx; ctx.organizationId = c.organizationId;
    ctx.canRead = hasOrgCap_(p, c.organizationId, "contractor.manage") || myArtisanIds_(p).indexOf(String(c.artisanId)) >= 0;
    ctx.canWrite = ctx.canRead;
  } else if (ownerType === "REPORT") {
    ctx.canRead = ownerId === p.userId; ctx.canWrite = ownerId === p.userId; ctx.organizationId = "";
  }
  return ctx;
}

/** Décode, contrôle (taille, type déclaré ET signature binaire), stocke et enregistre un fichier. */
function storeFile_(ctx, ownerType, ownerId, category, input, uploaderEmail) {
  const mime = safeText_(input.mimeType, 100);
  assert_(MIME_SIGNATURES_[mime], "Type de fichier interdit (JPEG, PNG, WEBP ou PDF uniquement).");
  const data = String(input.base64 || "").replace(/^data:[^,]+,/, "");
  assert_(data.length > 0 && data.length <= Math.ceil(IMMO_CONFIG.MAX_UPLOAD_BYTES * 4 / 3) + 8, "Fichier vide ou trop volumineux (4 Mo maximum).");
  const bytes = Utilities.base64Decode(data);
  assert_(bytes.length > 0 && bytes.length <= IMMO_CONFIG.MAX_UPLOAD_BYTES, "Fichier trop volumineux (4 Mo maximum).");
  assert_(MIME_SIGNATURES_[mime](bytes), "Le contenu du fichier ne correspond pas au type annoncé.");
  const ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" }[mime];
  const cleanName = (safeText_(input.fileName || "fichier", 120).replace(/[^\w.\- ()À-ÿ]/g, "_").replace(/\.[a-z0-9]{2,5}$/i, "") || "fichier") + ext;
  const folder = ownerType === "REPORT" ? subFolder_(systemFolder_("Exports"), "user_" + ownerId) :
    (ctx.propertyId ? propertyFolder_(ctx.organizationId, ctx.propertyId, ownerType) : subFolder_(orgFolder_(ctx.organizationId || "platform"), "Documents_administratifs"));
  let file;
  try { file = folder.createFile(Utilities.newBlob(bytes, mime, cleanName)); file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); }
  catch (e) { throw new AppError("DRIVE", "Enregistrement Drive impossible (quota ou autorisation) : " + e.message); }
  const sensitive = ctx.sensitive || ["ID_DOCUMENT", "PASSPORT", "CIN"].indexOf(category) >= 0;
  const retDays = Number(getSetting_("retention.sensitiveDocDays", ctx.organizationId)) || 30;
  let retainUntil = "";
  if (sensitive && (ownerType === "GUEST" || ownerType === "RESERVATION")) {
    const r = ownerType === "GUEST" ? dbGet_("Reservations", (dbGet_("Guests", ownerId) || {}).reservationId) : dbGet_("Reservations", ownerId);
    retainUntil = addDaysStr_(r ? r.checkOut : todayStr_(), retDays);
  }
  return dbInsert_("Documents", { organizationId: ctx.organizationId || "", propertyId: ctx.propertyId || "", ownerType: ownerType, ownerId: ownerId, category: category,
    fileId: file.getId(), fileName: cleanName, mimeType: mime, sizeBytes: bytes.length, sha256: bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)),
    sensitive: sensitive, status: "ACTIVE", createdAt: nowIso_(), createdBy: uploaderEmail || "", retainUntil: retainUntil, purgedAt: "", legacy: false });
}

/* ------------------------- Routes ------------------------- */
function docUpload_(p, a) {
  const ownerType = String(a.ownerType || ""), category = safeText_(a.category || "GENERAL", 40).toUpperCase().replace(/[^A-Z_]/g, "");
  const ctx = docOwnerCtx_(p, ownerType, a.ownerId, category);
  if (!ctx.canWrite) forbid_("Dépôt de fichier non autorisé pour cet élément.");
  if (ctx.organizationId) assertOrgWritable_(ctx.organizationId);
  rateLimit_("upload:" + p.userId, 120, 3600);
  const d = storeFile_(ctx, ownerType, safeText_(a.ownerId, 120), category, a, p.email);
  audit_("DOCUMENT_UPLOADED", "Document", d.documentId, ctx.organizationId, { ownerType: ownerType, ownerId: a.ownerId, category: category, sensitive: d.sensitive, size: d.sizeBytes });
  return { ok: true, documentId: d.documentId, fileName: d.fileName };
}
function docList_(p, a) {
  const ctx = docOwnerCtx_(p, String(a.ownerType || ""), a.ownerId, a.category);
  if (!ctx.canRead) forbid_("Accès refusé aux documents de cet élément.");
  return dbAll_("Documents").filter(function (d) { return d.ownerType === a.ownerType && String(d.ownerId) === String(a.ownerId) && d.status === "ACTIVE" && (!a.category || d.category === a.category); })
    .map(function (d) { return { documentId: d.documentId, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, category: d.category, sensitive: d.sensitive, createdAt: d.createdAt, createdBy: d.createdBy }; });
}
function docAssertRead_(p, doc) {
  if (!doc || doc.status !== "ACTIVE") throw new AppError("FORBIDDEN", "Document introuvable ou accès refusé.");
  const ctx = docOwnerCtx_(p, doc.ownerType, doc.ownerId, doc.category);
  if (!ctx.canRead) { audit_("DOCUMENT_ACCESS_DENIED", "Document", doc.documentId, doc.organizationId, {}, "DENIED"); throw new AppError("FORBIDDEN", "Document introuvable ou accès refusé."); }
  return ctx;
}
/** Téléchargement contrôlé : le fichier est lu par le serveur et renvoyé en base64 (jamais d'URL Drive). */
function docGet_(p, a) {
  const doc = dbGet_("Documents", safeText_(a.documentId, 120));
  docAssertRead_(p, doc);
  if (doc.sensitive) rateLimit_("sensitive:" + p.userId, 60, 3600);
  const f = DriveApp.getFileById(doc.fileId);
  audit_("DOCUMENT_DOWNLOADED", "Document", doc.documentId, doc.organizationId, { sensitive: doc.sensitive, grant: CTX_.grantId || "" });
  return { fileName: doc.fileName, mimeType: doc.mimeType, base64: Utilities.base64Encode(f.getBlob().getBytes()) };
}
function docArchive_(p, a) {
  const doc = dbGet_("Documents", safeText_(a.documentId, 120));
  if (!doc || doc.status !== "ACTIVE") notFound_("Document");
  const ctx = docOwnerCtx_(p, doc.ownerType, doc.ownerId, doc.category);
  if (!ctx.canWrite) forbid_();
  dbUpdate_("Documents", doc.documentId, { status: "ARCHIVED" });
  audit_("DOCUMENT_ARCHIVED", "Document", doc.documentId, doc.organizationId, {});
  return { ok: true };
}
/** Contrôle d'appartenance d'une liste de documents à un élément (utilisé par check-in, ménage, incidents...). */
function assertDocsOf_(docIds, ownerType, ownerId) {
  (docIds || []).forEach(function (id) {
    const d = dbGet_("Documents", id);
    assert_(d && d.ownerType === ownerType && String(d.ownerId) === String(ownerId) && d.status === "ACTIVE", "Photo/document non rattaché à cet élément.");
  });
  return (docIds || []).slice(0, 50);
}

/* ------------------------- Génération PDF ------------------------- */
function htmlToPdf_(html, name) {
  const blob = Utilities.newBlob(String(html), "text/html", name + ".html").getAs("application/pdf");
  blob.setName(name + ".pdf");
  return blob;
}
/** Modèle Google Docs : copie, remplacement des balises {{cle}}, export PDF. La copie Docs est conservée dans le dossier cible. */
var GOOGLE_DOC_MIME_ = "application/vnd.google-apps.document";
/**
 * Un modèle doit être un Google Docs rangé dans le dossier privé « Modeles ».
 * Sans cette règle, un administrateur d'organisation pourrait indiquer l'identifiant de n'importe quel fichier
 * accessible au compte déployeur (par exemple le document d'un autre client) et en obtenir une copie.
 */
function assertTemplateAllowed_(templateId) {
  let file;
  try { file = DriveApp.getFileById(String(templateId)); } catch (e) { throw new AppError("VALIDATION", "Modèle introuvable : vérifiez l'identifiant du document Google Docs."); }
  assert_(file.getMimeType() === GOOGLE_DOC_MIME_, "Le modèle doit être un document Google Docs.");
  const modeles = systemFolder_("Modeles").getId();
  const parents = file.getParents();
  let inModeles = false;
  while (parents.hasNext()) { if (parents.next().getId() === modeles) { inModeles = true; break; } }
  assert_(inModeles, "Le modèle doit être placé dans le dossier « Modeles » du Drive privé d'ImmoPilot.");
  return file;
}
function docFromTemplate_(templateId, map, folder, name) {
  const copy = assertTemplateAllowed_(templateId).makeCopy(name, folder);
  copy.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  const doc = DocumentApp.openById(copy.getId()), body = doc.getBody();
  Object.keys(map).forEach(function (k) { body.replaceText("\\{\\{" + k.replace(/[^\w]/g, "") + "\\}\\}", String(map[k] == null ? "" : map[k]).replace(/\$/g, "\\$")); });
  doc.saveAndClose();
  const pdf = copy.getAs("application/pdf"); pdf.setName(name + ".pdf");
  return { pdf: pdf, docId: copy.getId() };
}
/** Enregistre un PDF généré et le renvoie au client (base64), avec traçabilité Documents. */
function storeGeneratedPdf_(p, pdfBlob, ctx, ownerType, ownerId, category) {
  const bytes = pdfBlob.getBytes();
  const d = storeFile_(ctx, ownerType, ownerId, category, { mimeType: "application/pdf", fileName: pdfBlob.getName(), base64: Utilities.base64Encode(bytes) }, p.email);
  return { documentId: d.documentId, fileName: d.fileName, mimeType: "application/pdf", base64: Utilities.base64Encode(bytes) };
}
/** Logo ImmoPilot (PNG 96 × 96) intégré aux documents PDF. */
var PDF_LOGO_PNG_B64_ = "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";
/**
 * Gabarit commun des PDF : en-tête avec logo et nom de l'application, titre, sous-titre facultatif (organisation),
 * date de génération et pied de page. opts : { subtitle, footer, issuer: { name, lines[] } } — issuer remplace la marque ImmoPilot.
 */
function pdfShell_(title, inner, opts) {
  opts = opts || {};
  const when = Utilities.formatDate(new Date(), tz_(), "dd/MM/yyyy HH:mm");
  return "<html><head><meta charset='utf-8'><style>body{font-family:Arial,sans-serif;color:#1d2b3a;font-size:11px}h1{font-size:18px;color:#1b3554;margin:0 0 2px}" +
    "h2{font-size:13px;color:#1b3554;margin:16px 0 6px;border-bottom:2px solid #e9b341;padding-bottom:2px}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #c9d3df;padding:4px 6px;text-align:left;vertical-align:top}" +
    "th{background:#e8eef5}.muted{color:#64748b}.right{text-align:right}.head td{border:0;padding:0}.brand{font-size:20px;font-weight:bold;color:#13233d}.gold{color:#c9962b}" +
    ".photos td{border:0;padding:3px;width:50%}.photos img{width:100%;border:1px solid #c9d3df}.sign td{height:70px;width:50%}.box{border:1px solid #c9d3df;padding:8px;margin:8px 0;background:#f8fafc}" +
    ".foot{margin-top:24px;border-top:1px solid #c9d3df;padding-top:6px;color:#64748b;font-size:9px}</style></head><body>" +
    (opts.issuer
      // Document émis par un tiers (devis, facture d'un prestataire) : son identité en en-tête, sans la marque ImmoPilot.
      ? "<table class='head'><tr><td><div class='brand'>" + escapeHtml_(opts.issuer.name) + "</div><div class='muted'>" + (opts.issuer.lines || []).filter(String).map(escapeHtml_).join("<br>") + "</div></td>"
      : "<table class='head'><tr><td style='width:62px'><img src='data:image/png;base64," + PDF_LOGO_PNG_B64_ + "' width='54' height='54'></td>" +
        "<td><div class='brand'>Immo<span class='gold'>Pilot</span></div><div class='muted'>Gestion immobilière</div></td>") +
    "<td class='right muted'>Généré le " + escapeHtml_(when) + "</td></tr></table><hr style='border:0;border-top:3px solid #13233d;margin:8px 0 12px'>" +
    "<h1>" + escapeHtml_(title) + "</h1>" + (opts.subtitle ? "<p class='muted' style='margin:0 0 10px'>" + escapeHtml_(opts.subtitle) + "</p>" : "") + inner +
    "<div class='foot'>" + escapeHtml_(opts.footer || (IMMO_CONFIG.APP_NAME + " — document généré automatiquement à partir des données enregistrées dans l'application.")) + "</div></body></html>";
}
/** Date AAAA-MM-JJ (ou horodatage) au format JJ/MM/AAAA. */
function pdfDate_(s) { const v = String(s || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4) : (v || "—"); }
var PDF_PAY_METHODS_ = { TRANSFER: "Virement", CASH: "Espèces", CARD: "Carte", CHEQUE: "Chèque", PLATFORM: "Plateforme de réservation", OTHER: "Autre" };
/** Image d'un document (photo) au format data: pour un PDF. Les fichiers de plus de 1,5 Mo ne sont pas intégrés (le PDF resterait trop lourd). */
function pdfImageData_(documentId) {
  const d = dbGet_("Documents", documentId);
  if (!d || d.status !== "ACTIVE" || ["image/jpeg", "image/png", "image/webp"].indexOf(d.mimeType) < 0) return "";
  if (num_(d.sizeBytes) > 1.5 * 1048576) return "";
  try { return "data:" + d.mimeType + ";base64," + Utilities.base64Encode(DriveApp.getFileById(d.fileId).getBlob().getBytes()); } catch (e) { return ""; }
}
function htmlTable_(headers, rows) {
  return "<table><thead><tr>" + headers.map(function (h) { return "<th>" + escapeHtml_(h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
    rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td" + (typeof c === "number" ? " class='right'" : "") + ">" + escapeHtml_(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table>";
}

/** Rétention : purge (corbeille Drive) des documents sensibles échus et minimisation des fiches voyageurs. */
function purgeExpiredDocuments_() {
  const today = todayStr_(); let n = 0;
  dbAll_("Documents").filter(function (d) { return d.status === "ACTIVE" && d.sensitive && d.retainUntil && d.retainUntil < today; }).slice(0, 200).forEach(function (d) {
    try { DriveApp.getFileById(d.fileId).setTrashed(true); } catch (e) { console.error("Purge " + d.documentId + " : " + e.message); }
    dbUpdate_("Documents", d.documentId, { status: "PURGED", purgedAt: nowIso_() });
    auditAs_("system", "", "DOCUMENT_PURGED_RETENTION", "Document", d.documentId, d.organizationId, {}); n++;
  });
  let g = 0;
  dbAll_("Guests").filter(function (x) { return x.status === "ACTIVE" && (x.idType || x.idRefMasked || x.nationality); }).forEach(function (x) {
    const r = dbGet_("Reservations", x.reservationId);
    const days = Number(getSetting_("retention.sensitiveDocDays", x.organizationId)) || 30;
    if (r && addDaysStr_(r.checkOut, days) < today) { dbUpdate_("Guests", x.guestId, { idType: "", idRefMasked: "", nationality: "", status: "PURGED", purgedAt: nowIso_() }); g++; }
  });
  return { documentsPurged: n, guestsMinimized: g };
}
