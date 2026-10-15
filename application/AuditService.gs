/** Journal d'audit (feuille ActivityLogs). Les données sensibles sont masquées avant écriture. */
var AUDIT_REDACT_ = /(password|passwd|token|secret|idnumber|idref|passport|cin|base64|hash|salt)/i;

function auditRedact_(v, depth) {
  depth = depth || 0;
  if (v == null || depth > 4) return v;
  if (Array.isArray(v)) return v.slice(0, 30).map(function (x) { return auditRedact_(x, depth + 1); });
  if (typeof v === "object") { const o = {}; Object.keys(v).forEach(function (k) { o[k] = AUDIT_REDACT_.test(k) ? "[masqué]" : auditRedact_(v[k], depth + 1); }); return o; }
  if (typeof v === "string" && v.length > 300) return v.slice(0, 300) + "…";
  return v;
}
/** Journalise une action. N'interrompt jamais l'opération métier si l'écriture échoue. */
function audit_(action, entityType, entityId, organizationId, details, result) {
  try {
    const p = (typeof CTX_ !== "undefined" && CTX_ && CTX_.principal) || null;
    // Dans l'espace d'un client, l'auteur réel (le super administrateur) est enregistré, avec le compte concerné.
    const imp = p && p.impersonator;
    if (imp) details = Object.assign({}, details || {}, { asUser: p.email });
    dbInsert_("ActivityLogs", { timestamp: nowIso_(), actorEmail: imp ? imp.email : (p ? p.email : ""), actorUserId: imp ? imp.userId : (p ? p.userId : ""), organizationId: String(organizationId || ""),
      action: safeText_(action, 100), entityType: safeText_(entityType || "", 80), entityId: safeText_(entityId || "", 120),
      detailsJson: jsonSafe_(auditRedact_(details || {})), result: result || "OK" });
  } catch (err) { console.error("Audit échoué : " + err.message); }
}
function auditAs_(email, userId, action, entityType, entityId, orgId, details, result) {
  try { dbInsert_("ActivityLogs", { timestamp: nowIso_(), actorEmail: email || "", actorUserId: userId || "", organizationId: String(orgId || ""), action: action,
    entityType: entityType || "", entityId: entityId || "", detailsJson: jsonSafe_(auditRedact_(details || {})), result: result || "OK" }); } catch (e) { console.error(e.message); }
}
/** Historique d'une entité (autorisé si l'appelant peut lire l'entité : à vérifier par l'appelant). */
function auditHistory_(entityType, entityId, limit) {
  return dbAll_("ActivityLogs").filter(function (l) { return l.entityType === entityType && String(l.entityId) === String(entityId); })
    .sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); }).slice(0, limit || 50)
    .map(function (l) { return { timestamp: l.timestamp, actorEmail: l.actorEmail, action: l.action, details: parseJson_(l.detailsJson, {}) }; });
}
/** Différences entre deux objets (champs modifiés uniquement). */
function diff_(before, after, fields) {
  const d = {};
  fields.forEach(function (f) { if (after[f] !== undefined && String(before[f] == null ? "" : before[f]) !== String(after[f] == null ? "" : after[f])) d[f] = { from: before[f] == null ? "" : before[f], to: after[f] }; });
  return d;
}
