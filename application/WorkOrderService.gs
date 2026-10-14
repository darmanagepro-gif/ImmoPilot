/**
 * Devis et ordres de travail (interventions).
 * Devis : REQUESTED (demandé) → PENDING (reçu, à valider) → APPROVED / REJECTED ; DECLINED si l'artisan refuse de chiffrer ; EXPIRED après validité.
 * Validation : le PROPRIÉTAIRE (capacité quote.decide). Une agence ne peut approuver que sous le plafond quote.agencyApprovalLimit
 * fixé par le propriétaire (0 par défaut = jamais).
 * Intervention : ASSIGNED → ACCEPTED → SCHEDULED → IN_PROGRESS → COMPLETED → VERIFIED (contrôle) ; DECLINED / CANCELLED.
 * Le taux de commission est figé sur l'ordre de travail à sa création (priorité : saisie > fiche prestataire > paramètre organisation, 15 % par défaut).
 */
function quoteOut_(q) {
  return { quoteId: q.quoteId, incidentId: q.incidentId, propertyId: q.propertyId, artisanId: q.artisanId, artisanName: ((dbGet_("Artisans", q.artisanId) || {}).name) || "", status: q.status,
    currency: q.currency || "MAD", amountHT: q.amountHT, vatRate: q.vatRate, amountTTC: q.amountTTC !== null && q.amountTTC !== "" ? q.amountTTC : q.totalAmount, validUntil: q.validUntil,
    estimatedDays: q.estimatedDays, lines: parseJson_(q.linesJson, []), requestNote: q.requestNote, requestedAt: q.requestedAt, submittedAt: q.submittedAt, decisionAt: q.decisionAt,
    decisionBy: q.decisionBy, decisionNote: q.decisionNote, commissionRateEst: q.commissionRateEst, commissionEstimate: q.commissionEstimate };
}
function woOut_(w) {
  return { workOrderId: w.workOrderId, incidentId: w.incidentId, propertyId: w.propertyId, propertyName: ((dbGet_("Properties", w.propertyId) || {}).name) || "", quoteId: w.quoteId, artisanId: w.artisanId,
    artisanName: ((dbGet_("Artisans", w.artisanId) || {}).name) || "", status: w.status, title: w.title, description: w.description, desiredDate: w.desiredDate, scheduledAt: w.scheduledAt,
    acceptedAt: w.acceptedAt, startedAt: w.startedAt, completedAt: w.completedAt, verifiedAt: w.verifiedAt, report: w.report, commissionRate: w.commissionRate, createdAt: w.createdAt,
    invoiceId: w.invoiceId, legacyInvoiceFileId: w.invoiceFileId, declineReason: w.declineReason };
}
function resolveCommissionRate_(override, artisan, orgId) {
  if (override !== undefined && override !== null && override !== "") return rate_(override, "Commission");
  if (artisan && artisan.commissionRate !== null && artisan.commissionRate !== "") return Number(artisan.commissionRate);
  const s = Number(getSetting_("commission.contractorRate", orgId));
  return isFinite(s) ? s : 15;
}
function quoteLines_(lines) {
  assert_(Array.isArray(lines) && lines.length >= 1 && lines.length <= 100, "Le devis doit comporter de 1 à 100 lignes.");
  let total = 0;
  const out = lines.map(function (l) {
    const desc = reqText_(l.description, "Libellé de ligne", 1, 250), qty = Number(l.quantity), unit = Number(l.unitPrice);
    assert_(isFinite(qty) && qty > 0 && qty <= 100000 && isFinite(unit) && unit >= 0 && unit <= 1e7, "Ligne de devis invalide : " + desc);
    const amount = round2_(qty * unit); total += amount;
    return { description: desc, quantity: qty, unitPrice: round2_(unit), amount: amount };
  });
  return { lines: out, totalHT: round2_(total) };
}
function quoteLoad_(p, id) {
  const q = dbGet_("Quotes", safeText_(id, 120));
  if (!q) throw new AppError("FORBIDDEN", "Devis introuvable ou accès refusé.");
  const prop = dbGet_("Properties", q.propertyId);
  const mgr = canProp_(p, prop, "workorder.manage"), dec = canProp_(p, prop, "quote.decide"), mine = myArtisanIds_(p).indexOf(String(q.artisanId)) >= 0;
  if (!mgr && !dec && !mine && !canProp_(p, prop, "incident.view")) throw new AppError("FORBIDDEN", "Devis introuvable ou accès refusé.");
  return { q: q, prop: prop, mgr: mgr, dec: dec, mine: mine };
}
function decisionMakers_(prop, amountTTC) {
  const owners = dbAll_("UserRoles").filter(function (r) { return r.status === "ACTIVE" && r.role === "OWNER" && String(r.organizationId) === String(prop.organizationId); }).map(function (r) { return r.userId; });
  const limit = Number(getSetting_("quote.agencyApprovalLimit", prop.organizationId)) || 0;
  return amountTTC <= limit ? owners.concat(propertyManagers_(prop, "canManageOperations")) : owners;
}

