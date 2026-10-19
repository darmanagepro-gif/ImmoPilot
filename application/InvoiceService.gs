/**
 * Factures des prestataires et commission.
 *
 * COMMISSION (documentée dans ARCHITECTURE.md § Finances) :
 *  - Base de calcul : montant HT de la facture approuvée (jamais le TTC, jamais le devis).
 *  - Taux : figé sur l'ordre de travail à sa création (saisie > fiche prestataire > paramètre commission.contractorRate, 15 % par défaut).
 *  - Bénéficiaire : l'organisation qui a commandé l'intervention (agence si l'ordre a été créé par un compte agence attribué au bien,
 *    sinon l'organisation propriétaire).
 *  - Traitement : la commission est RETENUE sur le versement à l'artisan (net = TTC − commission − TVA sur commission).
 *    Le propriétaire supporte uniquement le TTC de la facture (dépense MAINTENANCE). La commission est un REVENU du bénéficiaire ;
 *    la TVA sur commission (paramètre commission.vatRate) est due par le bénéficiaire selon son régime fiscal — à valider par un comptable.
 *  - Calcul unique : effectué une seule fois à l'approbation, sous verrou, puis commissionLocked = TRUE. Aucun autre module ne la recalcule.
 */
function invoiceOut_(v) {
  return { invoiceId: v.invoiceId, workOrderId: v.workOrderId, incidentId: v.incidentId, propertyId: v.propertyId, artisanId: v.artisanId, artisanName: ((dbGet_("Artisans", v.artisanId) || {}).name) || "",
    invoiceNumber: v.invoiceNumber, issueDate: v.issueDate, dueDate: v.dueDate, amountHT: v.amountHT, vatRate: v.vatRate, vatAmount: v.vatAmount, amountTTC: v.amountTTC,
    commissionRate: v.commissionRate, commissionBase: v.commissionBase, commissionAmount: v.commissionAmount, commissionVatAmount: v.commissionVatAmount, commissionLocked: v.commissionLocked,
    commissionBeneficiaryOrgId: v.commissionBeneficiaryOrgId, netToContractor: v.netToContractor, paidAmount: v.paidAmount || 0, balance: round2_(num_(v.netToContractor || v.amountTTC) - num_(v.paidAmount)),
    currency: v.currency || cur_(), status: v.status, documentId: v.documentId, notes: v.notes, createdAt: v.createdAt, approvedAt: v.approvedAt };
}
/** Calcul pur (testé) : retourne la ventilation d'une facture. */
function computeInvoiceSplit_(amountHT, vatRate, commissionRate, commissionVatRate) {
  const ht = round2_(amountHT), vat = round2_(ht * vatRate / 100), ttc = round2_(ht + vat);
  const com = round2_(ht * commissionRate / 100), comVat = round2_(com * commissionVatRate / 100);
  return { amountHT: ht, vatAmount: vat, amountTTC: ttc, commissionBase: ht, commissionAmount: com, commissionVatAmount: comVat, netToContractor: round2_(ttc - com - comVat) };
}
function commissionBeneficiary_(w, prop) {
  const creator = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === normalizeEmail_(w.createdBy); });
  if (creator) {
    const agencyOrg = dbAll_("UserRoles").filter(function (r) { return String(r.userId) === String(creator.userId) && r.status === "ACTIVE" && (r.role === "AGENCY_ADMIN" || r.role === "AGENCY_USER"); })
      .map(function (r) { return String(r.organizationId); })
      .find(function (orgId) { return dbAll_("AgencyPropertyPermissions").some(function (z) { return String(z.propertyId) === String(prop.propertyId) && String(z.agencyOrganizationId) === orgId && z.status === "ACTIVE"; }); });
    if (agencyOrg) return agencyOrg;
  }
  return String(prop.organizationId);
}
function invLoad_(p, id) {
  const v = dbGet_("Invoices", safeText_(id, 120));
  if (!v) throw new AppError("FORBIDDEN", "Facture introuvable ou accès refusé.");
  const prop = dbGet_("Properties", v.propertyId);
  const view = canProp_(p, prop, "invoice.view"), manage = canProp_(p, prop, "invoice.manage"), mine = myArtisanIds_(p).indexOf(String(v.artisanId)) >= 0;
  if (!view && !manage && !mine) throw new AppError("FORBIDDEN", "Facture introuvable ou accès refusé.");
  return { v: v, prop: prop, manage: manage, mine: mine };
}

