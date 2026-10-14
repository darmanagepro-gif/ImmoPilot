/**
 * Incidents et réclamations (feuille IncidentsV4 ; la feuille historique « Incidents » reste intacte et a été copiée par migration).
 * Workflow : OPEN → QUALIFIED → ASSIGNED → QUOTE_PENDING → AWAITING_OWNER → APPROVED → IN_PROGRESS → RESOLVED → CLOSED.
 * Les étapes devis/validation sont pilotées par QuoteService (WorkOrderService.gs) ; les coûts finaux viennent des factures approuvées.
 */
var INC_TRANSITIONS_ = {
  OPEN: ["QUALIFIED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CANCELLED"],
  QUALIFIED: ["ASSIGNED", "QUOTE_PENDING", "IN_PROGRESS", "RESOLVED", "CANCELLED"],
  ASSIGNED: ["QUOTE_PENDING", "IN_PROGRESS", "RESOLVED", "CANCELLED"],
  QUOTE_PENDING: ["CANCELLED"], AWAITING_OWNER: ["CANCELLED"], APPROVED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["RESOLVED"], RESOLVED: ["CLOSED", "IN_PROGRESS"], CLOSED: [], CANCELLED: []
};
var SEVERITIES_ = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/** Insertion interne (utilisée par check-in/out, ménage, portail voyageur). Le contrôle d'accès est fait par l'appelant. */
function incidentInsert_(p, prop, d) {
  const cat = oneOf_(d.category || "OTHER", getSetting_("list.incidentCategories", prop.organizationId), "Catégorie");
  const sev = oneOf_(d.severity || "MEDIUM", SEVERITIES_, "Gravité");
  const prioMap = { LOW: "LOW", MEDIUM: "NORMAL", HIGH: "HIGH", CRITICAL: "URGENT" };
  const i = dbInsert_("IncidentsV4", { organizationId: prop.organizationId, propertyId: prop.propertyId, reservationId: safeText_(d.reservationId || "", 120), missionId: safeText_(d.missionId || "", 120),
    category: cat, priority: prioMap[sev], severity: sev, title: safeText_(d.title || cat, 120), description: reqText_(d.description, "Description", 3, 3000), status: "OPEN",
    photoFileIdsJson: "[]", reportedByUserId: p ? p.userId : "", createdAt: nowIso_(), createdBy: p ? p.email : "system", updatedAt: nowIso_(), updatedBy: p ? p.email : "system", source: safeText_(d.source || "MANUAL", 20),
    estimatedCost: d.estimatedCost ? money_(d.estimatedCost, "Coût estimé") : "" });
  (d.photoDocIds || []).forEach(function (docId) {
    const doc = dbGet_("Documents", docId);
    if (doc && doc.status === "ACTIVE" && String(doc.propertyId) === String(prop.propertyId) && doc.createdBy === (p ? p.email : "")) dbUpdate_("Documents", docId, { ownerType: "INCIDENT", ownerId: i.incidentId });
  });
  if (p) audit_("INCIDENT_CREATED", "Incident", i.incidentId, prop.organizationId, { category: cat, severity: sev, source: d.source || "MANUAL" });
  const urgent = sev === "HIGH" || sev === "CRITICAL";
  notify_({ eventKey: "incident-new:" + i.incidentId, userIds: propertyManagers_(prop, "canManageOperations").filter(function (u) { return !p || u !== p.userId; }), type: urgent ? "INCIDENT_SEVERE" : "INCIDENT",
    organizationId: prop.organizationId, title: (urgent ? "Incident grave : " : "Nouvel incident : ") + prop.name, body: cat + " — " + i.description.slice(0, 200), link: "#incident/" + i.incidentId, email: urgent });
  return i;
}