/* ------------------------------ Devis ------------------------------ */
function quoteRequest_(p, a) {
  const i = dbGet_("IncidentsV4", safeText_(a.incidentId, 120));
  if (!i) notFound_("Incident");
  const prop = assertProp_(p, i.propertyId, "workorder.manage");
  const c = dbGet_("Artisans", safeText_(a.artisanId, 120));
  assert_(contractorUsableFor_(p, c, prop), "Prestataire non autorisé pour ce bien.");
  assert_(["CLOSED", "CANCELLED", "RESOLVED"].indexOf(i.status) < 0, "Incident clos.");
  return withLock_(function () {
    const q = dbInsert_("Quotes", { organizationId: prop.organizationId, propertyId: prop.propertyId, incidentId: i.incidentId, artisanId: c.artisanId, status: "REQUESTED", currency: prop.currency || "MAD",
      totalAmount: "", validUntil: "", linesJson: "[]", decisionAt: "", decisionBy: "", decisionNote: "", createdAt: nowIso_(), createdBy: p.email, requestNote: safeText_(a.requestNote, 1000), requestedAt: nowIso_(), requestedBy: p.email });
    if (["OPEN", "QUALIFIED", "ASSIGNED"].indexOf(i.status) >= 0) dbUpdate_("IncidentsV4", i.incidentId, { status: "QUOTE_PENDING", contractorId: c.artisanId, updatedAt: nowIso_(), updatedBy: p.email });
    audit_("QUOTE_REQUESTED", "Quote", q.quoteId, prop.organizationId, { incidentId: i.incidentId, artisanId: c.artisanId });
    if (c.userId) notify_({ eventKey: "quote-request:" + q.quoteId, userIds: [c.userId], type: "QUOTE_REQUEST", organizationId: prop.organizationId, title: "Demande de devis : " + prop.name,
      body: (i.title || i.category) + (q.requestNote ? " — " + q.requestNote : ""), link: "#quotes" });
    return { ok: true, quoteId: q.quoteId, id: q.quoteId, whatsapp: !c.userId && c.phone ? waLink_(c.phone, "Bonjour " + c.name + ", pouvez-vous nous transmettre un devis pour : " + (i.title || i.category) + " (" + prop.name + ", " + prop.city + ") ?") : "" };
  });
}
/** Transmission du devis chiffré (par l'artisan lui-même, ou saisi par le gestionnaire pour un artisan sans compte). */
function quoteSubmit_(p, a) {
  const x = quoteLoad_(p, a.quoteId);
  assert_(x.mine || x.mgr, "Accès refusé.", "FORBIDDEN");
  assertOrgWritable_(x.q.organizationId);
  const L = quoteLines_(a.lines);
  const vat = a.vatRate === undefined || a.vatRate === "" ? Number(getSetting_("finance.vatRate", x.q.organizationId)) : rate_(a.vatRate, "TVA");
  const validUntil = a.validUntil ? dateOnly_(a.validUntil, "Validité") : addDaysStr_(todayStr_(), 30);
  assert_(validUntil >= todayStr_(), "Date de validité dépassée.");
  return withLock_(function () {
    const q = dbGet_("Quotes", x.q.quoteId);
    assert_(q.status === "REQUESTED", "Ce devis n'est plus modifiable (statut " + q.status + ").");
    const ttc = round2_(L.totalHT * (1 + vat / 100));
    const art = dbGet_("Artisans", q.artisanId), rate = resolveCommissionRate_(undefined, art, q.organizationId);
    dbUpdate_("Quotes", q.quoteId, { status: "PENDING", linesJson: L.lines, amountHT: L.totalHT, vatRate: vat, amountTTC: ttc, totalAmount: ttc, validUntil: validUntil,
      estimatedDays: a.estimatedDays ? Math.max(0, Math.round(Number(a.estimatedDays))) : "", submittedAt: nowIso_(), commissionRateEst: rate, commissionEstimate: round2_(L.totalHT * rate / 100) });
    const inc = dbGet_("IncidentsV4", q.incidentId);
    if (inc && ["QUOTE_PENDING", "OPEN", "QUALIFIED", "ASSIGNED"].indexOf(inc.status) >= 0) dbUpdate_("IncidentsV4", inc.incidentId, { status: "AWAITING_OWNER", estimatedCost: ttc, updatedAt: nowIso_(), updatedBy: p.email });
    audit_("QUOTE_SUBMITTED", "Quote", q.quoteId, q.organizationId, { amountHT: L.totalHT, amountTTC: ttc, byArtisan: x.mine });
    notify_({ eventKey: "quote-pending:" + q.quoteId, userIds: decisionMakers_(x.prop, ttc), type: "QUOTE_TO_VALIDATE", organizationId: q.organizationId,
      title: "Devis à valider : " + x.prop.name, body: ttc + " " + (q.currency || "MAD") + " TTC — " + ((art || {}).name || ""), link: "#incident/" + q.incidentId });
    return { ok: true, amountHT: L.totalHT, amountTTC: ttc };
  });
}
/** Création directe d'un devis reçu (compatibilité avec l'ancien p4CreateQuote). */
function quoteCreate_(p, a) {
  const r = quoteRequest_(p, a);
  quoteSubmit_(p, { quoteId: r.quoteId, lines: a.lines, vatRate: a.vatRate, validUntil: a.validUntil, estimatedDays: a.estimatedDays });
  return { ok: true, quoteId: r.quoteId, id: r.quoteId };
}
function quoteDeclineRequest_(p, a) {
  const x = quoteLoad_(p, a.quoteId);
  assert_(x.mine, "Accès refusé.", "FORBIDDEN");
  assert_(x.q.status === "REQUESTED", "Demande déjà traitée.");
  dbUpdate_("Quotes", x.q.quoteId, { status: "DECLINED", decisionNote: safeText_(a.reason, 500), decisionAt: nowIso_(), decisionBy: p.email });
  audit_("QUOTE_DECLINED_BY_ARTISAN", "Quote", x.q.quoteId, x.q.organizationId, {});
  notify_({ eventKey: "quote-declined:" + x.q.quoteId, userIds: propertyManagers_(x.prop, "canManageOperations"), type: "QUOTE_DECLINED", organizationId: x.q.organizationId,
    title: "Demande de devis refusée par l'artisan", body: x.prop.name + (a.reason ? " — " + a.reason : ""), link: "#incident/" + x.q.incidentId });
  return { ok: true };
}
function quoteDecide_(p, a) {
  const x = quoteLoad_(p, a.quoteId);
  assert_(x.dec, "Validation de devis non autorisée.", "FORBIDDEN");
  assertOrgWritable_(x.q.organizationId);
  const decision = oneOf_(a.decision, ["APPROVED", "REJECTED"], "Décision");
  const acc = propertyAccess_(p, x.prop);
  if (!acc.via.OWNER) {
    const limit = Number(getSetting_("quote.agencyApprovalLimit", x.prop.organizationId)) || 0;
    assert_(num_(x.q.amountTTC || x.q.totalAmount) <= limit, "Montant supérieur au plafond de validation délégué à l'agence (" + limit + " MAD) : validation du propriétaire requise.", "FORBIDDEN");
  }
  const note = safeText_(a.note, 1000);
  return withLock_(function () {
    const q = dbGet_("Quotes", x.q.quoteId);
    assert_(q.status === "PENDING", "Devis déjà traité ou non reçu (statut " + q.status + ").");
    if (decision === "APPROVED") assert_(!q.validUntil || q.validUntil >= todayStr_(), "Devis expiré.");
    dbUpdate_("Quotes", q.quoteId, { status: decision, decisionAt: nowIso_(), decisionBy: p.email, decisionNote: note });
    dbInsert_("QuoteDecisions", { organizationId: q.organizationId, quoteId: q.quoteId, decision: decision, note: note, decidedAt: nowIso_(), decidedBy: p.email });
    const inc = dbGet_("IncidentsV4", q.incidentId);
    if (decision === "APPROVED") {
      dbAll_("Quotes").filter(function (o) { return String(o.incidentId) === String(q.incidentId) && o.quoteId !== q.quoteId && ["PENDING", "REQUESTED"].indexOf(o.status) >= 0; })
        .forEach(function (o) { dbUpdate_("Quotes", o.quoteId, { status: "REJECTED", decisionAt: nowIso_(), decisionBy: p.email, decisionNote: "Autre devis retenu" }); });
      if (inc && ["AWAITING_OWNER", "QUOTE_PENDING"].indexOf(inc.status) >= 0) dbUpdate_("IncidentsV4", inc.incidentId, { status: "APPROVED", contractorId: q.artisanId, estimatedCost: q.amountTTC, updatedAt: nowIso_(), updatedBy: p.email });
    } else if (inc && inc.status === "AWAITING_OWNER" && !dbAll_("Quotes").some(function (o) { return String(o.incidentId) === String(q.incidentId) && o.status === "PENDING" && o.quoteId !== q.quoteId; }))
      dbUpdate_("IncidentsV4", inc.incidentId, { status: "QUOTE_PENDING", updatedAt: nowIso_(), updatedBy: p.email });
    audit_("QUOTE_" + decision, "Quote", q.quoteId, q.organizationId, { amountTTC: q.amountTTC });
    const art = dbGet_("Artisans", q.artisanId);
    notify_({ eventKey: "quote-decision:" + q.quoteId, userIds: (art && art.userId ? [art.userId] : []).concat(propertyManagers_(x.prop, "canManageOperations").filter(function (u) { return u !== p.userId; })),
      type: "QUOTE_DECISION", organizationId: q.organizationId, title: "Devis " + (decision === "APPROVED" ? "accepté" : "refusé") + " : " + x.prop.name, body: note, link: "#incident/" + q.incidentId });
    return { ok: true, status: decision };
  });
}
function quoteList_(p, a) {
  a = a || {};
  const artIds = myArtisanIds_(p), props = indexBy_(dbAll_("Properties"), "propertyId");
  const rows = dbAll_("Quotes").filter(function (q) {
    const prop = props[String(q.propertyId)];
    if (!(artIds.indexOf(String(q.artisanId)) >= 0 || canProp_(p, prop, "workorder.manage") || canProp_(p, prop, "quote.decide"))) return false;
    if (a.status && String(a.status).split(",").indexOf(q.status) < 0) return false;
    if (a.propertyId && String(q.propertyId) !== String(a.propertyId)) return false;
    if (a.incidentId && String(q.incidentId) !== String(a.incidentId)) return false;
    return true;
  }).sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); });
  const page = pageOf_(rows, a);
  page.items = page.items.map(function (q) { const o = quoteOut_(q); o.propertyName = (props[String(q.propertyId)] || {}).name; o.isMine = artIds.indexOf(String(q.artisanId)) >= 0; o.canDecide = canProp_(p, props[String(q.propertyId)], "quote.decide"); return o; });
  return page;
}
function quoteExpireJob_() {
  const today = todayStr_(); let n = 0;
  dbAll_("Quotes").filter(function (q) { return q.status === "PENDING" && q.validUntil && q.validUntil < today; }).forEach(function (q) { dbUpdate_("Quotes", q.quoteId, { status: "EXPIRED" }); n++; });
  return { expired: n };
}