/* ------------------------------ Routes ------------------------------ */
function invSubmit_(p, a) {
  const x = woLoad_(p, a.workOrderId, "artisan");
  assert_(["COMPLETED", "VERIFIED"].indexOf(x.w.status) >= 0, "La facture ne peut être transmise qu'après l'intervention.");
  const ht = money_(a.amountHT, "Montant HT", { min: 0.01 });
  const vatRate = a.vatRate === undefined || a.vatRate === "" ? Number(getSetting_("finance.vatRate", x.w.organizationId)) : rate_(a.vatRate, "TVA");
  const docId = safeText_(a.documentId || "", 120);
  if (docId) { const d = dbGet_("Documents", docId); assert_(d && d.status === "ACTIVE" && ((d.ownerType === "WORKORDER" && String(d.ownerId) === String(x.w.workOrderId)) || d.ownerType === "INVOICE"), "Justificatif de facture invalide."); }
  return withLock_(function () {
    return idemRun_(a.requestKey, "INVOICE_SUBMIT", x.w.organizationId, function () {
      assert_(!dbAll_("Invoices").some(function (v) { return String(v.workOrderId) === String(x.w.workOrderId) && ["CANCELLED", "REJECTED"].indexOf(v.status) < 0; }), "Une facture est déjà enregistrée pour cette intervention.");
      const split = computeInvoiceSplit_(ht, vatRate, 0, 0);
      let notes = safeText_(a.notes, 1000);
      if (x.w.quoteId) {
        const q = dbGet_("Quotes", x.w.quoteId), tol = Number(getSetting_("invoice.tolerancePercent", x.w.organizationId)) || 5;
        if (q && num_(q.amountTTC) > 0 && split.amountTTC > num_(q.amountTTC) * (1 + tol / 100)) notes = safeText_("[ÉCART DEVIS] Facture " + split.amountTTC + " > devis " + q.amountTTC + " (+" + tol + " % tolérés). " + notes, 1000);
      }
      const v = dbInsert_("Invoices", { organizationId: x.w.organizationId, propertyId: x.w.propertyId, workOrderId: x.w.workOrderId, incidentId: x.w.incidentId, artisanId: x.w.artisanId,
        invoiceNumber: reqText_(a.invoiceNumber, "Numéro de facture", 1, 60), issueDate: a.issueDate ? dateOnly_(a.issueDate, "Date de facture") : todayStr_(), dueDate: a.dueDate ? dateOnly_(a.dueDate, "Échéance") : addDaysStr_(todayStr_(), 30),
        amountHT: split.amountHT, vatRate: vatRate, vatAmount: split.vatAmount, amountTTC: split.amountTTC, commissionRate: x.w.commissionRate, commissionLocked: false, currency: cur_(), status: "SUBMITTED",
        documentId: docId, paidAmount: 0, createdAt: nowIso_(), createdBy: p.email, notes: notes });
      if (docId) dbUpdate_("Documents", docId, { ownerType: "INVOICE", ownerId: v.invoiceId, category: "INVOICE" });
      dbUpdate_("WorkOrders", x.w.workOrderId, { invoiceId: v.invoiceId, updatedAt: nowIso_() });
      audit_("INVOICE_SUBMITTED", "Invoice", v.invoiceId, v.organizationId, { amountTTC: v.amountTTC, gap: notes.indexOf("[ÉCART") === 0 });
      notify_({ eventKey: "invoice-pending:" + v.invoiceId, userIds: dbAll_("UserRoles").filter(function (r) { return r.status === "ACTIVE" && r.role === "OWNER" && String(r.organizationId) === String(x.prop.organizationId); }).map(function (r) { return r.userId; }),
        type: "INVOICE_PENDING", organizationId: v.organizationId, title: "Facture en attente : " + x.prop.name, body: v.amountTTC + " MAD TTC" + (notes.indexOf("[ÉCART") === 0 ? " — écart avec le devis" : ""), link: "#invoices" });
      return { ok: true, invoiceId: v.invoiceId, id: v.invoiceId, warning: notes.indexOf("[ÉCART") === 0 ? notes : "" };
    });
  });
}
function invApprove_(p, a) {
  const x = invLoad_(p, a.invoiceId);
  assert_(x.manage, "Approbation de facture non autorisée.", "FORBIDDEN");
  assertOrgWritable_(x.v.organizationId);
  return withLock_(function () {
    const v = dbGet_("Invoices", x.v.invoiceId);
    assert_(v.status === "SUBMITTED", "Facture déjà traitée (statut " + v.status + ").");
    assert_(!bool_(v.commissionLocked), "Commission déjà calculée.");
    const w = dbGet_("WorkOrders", v.workOrderId);
    const rate = v.commissionRate !== null && v.commissionRate !== "" ? Number(v.commissionRate) : resolveCommissionRate_(undefined, dbGet_("Artisans", v.artisanId), v.organizationId);
    const comVat = Number(getSetting_("commission.vatRate", v.organizationId));
    const split = computeInvoiceSplit_(v.amountHT, v.vatRate, rate, isFinite(comVat) ? comVat : 20);
    const beneficiary = commissionBeneficiary_(w || { createdBy: "" }, x.prop);
    dbUpdate_("Invoices", v.invoiceId, { status: "APPROVED", approvedAt: nowIso_(), approvedBy: p.email, commissionRate: rate, commissionBase: split.commissionBase, commissionAmount: split.commissionAmount,
      commissionVatRate: isFinite(comVat) ? comVat : 20, commissionVatAmount: split.commissionVatAmount, commissionBeneficiaryOrgId: beneficiary, commissionLocked: true, netToContractor: split.netToContractor });
    dbInsertUnique_("Expenses", "uniqueKey", "invoice:" + v.invoiceId, { organizationId: v.organizationId, propertyId: v.propertyId, category: "MAINTENANCE", description: "Facture " + v.invoiceNumber + " — intervention " + v.workOrderId,
      supplier: ((dbGet_("Artisans", v.artisanId) || {}).name) || "", amount: v.amountTTC, vatAmount: v.vatAmount, currency: v.currency || cur_(), expenseDate: v.issueDate, status: "INVOICED", refType: "INVOICE", refId: v.invoiceId,
      documentId: v.documentId, createdAt: nowIso_(), createdBy: p.email });
    const inc = dbGet_("IncidentsV4", v.incidentId);
    if (inc) dbUpdate_("IncidentsV4", inc.incidentId, { finalCost: sumBy_(dbAll_("Invoices").filter(function (z) { return String(z.incidentId) === String(inc.incidentId) && ["APPROVED", "PARTIAL", "PAID"].indexOf(z.status) >= 0; }), function (z) { return z.amountTTC; }), updatedAt: nowIso_() });
    audit_("INVOICE_APPROVED", "Invoice", v.invoiceId, v.organizationId, { amountTTC: v.amountTTC, commissionRate: rate, commissionAmount: split.commissionAmount, beneficiary: beneficiary });
    const art = dbGet_("Artisans", v.artisanId);
    if (art && art.userId) notify_({ eventKey: "invoice-approved:" + v.invoiceId, userIds: [art.userId], type: "INVOICE_APPROVED", organizationId: v.organizationId, title: "Facture approuvée : " + v.invoiceNumber,
      body: "Net à percevoir : " + split.netToContractor + " MAD (commission " + rate + " % : " + split.commissionAmount + " MAD HT).", link: "#invoices" });
    return Object.assign({ ok: true, status: "APPROVED", commissionRate: rate, beneficiaryOrgId: beneficiary }, split);
  });
}
function invReject_(p, a) {
  const x = invLoad_(p, a.invoiceId);
  assert_(x.manage, "Action non autorisée.", "FORBIDDEN");
  assert_(x.v.status === "SUBMITTED", "Facture déjà traitée.");
  const note = reqText_(a.note, "Motif du refus", 3, 500);
  dbUpdate_("Invoices", x.v.invoiceId, { status: "REJECTED", notes: safeText_("[REFUS] " + note + " " + (x.v.notes || ""), 1000) });
  dbUpdate_("WorkOrders", x.v.workOrderId, { invoiceId: "" });
  audit_("INVOICE_REJECTED", "Invoice", x.v.invoiceId, x.v.organizationId, {});
  const art = dbGet_("Artisans", x.v.artisanId);
  if (art && art.userId) notify_({ eventKey: "invoice-rejected:" + x.v.invoiceId, userIds: [art.userId], type: "INVOICE_REJECTED", organizationId: x.v.organizationId, title: "Facture refusée : " + x.v.invoiceNumber, body: note, link: "#invoices" });
  return { ok: true };
}
function invList_(p, a) {
  a = a || {};
  const artIds = myArtisanIds_(p), props = indexBy_(dbAll_("Properties"), "propertyId");
  const rows = dbAll_("Invoices").filter(function (v) {
    if (!(artIds.indexOf(String(v.artisanId)) >= 0 || canProp_(p, props[String(v.propertyId)], "invoice.view"))) return false;
    if (a.status && String(a.status).split(",").indexOf(v.status) < 0) return false;
    if (a.propertyId && String(v.propertyId) !== String(a.propertyId)) return false;
    if (a.from && v.issueDate < a.from) return false; if (a.to && v.issueDate > a.to) return false;
    return matchesQuery_(a.q, [v.invoiceNumber, (props[String(v.propertyId)] || {}).name]);
  }).sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); });
  const page = pageOf_(rows, a);
  page.items = page.items.map(function (v) { const o = invoiceOut_(v); o.propertyName = (props[String(v.propertyId)] || {}).name; o.canManage = canProp_(p, props[String(v.propertyId)], "invoice.manage"); o.isMine = artIds.indexOf(String(v.artisanId)) >= 0; return o; });
  return page;
}
function invGet_(p, a) {
  const x = invLoad_(p, a.invoiceId);
  const o = invoiceOut_(x.v);
  o.canManage = x.manage; o.isMine = x.mine;
  o.payments = dbAll_("Payments").filter(function (z) { return z.refType === "INVOICE" && String(z.refId) === String(x.v.invoiceId); }).map(function (z) { return { paymentId: z.paymentId, amount: z.amount, paidAt: z.paidAt, method: z.method, reference: z.reference, status: z.status }; });
  o.history = auditHistory_("Invoice", x.v.invoiceId, 20);
  return o;
}
/** Met à jour le statut de paiement d'une facture à partir des paiements enregistrés. */
function invRefreshPaid_(invoiceId) {
  const v = dbGet_("Invoices", invoiceId); if (!v) return;
  const paid = sumBy_(dbAll_("Payments").filter(function (z) { return z.refType === "INVOICE" && String(z.refId) === String(invoiceId) && z.status === "RECORDED" && z.direction === "OUT"; }), function (z) { return z.amount; });
  const target = num_(v.netToContractor || v.amountTTC);
  const status = paid <= 0 ? "APPROVED" : (paid + 0.005 >= target ? "PAID" : "PARTIAL");
  dbUpdate_("Invoices", invoiceId, { paidAmount: paid, status: status, paidAt: status === "PAID" ? nowIso_() : "" });
  const exp = dbFind_("Expenses", "uniqueKey", "invoice:" + invoiceId);
  if (exp) dbUpdate_("Expenses", exp.expenseId, { status: status === "PAID" ? "PAID" : "INVOICED", paidAt: status === "PAID" ? nowIso_() : "" });
}