function incAccess_(p, i) {
  const prop = dbGet_("Properties", i.propertyId);
  const artIds = myArtisanIds_(p);
  const artisan = artIds.length > 0 && (artIds.indexOf(String(i.contractorId)) >= 0 || dbAll_("WorkOrders").some(function (w) { return String(w.incidentId) === String(i.incidentId) && artIds.indexOf(String(w.artisanId)) >= 0; }) ||
    dbAll_("Quotes").some(function (q) { return String(q.incidentId) === String(i.incidentId) && artIds.indexOf(String(q.artisanId)) >= 0; }));
  return { prop: prop, view: canProp_(p, prop, "incident.view"), manage: canProp_(p, prop, "incident.manage"), reporter: normalizeEmail_(i.createdBy) === p.email, artisan: artisan,
    decide: canProp_(p, prop, "quote.decide") };
}
function incLoad_(p, id, need) {
  const i = dbGet_("IncidentsV4", safeText_(id, 120));
  if (!i) throw new AppError("FORBIDDEN", "Incident introuvable ou accès refusé.");
  const acc = incAccess_(p, i);
  const ok = need === "manage" ? acc.manage : (acc.view || acc.reporter || acc.artisan);
  if (!ok) throw new AppError("FORBIDDEN", "Incident introuvable ou accès refusé.");
  if (need === "manage") assertOrgWritable_(i.organizationId);
  return { i: i, acc: acc };
}
function incOut_(p, i, props) {
  const prop = (props || {})[String(i.propertyId)] || dbGet_("Properties", i.propertyId) || {};
  const ageDays = Math.max(0, Math.floor((Date.now() - (parseTs_(i.createdAt) || new Date()).getTime()) / 86400000));
  return { incidentId: i.incidentId, propertyId: i.propertyId, propertyName: prop.name, reservationId: i.reservationId, missionId: i.missionId, title: i.title || i.category, category: i.category,
    severity: i.severity || "MEDIUM", priority: i.priority, status: i.status, description: i.description, createdAt: i.createdAt, createdBy: i.createdBy, assignedToUserId: i.assignedToUserId,
    contractorId: i.contractorId, estimatedCost: i.estimatedCost, finalCost: i.finalCost, resolvedAt: i.resolvedAt, closedAt: i.closedAt, source: i.source, ageDays: ageDays, legacyOrigin: i.legacyOrigin };
}