/* ------------------------------ Ordres de travail ------------------------------ */
function woLoad_(p, id, mode) {
  const w = dbGet_("WorkOrders", safeText_(id, 120));
  if (!w) throw new AppError("FORBIDDEN", "Intervention introuvable ou accès refusé.");
  const prop = dbGet_("Properties", w.propertyId);
  const mgr = canProp_(p, prop, "workorder.manage"), mine = myArtisanIds_(p).indexOf(String(w.artisanId)) >= 0;
  const ok = mode === "manager" ? mgr : mode === "artisan" ? (mine || mgr) : (mgr || mine || canProp_(p, prop, "incident.view"));
  if (!ok) throw new AppError("FORBIDDEN", "Intervention introuvable ou accès refusé.");
  if (mode !== "read") assertOrgWritable_(w.organizationId);
  return { w: w, prop: prop, mgr: mgr, mine: mine };
}
function woCreate_(p, a) {
  const i = dbGet_("IncidentsV4", safeText_(a.incidentId, 120));
  if (!i) notFound_("Incident");
  const prop = assertProp_(p, i.propertyId, "workorder.manage");
  const c = dbGet_("Artisans", safeText_(a.artisanId, 120));
  assert_(contractorUsableFor_(p, c, prop), "Prestataire non autorisé pour ce bien.");
  let q = null;
  if (a.quoteId) { q = dbGet_("Quotes", safeText_(a.quoteId, 120)); assert_(q && q.status === "APPROVED" && String(q.incidentId) === String(i.incidentId) && String(q.artisanId) === String(c.artisanId), "Un devis APPROUVÉ de ce prestataire pour cet incident est requis."); }
  else if (getSetting_("workorder.requireQuote", prop.organizationId) !== false) assert_(i.severity === "CRITICAL", "Un devis approuvé est requis (sauf incident CRITIQUE — intervention d'urgence).");
  const rate = resolveCommissionRate_(a.commissionRate, c, prop.organizationId);
  return withLock_(function () {
    assert_(!dbAll_("WorkOrders").some(function (w) { return q && String(w.quoteId) === String(q.quoteId) && w.status !== "CANCELLED" && w.status !== "DECLINED"; }), "Une intervention existe déjà pour ce devis.");
    const w = dbInsert_("WorkOrders", { organizationId: prop.organizationId, propertyId: prop.propertyId, incidentId: i.incidentId, quoteId: q ? q.quoteId : "", artisanId: c.artisanId, status: "ASSIGNED",
      scheduledAt: "", description: safeText_(a.description || i.description, 2000), report: "", invoiceFileId: "", createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_(), updatedBy: p.email,
      title: safeText_(a.title || i.title || i.category, 120), desiredDate: a.desiredDate ? dateOnly_(a.desiredDate, "Date souhaitée") : "", commissionRate: rate });
    if (["OPEN", "QUALIFIED"].indexOf(i.status) >= 0) dbUpdate_("IncidentsV4", i.incidentId, { status: "ASSIGNED", contractorId: c.artisanId, updatedAt: nowIso_(), updatedBy: p.email });
    else dbUpdate_("IncidentsV4", i.incidentId, { contractorId: c.artisanId, updatedAt: nowIso_(), updatedBy: p.email });
    audit_("WORK_ORDER_CREATED", "WorkOrder", w.workOrderId, prop.organizationId, { incidentId: i.incidentId, artisanId: c.artisanId, quoteId: w.quoteId, commissionRate: rate });
    if (c.userId) notify_({ eventKey: "wo-assigned:" + w.workOrderId, userIds: [c.userId], type: "WORK_ORDER", organizationId: prop.organizationId, title: "Nouvelle intervention : " + prop.name,
      body: w.title + (w.desiredDate ? " — souhaitée le " + w.desiredDate : ""), link: "#workorders" });
    return { ok: true, workOrderId: w.workOrderId, id: w.workOrderId };
  });
}
function woRespond_(p, a) {
  const x = woLoad_(p, a.workOrderId, "artisan");
  assert_(x.mine, "Seul l'artisan affecté peut répondre.", "FORBIDDEN");
  assert_(x.w.status === "ASSIGNED", "Intervention déjà traitée.");
  const decision = oneOf_(a.decision, ["ACCEPTED", "DECLINED"], "Décision");
  dbUpdate_("WorkOrders", x.w.workOrderId, { status: decision, acceptedAt: decision === "ACCEPTED" ? nowIso_() : "", declineReason: decision === "DECLINED" ? safeText_(a.reason, 500) : "", updatedAt: nowIso_(), updatedBy: p.email });
  audit_("WORK_ORDER_" + decision, "WorkOrder", x.w.workOrderId, x.w.organizationId, {});
  if (decision === "DECLINED") notify_({ eventKey: "wo-declined:" + x.w.workOrderId, userIds: propertyManagers_(x.prop, "canManageOperations"), type: "WORK_ORDER_DECLINED", organizationId: x.w.organizationId,
    title: "Intervention refusée : " + x.prop.name, body: a.reason || "", link: "#incident/" + x.w.incidentId });
  return { ok: true, status: decision };
}
function woSchedule_(p, a) {
  const x = woLoad_(p, a.workOrderId, "artisan");
  assert_(["ASSIGNED", "ACCEPTED", "SCHEDULED"].indexOf(x.w.status) >= 0, "Intervention non planifiable.");
  assert_(x.w.status !== "ASSIGNED" || x.mgr, "Acceptez d'abord l'intervention.");
  const at = parseTs_(a.scheduledAt); assert_(at && at.getTime() > Date.now() - 86400000, "Date d'intervention invalide.");
  dbUpdate_("WorkOrders", x.w.workOrderId, { status: "SCHEDULED", scheduledAt: at.toISOString(), updatedAt: nowIso_(), updatedBy: p.email });
  audit_("WORK_ORDER_SCHEDULED", "WorkOrder", x.w.workOrderId, x.w.organizationId, { scheduledAt: at.toISOString() });
  const art = dbGet_("Artisans", x.w.artisanId);
  notify_({ eventKey: "wo-scheduled:" + x.w.workOrderId + ":" + at.toISOString(), userIds: propertyManagers_(x.prop, "canManageOperations").concat(art && art.userId ? [art.userId] : []).filter(function (u) { return u !== p.userId; }),
    type: "WORK_ORDER_SCHEDULED", organizationId: x.w.organizationId, title: "Intervention planifiée : " + x.prop.name, body: Utilities.formatDate(at, tz_(), "dd/MM/yyyy HH:mm") + " — " + (x.w.title || ""), link: "#workorders" });
  return { ok: true };
}
function woStart_(p, a) {
  const x = woLoad_(p, a.workOrderId, "artisan");
  assert_(["ACCEPTED", "SCHEDULED"].indexOf(x.w.status) >= 0, "L'intervention doit être acceptée ou planifiée.");
  dbUpdate_("WorkOrders", x.w.workOrderId, { status: "IN_PROGRESS", startedAt: nowIso_(), updatedAt: nowIso_(), updatedBy: p.email });
  const inc = dbGet_("IncidentsV4", x.w.incidentId);
  if (inc && ["APPROVED", "ASSIGNED", "QUALIFIED", "OPEN"].indexOf(inc.status) >= 0) dbUpdate_("IncidentsV4", inc.incidentId, { status: "IN_PROGRESS", updatedAt: nowIso_(), updatedBy: p.email });
  audit_("WORK_ORDER_STARTED", "WorkOrder", x.w.workOrderId, x.w.organizationId, {});
  return { ok: true };
}
function woComplete_(p, a) {
  const x = woLoad_(p, a.workOrderId, "artisan");
  assert_(["IN_PROGRESS", "SCHEDULED", "ACCEPTED"].indexOf(x.w.status) >= 0, "Intervention non terminable (statut " + x.w.status + ").");
  const report = reqText_(a.report, "Rapport d'intervention", 5, 3000);
  const photos = assertDocsOf_(a.photoDocIds || [], "WORKORDER", x.w.workOrderId);
  dbUpdate_("WorkOrders", x.w.workOrderId, { status: "COMPLETED", report: report, completedAt: nowIso_(), startedAt: x.w.startedAt || nowIso_(), photoDocIdsJson: photos, updatedAt: nowIso_(), updatedBy: p.email });
  audit_("WORK_ORDER_COMPLETED", "WorkOrder", x.w.workOrderId, x.w.organizationId, { photos: photos.length });
  notify_({ eventKey: "wo-completed:" + x.w.workOrderId, userIds: propertyManagers_(x.prop, "canManageOperations"), type: "WORK_ORDER_COMPLETED", organizationId: x.w.organizationId,
    title: "Intervention terminée, à contrôler : " + x.prop.name, body: report.slice(0, 200), link: "#incident/" + x.w.incidentId });
  return { ok: true };
}
/** Contrôle par le gestionnaire : VERIFIED (incident résolu) ou reprise. */
function woVerify_(p, a) {
  const x = woLoad_(p, a.workOrderId, "manager");
  assert_(x.w.status === "COMPLETED", "Seule une intervention terminée peut être contrôlée.");
  if (a.decision === "REWORK") {
    dbUpdate_("WorkOrders", x.w.workOrderId, { status: "IN_PROGRESS", report: safeText_((x.w.report || "") + "\n[Reprise demandée] " + reqText_(a.note, "Motif", 3, 500), 3000), updatedAt: nowIso_(), updatedBy: p.email });
    audit_("WORK_ORDER_REWORK", "WorkOrder", x.w.workOrderId, x.w.organizationId, {});
    return { ok: true, status: "IN_PROGRESS" };
  }
  dbUpdate_("WorkOrders", x.w.workOrderId, { status: "VERIFIED", verifiedAt: nowIso_(), verifiedBy: p.email, updatedAt: nowIso_(), updatedBy: p.email });
  const inc = dbGet_("IncidentsV4", x.w.incidentId);
  const others = dbAll_("WorkOrders").filter(function (w) { return String(w.incidentId) === String(x.w.incidentId) && w.workOrderId !== x.w.workOrderId && ["CANCELLED", "DECLINED", "VERIFIED"].indexOf(w.status) < 0; });
  if (inc && !others.length && ["RESOLVED", "CLOSED", "CANCELLED"].indexOf(inc.status) < 0) dbUpdate_("IncidentsV4", inc.incidentId, { status: "RESOLVED", resolvedAt: nowIso_(), updatedAt: nowIso_(), updatedBy: p.email });
  audit_("WORK_ORDER_VERIFIED", "WorkOrder", x.w.workOrderId, x.w.organizationId, {});
  return { ok: true, status: "VERIFIED" };
}
function woCancel_(p, a) {
  const x = woLoad_(p, a.workOrderId, "manager");
  assert_(["ASSIGNED", "ACCEPTED", "SCHEDULED", "DECLINED"].indexOf(x.w.status) >= 0, "Intervention non annulable.");
  dbUpdate_("WorkOrders", x.w.workOrderId, { status: "CANCELLED", declineReason: safeText_(a.reason, 500), updatedAt: nowIso_(), updatedBy: p.email });
  audit_("WORK_ORDER_CANCELLED", "WorkOrder", x.w.workOrderId, x.w.organizationId, {});
  return { ok: true };
}
function woList_(p, a) {
  a = a || {};
  const artIds = myArtisanIds_(p), props = indexBy_(dbAll_("Properties"), "propertyId");
  const rows = dbAll_("WorkOrders").filter(function (w) {
    if (!(artIds.indexOf(String(w.artisanId)) >= 0 || canProp_(p, props[String(w.propertyId)], "workorder.manage"))) return false;
    if (a.status && String(a.status).split(",").indexOf(w.status) < 0) return false;
    if (a.propertyId && String(w.propertyId) !== String(a.propertyId)) return false;
    if (a.artisanId && String(w.artisanId) !== String(a.artisanId)) return false;
    return matchesQuery_(a.q, [w.title, w.description, (props[String(w.propertyId)] || {}).name]);
  }).sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); });
  const page = pageOf_(rows, a);
  page.items = page.items.map(function (w) { const o = woOut_(w); o.isMine = artIds.indexOf(String(w.artisanId)) >= 0; o.canManage = canProp_(p, props[String(w.propertyId)], "workorder.manage"); return o; });
  return page;
}
function woGet_(p, a) {
  const x = woLoad_(p, a.workOrderId, "read");
  const o = woOut_(x.w);
  o.isMine = x.mine; o.canManage = x.mgr; o.address = x.prop.address; o.city = x.prop.city;
  if (x.mine || x.mgr) o.accessInstructions = x.prop.accessInstructions;
  o.quote = x.w.quoteId ? quoteOut_(dbGet_("Quotes", x.w.quoteId)) : null;
  o.documents = docList_(p, { ownerType: "WORKORDER", ownerId: x.w.workOrderId });
  o.history = auditHistory_("WorkOrder", x.w.workOrderId, 30);
  return o;
}
/** Bon d'intervention PDF. */
/* ------------------------- Documents PDF : devis, facture (au nom du prestataire) et bon d'intervention ------------------------- */
/** Identité du prestataire pour l'en-tête de ses devis et factures. */
function providerIssuer_(art) {
  art = art || {};
  return { name: art.legalName || art.name || "Prestataire", lines: [art.legalName && art.name && art.legalName !== art.name ? art.name : "", art.taxId || "", [art.phone, art.email].filter(String).join(" — ")] };
}
/** Organisation cliente : l'agence qui gère le bien si c'est elle qui a fait la demande, sinon le propriétaire. */
function requesterOrg_(prop, email) { return dbGet_("Organizations", commissionBeneficiary_({ createdBy: email || "" }, prop)) || dbGet_("Organizations", prop.organizationId) || {}; }
function fmtAmount_(v, cur) { return (Math.round(num_(v) * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (cur || "MAD"); }
function docLinesHtml_(lines, cur) {
  return htmlTable_(["Désignation", "Qté", "PU HT", "Montant HT"], lines.map(function (l) { return [l.description, String(l.quantity), fmtAmount_(l.unitPrice, cur), fmtAmount_(l.amount, cur)]; }));
}
function docTotalsHtml_(ht, vatRate, vat, ttc, cur, extra) {
  const rows = [["Total HT", fmtAmount_(ht, cur)], ["TVA " + num_(vatRate) + " %", fmtAmount_(vat, cur)], ["<b>Total TTC</b>", "<b>" + escapeHtml_(fmtAmount_(ttc, cur)) + "</b>"]].concat(extra || []);
  return "<table style='width:45%;margin:8px 0 0 auto'>" + rows.map(function (r) { return "<tr><td>" + (r[0].charAt(0) === "<" ? r[0] : escapeHtml_(r[0])) + "</td><td class='right'>" + (r[1].charAt(0) === "<" ? r[1] : escapeHtml_(r[1])) + "</td></tr>"; }).join("") + "</table>";
}

/** Devis du prestataire (sans la marque ImmoPilot). */
function quotePdf_(p, a) {
  const x = quoteLoad_(p, a.quoteId), q = x.q, prop = x.prop, art = dbGet_("Artisans", q.artisanId) || {};
  assert_(["PENDING", "APPROVED", "REJECTED", "EXPIRED"].indexOf(q.status) >= 0, "Le devis n'a pas encore été établi par le prestataire.");
  const inc = dbGet_("IncidentsV4", q.incidentId) || {}, client = requesterOrg_(prop, q.requestedBy || q.createdBy), cur = q.currency || "MAD";
  const num = "DEV-" + String(q.quoteId).slice(-6).toUpperCase(), lines = parseJson_(q.linesJson, []);
  const ht = num_(q.amountHT) || sumBy_(lines, function (l) { return l.amount; }), vatRate = q.vatRate === "" || q.vatRate == null ? 20 : num_(q.vatRate);
  const ttc = num_(q.amountTTC) || num_(q.totalAmount) || round2_(ht * (1 + vatRate / 100)), vat = round2_(ttc - ht);
  let html = "<table><tr><td style='width:50%'><b>Devis n° " + escapeHtml_(num) + "</b><br>Date : " + escapeHtml_(pdfDate_(q.submittedAt || q.createdAt)) + "<br>Valable jusqu'au : " + escapeHtml_(pdfDate_(q.validUntil)) +
    "</td><td><b>Client</b><br>" + escapeHtml_(client.name || "") + "<br>" + escapeHtml_(client.billingEmail || "") + "<br><span class='muted'>Lieu d'intervention : " + escapeHtml_(prop.name + ", " + [prop.address, prop.city].filter(String).join(", ")) + "</span></td></tr></table>";
  html += "<h2>Objet</h2><p>" + escapeHtml_(inc.title || inc.description || "Intervention") + (q.requestNote ? "<br><span class='muted'>Demande : " + escapeHtml_(q.requestNote) + "</span>" : "") + "</p>";
  html += "<h2>Détail</h2>" + (lines.length ? docLinesHtml_(lines, cur) : "<p class='muted'>Montant forfaitaire.</p>") + docTotalsHtml_(ht, vatRate, vat, ttc, cur);
  html += "<h2>Conditions</h2><div class='box'>Délai d'exécution estimé : " + escapeHtml_(q.estimatedDays ? q.estimatedDays + " jour(s)" : "à convenir") + " après acceptation.<br>" +
    "Travaux réalisés après acceptation du devis ; paiement à réception de la facture.<br>" + escapeHtml_(art.billingInfo || "") + "</div>";
  if (q.status === "APPROVED") html += "<p><b>Devis accepté le " + escapeHtml_(pdfDate_(q.decisionAt)) + "</b>" + (q.decisionNote ? " — " + escapeHtml_(q.decisionNote) : "") + "</p>";
  if (q.status === "REJECTED") html += "<p><b>Devis refusé le " + escapeHtml_(pdfDate_(q.decisionAt)) + "</b>" + (q.decisionNote ? " — " + escapeHtml_(q.decisionNote) : "") + "</p>";
  html += "<h2>Signatures</h2><table class='sign'><tr><td>Le prestataire<br><span class='muted'>" + escapeHtml_(art.name || "") + "</span></td><td>Le client — « Bon pour accord »<br><span class='muted'>" + escapeHtml_(client.name || "") + "</span></td></tr></table>";
  audit_("QUOTE_PDF", "Quote", q.quoteId, q.organizationId, {});
  return storeGeneratedPdf_(p, htmlToPdf_(pdfShell_("Devis", html, { issuer: providerIssuer_(art), subtitle: num, footer: "Devis établi par " + (art.legalName || art.name || "le prestataire") + "." }), "Devis_" + num),
    { propertyId: prop.propertyId, organizationId: prop.organizationId }, "QUOTE", q.quoteId, "QUOTE");
}

/** Facture du prestataire au propriétaire du bien (sans la marque ImmoPilot ; la commission interne n'y figure pas). */
function invoicePdf_(p, a) {
  const x = invLoad_(p, a.invoiceId), v = x.v, prop = x.prop, art = dbGet_("Artisans", v.artisanId) || {}, cur = v.currency || "MAD";
  const owner = dbGet_("Organizations", prop.organizationId) || {}, w = v.workOrderId ? dbGet_("WorkOrders", v.workOrderId) : null, q = w && w.quoteId ? dbGet_("Quotes", w.quoteId) : null;
  let lines = q ? parseJson_(q.linesJson, []) : [];
  if (!lines.length || Math.abs(sumBy_(lines, function (l) { return l.amount; }) - num_(v.amountHT)) > 0.01) lines = [{ description: (w && (w.title || w.description)) || "Intervention", quantity: 1, unitPrice: num_(v.amountHT), amount: num_(v.amountHT) }];
  const paidOn = v.status === "PAID" ? pdfDate_(v.paidAt) : "";
  let html = "<table><tr><td style='width:50%'><b>Facture n° " + escapeHtml_(v.invoiceNumber || "") + "</b><br>Date : " + escapeHtml_(pdfDate_(v.issueDate)) + "<br>Échéance : " + escapeHtml_(pdfDate_(v.dueDate)) +
    (w ? "<br>Intervention : " + escapeHtml_(String(w.workOrderId).slice(-8).toUpperCase()) : "") + (q ? "<br>Devis : DEV-" + escapeHtml_(String(q.quoteId).slice(-6).toUpperCase()) : "") +
    "</td><td><b>Facturé à</b><br>" + escapeHtml_(owner.name || "") + "<br>" + escapeHtml_(owner.billingEmail || "") + "<br><span class='muted'>Lieu d'intervention : " + escapeHtml_(prop.name + ", " + [prop.address, prop.city].filter(String).join(", ")) + "</span></td></tr></table>";
  html += "<h2>Prestations</h2>" + docLinesHtml_(lines, cur) + docTotalsHtml_(v.amountHT, v.vatRate, v.vatAmount, v.amountTTC, cur, paidOn ? [["Statut", "Acquittée le " + paidOn]] : [["Reste à payer", fmtAmount_(v.amountTTC, cur)]]);
  html += "<h2>Règlement</h2><div class='box'>" + escapeHtml_(art.billingInfo || "Règlement par virement à réception de facture.") + "<br>Mentions légales du prestataire (ICE, IF, RC, patente) : " + escapeHtml_(art.taxId || "à compléter dans la fiche du prestataire") + ".</div>";
  if (w && w.report) html += "<h2>Compte rendu d'intervention</h2><p>" + escapeHtml_(w.report) + "</p>";
  audit_("INVOICE_PDF", "Invoice", v.invoiceId, v.organizationId, {});
  return storeGeneratedPdf_(p, htmlToPdf_(pdfShell_("Facture", html, { issuer: providerIssuer_(art), subtitle: "N° " + (v.invoiceNumber || ""), footer: "Facture établie par " + (art.legalName || art.name || "le prestataire") + "." }),
    "Facture_" + String(v.invoiceNumber || v.invoiceId).replace(/[^\w-]+/g, "_")), { propertyId: prop.propertyId, organizationId: prop.organizationId }, "INVOICE", v.invoiceId, "INVOICE");
}

function woOrderPdf_(p, a) {
  const x = woLoad_(p, a.workOrderId, "read"), w = x.w, prop = x.prop;
  const art = dbGet_("Artisans", w.artisanId) || {}, q = w.quoteId ? dbGet_("Quotes", w.quoteId) : null, inc = dbGet_("IncidentsV4", w.incidentId) || {};
  const orderer = requesterOrg_(prop, w.createdBy), owner = dbGet_("Organizations", prop.organizationId) || {}, cur = (q && q.currency) || "MAD";
  const ST = { ASSIGNED: "Attribuée", ACCEPTED: "Acceptée", DECLINED: "Refusée", SCHEDULED: "Planifiée", IN_PROGRESS: "En cours", COMPLETED: "Terminée", VERIFIED: "Contrôlée", CANCELLED: "Annulée" };
  let html = "<h2>Parties</h2>" + htmlTable_(["", "Organisation / personne", "Contact"], [["Donneur d'ordre", orderer.name || "", orderer.billingEmail || ""],
    ["Propriétaire du bien (règlement)", owner.name || "", owner.billingEmail || ""], ["Prestataire", art.legalName || art.name || "", [art.email, art.phone].filter(String).join(" — ")]]);
  html += "<h2>Intervention</h2>" + htmlTable_(["Champ", "Valeur"], [["Référence", String(w.workOrderId).slice(-8).toUpperCase()], ["Bien", prop.name], ["Adresse", [prop.address, prop.neighborhood, prop.city].filter(String).join(", ")],
    ["Objet", w.title || inc.title || ""], ["Description", w.description || inc.description || ""], ["Catégorie", ({ PLUMBING: "Plomberie", ELECTRICITY: "Électricité", AC: "Climatisation", HUMIDITY: "Humidité", LOCKSMITH: "Serrurerie", FURNITURE: "Mobilier", APPLIANCE: "Électroménager", CLEANING: "Ménage", DAMAGE: "Dégradation", SECURITY: "Sécurité", OTHER: "Autre" })[inc.category] || inc.category || ""], ["Date souhaitée", pdfDate_(w.desiredDate)],
    ["Date planifiée", w.scheduledAt ? Utilities.formatDate(parseTs_(w.scheduledAt), tz_(), "dd/MM/yyyy HH:mm") : "—"], ["Statut", ST[w.status] || w.status],
    ["Devis", q ? "DEV-" + String(q.quoteId).slice(-6).toUpperCase() + " — " + fmtAmount_(q.amountTTC || q.totalAmount, cur) + " TTC" : "Sans devis (urgence ou petit dépannage)"]]);
  if (q) html += "<h2>Travaux prévus (devis accepté)</h2>" + docLinesHtml_(parseJson_(q.linesJson, []), cur);
  html += "<h2>Consignes</h2><div class='box'><ul style='margin:0;padding-left:16px'>" + ["Confirmer l'acceptation et la date d'intervention dans l'application.", "Respecter les consignes d'accès du bien et prévenir le gardien de votre arrivée.",
    "Joindre des photos et un compte rendu à la fin de l'intervention ; signaler tout dépassement du devis avant de poursuivre.", "Déposer la facture dans l'application ; elle est réglée après contrôle des travaux."]
    .map(function (t) { return "<li>" + escapeHtml_(t) + "</li>"; }).join("") + "</ul></div>";
  if (w.report) html += "<h2>Compte rendu</h2><p>" + escapeHtml_(w.report) + "</p>";
  html += "<h2>Signatures</h2><table class='sign'><tr><td>Le donneur d'ordre<br><span class='muted'>" + escapeHtml_(orderer.name || "") + "</span></td><td>Le prestataire<br><span class='muted'>" + escapeHtml_(art.name || "") + "</span></td></tr></table>";
  return storeGeneratedPdf_(p, htmlToPdf_(pdfShell_("Bon d'intervention", html, { subtitle: prop.name + " — " + (w.title || "") }), "BonIntervention_" + w.workOrderId), { propertyId: prop.propertyId, organizationId: prop.organizationId }, "WORKORDER", w.workOrderId, "ORDER");
}