/* ------------------------------ Routes ------------------------------ */
function incList_(p, a) {
  a = a || {};
  const props = indexBy_(dbAll_("Properties"), "propertyId");
  const artIds = myArtisanIds_(p);
  const rows = dbAll_("IncidentsV4").filter(function (i) {
    const prop = props[String(i.propertyId)];
    const ok = canProp_(p, prop, "incident.view") || normalizeEmail_(i.createdBy) === p.email || (artIds.length && artIds.indexOf(String(i.contractorId)) >= 0);
    if (!ok) return false;
    if (a.propertyId && String(i.propertyId) !== String(a.propertyId)) return false;
    if (a.status) { if (String(a.status).split(",").indexOf(i.status) < 0) return false; } else if (a.openOnly && ["CLOSED", "CANCELLED"].indexOf(i.status) >= 0) return false;
    if (a.category && i.category !== a.category) return false;
    if (a.severity && i.severity !== a.severity) return false;
    const d = String(i.createdAt).slice(0, 10);
    if (a.from && d < a.from) return false; if (a.to && d > a.to) return false;
    return matchesQuery_(a.q, [i.title, i.description, i.category, (prop || {}).name, i.incidentId]);
  }).sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); });
  const page = pageOf_(rows, a);
  page.items = page.items.map(function (i) { return incOut_(p, i, props); });
  return page;
}
function incGet_(p, a) {
  const x = incLoad_(p, a.incidentId, "read"), i = x.i, acc = x.acc;
  const o = incOut_(p, i);
  o.canManage = acc.manage; o.canDecide = acc.decide;
  o.comments = dbAll_("IncidentComments").filter(function (c) { return String(c.incidentId) === String(i.incidentId) && (acc.manage || acc.view || c.visibility !== "INTERNAL"); })
    .sort(function (u, v) { return String(u.createdAt).localeCompare(String(v.createdAt)); }).map(function (c) { return { commentId: c.commentId, authorEmail: c.authorEmail, body: c.body, createdAt: c.createdAt, visibility: c.visibility }; });
  o.documents = docList_(p, { ownerType: "INCIDENT", ownerId: i.incidentId });
  const artIds = myArtisanIds_(p);
  const mineOnly = !acc.view && !acc.manage;
  o.quotes = dbAll_("Quotes").filter(function (q) { return String(q.incidentId) === String(i.incidentId) && (!mineOnly || artIds.indexOf(String(q.artisanId)) >= 0); }).map(quoteOut_);
  o.workOrders = dbAll_("WorkOrders").filter(function (w) { return String(w.incidentId) === String(i.incidentId) && (!mineOnly || artIds.indexOf(String(w.artisanId)) >= 0); }).map(woOut_);
  if (canProp_(p, acc.prop, "invoice.view") || mineOnly) o.invoices = dbAll_("Invoices").filter(function (v) { return String(v.incidentId) === String(i.incidentId) && (!mineOnly || artIds.indexOf(String(v.artisanId)) >= 0); }).map(invoiceOut_);
  if (acc.manage || acc.view) o.history = auditHistory_("Incident", i.incidentId, 40);
  o.allowedTransitions = acc.manage ? (INC_TRANSITIONS_[i.status] || []) : [];
  return o;
}
function incCreate_(p, a) {
  const prop = assertPropAny_(p, a.propertyId, ["incident.report", "incident.manage"]);
  assertOrgWritable_(prop.organizationId);
  if (a.reservationId) { const r = dbGet_("Reservations", a.reservationId); assert_(r && String(r.propertyId) === String(prop.propertyId), "Réservation d'un autre bien."); }
  const docs = Array.isArray(a.photoDocIds) ? a.photoDocIds.slice(0, 20) : [];
  const i = withLock_(function () { return incidentInsert_(p, prop, { category: a.category, severity: a.severity, title: a.title, description: a.description, reservationId: a.reservationId, estimatedCost: a.estimatedCost, source: "MANUAL", photoDocIds: docs }); });
  return { ok: true, incidentId: i.incidentId, id: i.incidentId };
}
function incUpdate_(p, a) {
  const x = incLoad_(p, a.incidentId, "manage"), i = x.i;
  const patch = { updatedAt: nowIso_(), updatedBy: p.email };
  if (a.category !== undefined) patch.category = oneOf_(a.category, getSetting_("list.incidentCategories", i.organizationId), "Catégorie");
  if (a.severity !== undefined) patch.severity = oneOf_(a.severity, SEVERITIES_, "Gravité");
  if (a.title !== undefined) patch.title = reqText_(a.title, "Titre", 2, 120);
  if (a.estimatedCost !== undefined) patch.estimatedCost = a.estimatedCost === "" ? "" : money_(a.estimatedCost, "Coût estimé");
  if (a.finalCost !== undefined && a.finalCost !== "") patch.finalCost = money_(a.finalCost, "Coût final");
  if (a.assignedToEmail !== undefined) {
    if (!a.assignedToEmail) patch.assignedToUserId = "";
    else { const u = dbAll_("Users").find(function (z) { return normalizeEmail_(z.email) === normalizeEmail_(a.assignedToEmail) && z.status === "ACTIVE"; });
      assert_(u && propertyManagers_(x.acc.prop).indexOf(String(u.userId)) >= 0, "Le responsable doit être un gestionnaire du bien."); patch.assignedToUserId = u.userId; }
  }
  if (a.contractorId !== undefined) {
    if (a.contractorId) { const c = dbGet_("Artisans", a.contractorId); assert_(c && c.status === "ACTIVE" && contractorUsableFor_(p, c, x.acc.prop), "Prestataire non autorisé pour ce bien."); }
    patch.contractorId = safeText_(a.contractorId, 120);
  }
  if (a.status !== undefined && a.status !== i.status) {
    assert_((INC_TRANSITIONS_[i.status] || []).indexOf(a.status) >= 0, "Transition " + i.status + " → " + a.status + " non autorisée.");
    if (a.status === "CLOSED") {
      const wos = dbAll_("WorkOrders").filter(function (w) { return String(w.incidentId) === String(i.incidentId) && w.status !== "CANCELLED" && w.status !== "DECLINED"; });
      assert_(wos.every(function (w) { return w.status === "VERIFIED"; }), "Clôture impossible : des interventions ne sont pas contrôlées.");
      patch.closedAt = nowIso_();
      const inv = dbAll_("Invoices").filter(function (v) { return String(v.incidentId) === String(i.incidentId) && ["APPROVED", "PARTIAL", "PAID"].indexOf(v.status) >= 0; });
      if (inv.length && (a.finalCost === undefined || a.finalCost === "")) patch.finalCost = sumBy_(inv, function (v) { return v.amountTTC; });
    }
    if (a.status === "RESOLVED") patch.resolvedAt = nowIso_();
    patch.status = a.status;
  }
  dbUpdate_("IncidentsV4", i.incidentId, patch);
  audit_("INCIDENT_UPDATED", "Incident", i.incidentId, i.organizationId, diff_(i, patch, Object.keys(patch).filter(function (k) { return ["updatedAt", "updatedBy"].indexOf(k) < 0; })));
  if (patch.severity && ["HIGH", "CRITICAL"].indexOf(patch.severity) >= 0 && ["HIGH", "CRITICAL"].indexOf(i.severity) < 0)
    notify_({ eventKey: "incident-escalated:" + i.incidentId + ":" + patch.severity, userIds: propertyManagers_(x.acc.prop, "canManageOperations"), type: "INCIDENT_SEVERE", organizationId: i.organizationId,
      title: "Incident escaladé (" + patch.severity + ") : " + x.acc.prop.name, body: i.title || i.category, link: "#incident/" + i.incidentId });
  if (patch.assignedToUserId) notify_({ eventKey: "incident-assigned:" + i.incidentId + ":" + patch.assignedToUserId, userIds: [patch.assignedToUserId], type: "INCIDENT_ASSIGNED", organizationId: i.organizationId,
    title: "Incident qui vous est confié : " + x.acc.prop.name, body: i.title || i.category, link: "#incident/" + i.incidentId });
  return { ok: true };
}
function incComment_(p, a) {
  const x = incLoad_(p, a.incidentId, "read");
  const visibility = x.acc.manage || x.acc.view ? oneOf_(a.visibility || "SHARED", ["SHARED", "INTERNAL"], "Visibilité") : "SHARED";
  const c = dbInsert_("IncidentComments", { organizationId: x.i.organizationId, incidentId: x.i.incidentId, authorEmail: p.email, body: reqText_(a.body, "Commentaire", 1, 2000), createdAt: nowIso_(), visibility: visibility });
  audit_("INCIDENT_COMMENTED", "Incident", x.i.incidentId, x.i.organizationId, { visibility: visibility });
  return { ok: true, commentId: c.commentId };
}

/** Tâche planifiée : alertes d'ancienneté et de coût (une seule fois par incident et par seuil). */
function incidentAlertsJob_() {
  let n = 0;
  dbAll_("IncidentsV4").filter(function (i) { return ["CLOSED", "CANCELLED", "RESOLVED"].indexOf(i.status) < 0; }).forEach(function (i) {
    const prop = dbGet_("Properties", i.propertyId); if (!prop) return;
    const days = Number(getSetting_("alerts.incidentAgeDays", i.organizationId)) || 3, cost = Number(getSetting_("alerts.incidentCost", i.organizationId)) || 5000;
    const age = (Date.now() - (parseTs_(i.createdAt) || new Date()).getTime()) / 86400000;
    if (age >= days) { notify_({ eventKey: "incident-age:" + i.incidentId + ":" + days, userIds: propertyManagers_(prop, "canManageOperations"), type: "INCIDENT_AGE", organizationId: i.organizationId,
      title: "Incident ouvert depuis " + Math.floor(age) + " jours : " + prop.name, body: (i.title || i.category) + " — statut " + i.status, link: "#incident/" + i.incidentId }); n++; }
    const c = Math.max(num_(i.estimatedCost), num_(i.finalCost));
    if (c >= cost) { notify_({ eventKey: "incident-cost:" + i.incidentId + ":" + cost, userIds: propertyManagers_(prop), type: "INCIDENT_COST", organizationId: i.organizationId,
      title: "Incident coûteux (" + c + " MAD) : " + prop.name, body: i.title || i.category, link: "#incident/" + i.incidentId }); n++; }
  });
  return { alerts: n };
}
