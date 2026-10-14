/**
 * Finances : calculs centralisés côté serveur (un seul moteur, finCompute_, utilisé par les tableaux de bord, rapports et Pareto).
 *
 * DÉFINITIONS (voir ARCHITECTURE.md § Finances) :
 *  - PRÉVU (expected)    : revenu d'hébergement + frais des réservations CONFIRMED/IN_PROGRESS/COMPLETED, PRORATISÉ aux nuits
 *                          comprises dans la période ; + loyers et charges des échéances dont la date d'échéance est dans la période.
 *                          Les taxes de séjour sont suivies à part (collectées pour la commune, hors chiffre d'affaires).
 *  - FACTURÉ (billed)    : montants exigibles des réservations ARRIVANT dans la période (prix + frais + taxes) + échéances de loyer de la période
 *                          + factures prestataires approuvées (côté coûts).
 *  - ENCAISSÉ (collected): paiements entrants (Payments, direction IN) datés dans la période.
 *  - PAYÉ (paidOut)      : paiements sortants (remboursements, factures, restitutions de caution, dépenses) datés dans la période.
 *  - RESTANT DÛ          : pour les éléments facturés de la période, montant facturé − encaissé net à ce jour.
 *  - Résultat propriétaire = prévu − dépenses (Expenses non annulées de la période) − commissions de gestion proratisées.
 *  - Annulations         : réservations annulées dont la date d'arrivée prévue est dans la période (même règle que le Pareto des motifs).
 *  - Taux d'occupation   = nuits réservées / nuits disponibles (biens courte durée actifs × jours − nuits bloquées).
 *  - Prix moyen par nuit (ADR) = revenu d'hébergement proratisé / nuits réservées ; RevPAR = revenu d'hébergement / nuits disponibles.
 * Aucun montant n'est marqué encaissé sans paiement explicitement enregistré.
 */
var PAY_METHODS_ = ["CASH", "TRANSFER", "CARD", "CHEQUE", "PLATFORM", "OTHER"];
var REVENUE_STATUSES_ = ["CONFIRMED", "IN_PROGRESS", "COMPLETED"];

function finScopeProps_(p, f) {
  f = f || {};
  return dbAll_("Properties").filter(function (x) {
    if (x.status === "DELETED") return false;
    if (!(canProp_(p, x, "finance.view") || canProp_(p, x, "property.edit"))) return false;
    if (f.propertyId && String(x.propertyId) !== String(f.propertyId)) return false;
    if (f.organizationId && String(x.organizationId) !== String(f.organizationId)) return false;
    if (f.agencyOrganizationId && !dbAll_("AgencyPropertyPermissions").some(function (z) { return String(z.propertyId) === String(x.propertyId) && String(z.agencyOrganizationId) === String(f.agencyOrganizationId) && z.status === "ACTIVE"; })) return false;
    return true;
  });
}

/** Moteur financier. Pur calcul sur les données lues ; ne modifie rien. */
function finCompute_(p, f) {
  const per = periodFromFilters_(f), props = finScopeProps_(p, f);
  return finComputeForProps_(props, per, f || {});
}
function finComputeForProps_(props, per, f) {
  const ids = {}; props.forEach(function (x) { ids[String(x.propertyId)] = x; });
  const rowsBy = {}; props.forEach(function (x) { rowsBy[x.propertyId] = { propertyId: x.propertyId, name: x.name, organizationId: x.organizationId, expected: 0, accommodation: 0, rentExpected: 0, taxes: 0,
    billed: 0, collected: 0, paidOut: 0, outstanding: 0, expenses: 0, managementCommissions: 0, result: 0, bookedNights: 0, availableNights: 0, reservations: 0, cancellations: 0, cancellationRetained: 0 }; });
  const months = {};
  const mk = function (m) { return months[m] = months[m] || { month: m, expected: 0, collected: 0, paidOut: 0, expenses: 0, bookedNights: 0 }; };
  for (let d = per.from.slice(0, 7); d <= per.to.slice(0, 7); d = addMonthsStr_(d + "-01", 1).slice(0, 7)) mk(d);
  const inP = function (dateStr) { const s = String(dateStr || "").slice(0, 10); return s >= per.from && s <= per.to; };
  const byAgency = {};
  const resvAll = dbAll_("Reservations").filter(function (r) { return ids[String(r.propertyId)] && (!f.agencyOrganizationId || String(r.agencyOrganizationId) === String(f.agencyOrganizationId)); });
  const resvIds = {}; resvAll.forEach(function (r) { resvIds[String(r.reservationId)] = r; });
  resvAll.forEach(function (r) {
    const row = rowsBy[r.propertyId]; const nights = Math.max(diffDays_(r.checkIn, r.checkOut), 1);
    if (REVENUE_STATUSES_.indexOf(r.status) >= 0) {
      const n = overlapNights_(r.checkIn, r.checkOut, per.from, per.toExcl);
      if (n > 0) {
        const ratio = n / nights, acc = round2_(num_(r.totalPrice) * ratio), fees = round2_(num_(r.fees) * ratio), com = round2_(num_(r.commissionAmount) * ratio);
        row.accommodation += acc; row.expected += acc + fees; row.taxes += round2_(num_(r.taxes) * ratio); row.managementCommissions += com; row.bookedNights += n;
        // ventilation mensuelle nuit par nuit
        for (let d = r.checkIn > per.from ? r.checkIn : per.from; d < r.checkOut && d < per.toExcl; d = addDaysStr_(d, 1)) { const m = mk(d.slice(0, 7)); m.expected += (num_(r.totalPrice) + num_(r.fees)) / nights; m.bookedNights += 1; }
        const ag = r.agencyOrganizationId || "DIRECT";
        byAgency[ag] = byAgency[ag] || { agencyOrganizationId: ag, expected: 0, commissions: 0, reservations: 0, nights: 0 };
        byAgency[ag].expected += acc + fees; byAgency[ag].commissions += com; byAgency[ag].nights += n;
      }
      if (inP(r.checkIn)) { row.reservations++; if (byAgency[r.agencyOrganizationId || "DIRECT"]) byAgency[r.agencyOrganizationId || "DIRECT"].reservations++;
        const m = resvMoney_(r); row.billed += m.amountDue; row.outstanding += Math.max(0, m.balance); }
    }
    if (r.status === "CANCELLED" && inP(r.checkIn)) {
      row.cancellations++;
      const m = resvMoney_(r); const kept = round2_(Math.max(0, m.paid - num_(r.refundDue)));
      row.cancellationRetained += kept; row.expected += kept;
    }
  });
  // Loyers longue durée
  dbAll_("RentSchedules").filter(function (s) { return ids[String(s.propertyId)] && s.status === "OPEN" && inP(s.dueDate); }).forEach(function (s) {
    const row = rowsBy[s.propertyId], due = num_(s.amountDue), paid = rentPaid_(s.scheduleId);
    row.rentExpected += due; row.expected += due; row.billed += due; row.outstanding += Math.max(0, round2_(due - paid));
    mk(String(s.dueDate).slice(0, 7)).expected += due;
  });
  // Revenus divers saisis manuellement
  dbAll_("RevenueRecords").filter(function (v) { return ids[String(v.propertyId)] && v.status !== "CANCELLED" && inP(v.revenueDate); }).forEach(function (v) {
    rowsBy[v.propertyId].expected += num_(v.amount); mk(String(v.revenueDate).slice(0, 7)).expected += num_(v.amount);
  });
  // Paiements (trésorerie)
  dbAll_("Payments").filter(function (x) { return x.status === "RECORDED" && x.kind !== "SUBSCRIPTION" && ids[String(x.propertyId)] && inP(x.paidAt); }).forEach(function (x) {
    if (f.agencyOrganizationId && x.refType === "RESERVATION" && !resvIds[String(x.refId)]) return;
    const row = rowsBy[x.propertyId], m = mk(String(x.paidAt).slice(0, 7));
    if (x.direction === "IN") { row.collected += num_(x.amount); m.collected += num_(x.amount); } else { row.paidOut += num_(x.amount); m.paidOut += num_(x.amount); }
  });
  // Dépenses
  const expByCat = {};
  dbAll_("Expenses").filter(function (e) { return ids[String(e.propertyId)] && e.status !== "CANCELLED" && inP(e.expenseDate); }).forEach(function (e) {
    rowsBy[e.propertyId].expenses += num_(e.amount); mk(String(e.expenseDate).slice(0, 7)).expenses += num_(e.amount);
    expByCat[e.category] = round2_((expByCat[e.category] || 0) + num_(e.amount));
  });
  // Commissions prestataires (revenus des bénéficiaires, pas un coût propriétaire)
  const invCom = {};
  dbAll_("Invoices").filter(function (v) { return ids[String(v.propertyId)] && bool_(v.commissionLocked) && inP(String(v.approvedAt || v.issueDate)); }).forEach(function (v) {
    const k = v.commissionBeneficiaryOrgId || ""; invCom[k] = round2_((invCom[k] || 0) + num_(v.commissionAmount));
  });
  // Nuits disponibles
  const blocks = dbAll_("AvailabilityBlocks").filter(function (b) { return ids[String(b.propertyId)] && b.status === "ACTIVE"; });
  props.forEach(function (x) {
    const row = rowsBy[x.propertyId];
    if (x.rentalMode === "LONG_TERM" || ["ACTIVE", "MAINTENANCE"].indexOf(x.status) < 0) { row.availableNights = 0; }
    else {
      const created = String(x.createdAt || "").slice(0, 10), start = created && created > per.from ? created : per.from;
      let avail = start < per.toExcl ? diffDays_(start, per.toExcl) : 0;
      blocks.filter(function (b) { return String(b.propertyId) === String(x.propertyId); }).forEach(function (b) { avail -= overlapNights_(b.startDate, b.endDate, start, per.toExcl); });
      row.availableNights = Math.max(avail, row.bookedNights);
    }
    Object.keys(row).forEach(function (k) { if (typeof row[k] === "number") row[k] = round2_(row[k]); });
    row.result = round2_(row.expected - row.expenses - row.managementCommissions);
    row.occupancyRate = pct_(row.bookedNights, row.availableNights);
    row.adr = row.bookedNights ? round2_(row.accommodation / row.bookedNights) : null;
    row.revpar = row.availableNights ? round2_(row.accommodation / row.availableNights) : null;
  });
  const list = props.map(function (x) { return rowsBy[x.propertyId]; });
  const T = { expected: 0, accommodation: 0, rentExpected: 0, taxes: 0, billed: 0, collected: 0, paidOut: 0, outstanding: 0, expenses: 0, managementCommissions: 0, result: 0, bookedNights: 0, availableNights: 0, reservations: 0, cancellations: 0, cancellationRetained: 0 };
  list.forEach(function (r) { Object.keys(T).forEach(function (k) { T[k] = round2_(T[k] + num_(r[k])); }); });
  T.occupancyRate = pct_(T.bookedNights, T.availableNights);
  T.adr = T.bookedNights ? round2_(T.accommodation / T.bookedNights) : null;
  T.revpar = T.availableNights ? round2_(T.accommodation / T.availableNights) : null;
  T.netCashFlow = round2_(T.collected - T.paidOut);
  T.contractorCommissions = round2_(Object.keys(invCom).reduce(function (a, k) { return a + invCom[k]; }, 0));
  T.cancellationRate = pct_(T.cancellations, T.reservations + T.cancellations);
  const byOwner = {};
  list.forEach(function (r) { const o = byOwner[r.organizationId] = byOwner[r.organizationId] || { organizationId: r.organizationId, expected: 0, expenses: 0, managementCommissions: 0, result: 0 };
    o.expected = round2_(o.expected + r.expected); o.expenses = round2_(o.expenses + r.expenses); o.managementCommissions = round2_(o.managementCommissions + r.managementCommissions); o.result = round2_(o.result + r.result); });
  const orgNames = indexBy_(dbAll_("Organizations"), "organizationId");
  return { period: per, totals: T, byProperty: list,
    byMonth: Object.keys(months).sort().map(function (k) { const m = months[k]; return { month: k, expected: round2_(m.expected), collected: round2_(m.collected), paidOut: round2_(m.paidOut), expenses: round2_(m.expenses), net: round2_(m.collected - m.paidOut), bookedNights: m.bookedNights }; }),
    byAgency: Object.keys(byAgency).map(function (k) { const x = byAgency[k]; return { agencyOrganizationId: k, name: k === "DIRECT" ? "Direct (propriétaire)" : ((orgNames[k] || {}).name || k), expected: round2_(x.expected), commissions: round2_(x.commissions), reservations: x.reservations, nights: x.nights }; }),
    byOwner: Object.keys(byOwner).map(function (k) { return Object.assign({ name: (orgNames[k] || {}).name || k }, byOwner[k]); }),
    expensesByCategory: expByCat, contractorCommissionsByBeneficiary: invCom };
}

/* ------------------------------ Paiements ------------------------------ */
function paymentTarget_(p, refType, refId, kind) {
  if (refType === "RESERVATION") {
    const r = dbGet_("Reservations", safeText_(refId, 120));
    if (!r || !(canResv_(p, r, "reservation.edit") || canResv_(p, r, "finance.manage"))) throw new AppError("FORBIDDEN", "Réservation introuvable ou accès refusé.");
    oneOf_(kind, ["RESERVATION", "DEPOSIT", "REFUND", "DEPOSIT_REFUND"], "Type de paiement");
    return { propertyId: r.propertyId, organizationId: r.organizationId, row: r };
  }
  if (refType === "RENT_SCHEDULE") {
    const s = dbGet_("RentSchedules", safeText_(refId, 120)); if (!s) notFound_("Échéance");
    const prop = assertPropAny_(p, s.propertyId, ["lease.manage", "finance.manage"]);
    oneOf_(kind, ["RENT"], "Type de paiement");
    return { propertyId: prop.propertyId, organizationId: prop.organizationId, row: s };
  }
  if (refType === "LEASE") {
    const l = dbGet_("Leases", safeText_(refId, 120)); if (!l) notFound_("Bail");
    const prop = assertPropAny_(p, l.propertyId, ["lease.manage", "finance.manage"]);
    oneOf_(kind, ["DEPOSIT", "DEPOSIT_REFUND"], "Type de paiement");
    return { propertyId: prop.propertyId, organizationId: prop.organizationId, row: l };
  }
  if (refType === "INVOICE") {
    const v = dbGet_("Invoices", safeText_(refId, 120)); if (!v) notFound_("Facture");
    const prop = assertPropAny_(p, v.propertyId, ["invoice.manage", "finance.manage"]);
    oneOf_(kind, ["INVOICE"], "Type de paiement");
    return { propertyId: prop.propertyId, organizationId: prop.organizationId, row: v };
  }
  if (refType === "EXPENSE") {
    const e = dbGet_("Expenses", safeText_(refId, 120)); if (!e) notFound_("Dépense");
    const prop = assertPropAny_(p, e.propertyId, ["finance.manage"]);
    oneOf_(kind, ["OTHER"], "Type de paiement");
    return { propertyId: prop.propertyId, organizationId: prop.organizationId, row: e };
  }
  throw new AppError("VALIDATION", "Type de référence de paiement invalide.");
}
var PAY_DIRECTION_ = { RESERVATION: "IN", DEPOSIT: "IN", RENT: "IN", REFUND: "OUT", DEPOSIT_REFUND: "OUT", INVOICE: "OUT", OTHER: "OUT" };

function payRecord_(p, a) {
  const refType = String(a.refType || ""), kind = String(a.kind || "");
  const t = paymentTarget_(p, refType, a.refId, kind);
  assertOrgWritable_(t.organizationId);
  const amount = money_(a.amount, "Montant", { min: 0.01 });
  const paidAt = a.paidAt ? dateOnly_(a.paidAt, "Date de paiement") : todayStr_();
  assert_(paidAt <= todayStr_(), "La date de paiement ne peut pas être future.");
  if (a.proofDocId) { const d = dbGet_("Documents", a.proofDocId); assert_(d && d.status === "ACTIVE" && String(d.propertyId) === String(t.propertyId), "Justificatif invalide."); }
  return withLock_(function () {
    return idemRun_(a.requestKey, "PAYMENT_" + refType, t.organizationId, function () {
      if (refType === "RESERVATION") {
        const r = dbGet_("Reservations", t.row.reservationId), m = resvMoney_(r);
        if (kind === "REFUND") assert_(amount <= round2_(m.paid - m.refunded) + 0.001, "Remboursement supérieur aux sommes encaissées (" + round2_(m.paid - m.refunded) + ").");
        if (kind === "DEPOSIT_REFUND") assert_(amount <= m.depositHeld + 0.001, "Restitution supérieure à la caution détenue (" + m.depositHeld + ").");
        if (kind === "RESERVATION") assert_(["CANCELLED", "NO_SHOW"].indexOf(r.status) < 0 || a.allowOnCancelled === true, "Réservation annulée : confirmez l'encaissement explicitement.");
      }
      if (refType === "RENT_SCHEDULE") { const remaining = round2_(num_(t.row.amountDue) - rentPaid_(t.row.scheduleId)); assert_(amount <= remaining + 0.001, "Montant supérieur au restant dû (" + remaining + ")."); }
      if (refType === "INVOICE") { const v = dbGet_("Invoices", t.row.invoiceId); assert_(["APPROVED", "PARTIAL"].indexOf(v.status) >= 0, "La facture doit être approuvée.");
        const remaining = round2_(num_(v.netToContractor || v.amountTTC) - num_(v.paidAmount)); assert_(amount <= remaining + 0.001, "Montant supérieur au net restant dû (" + remaining + ")."); }
      if (refType === "LEASE" && kind === "DEPOSIT_REFUND") { const held = leaseDepositHeld_(t.row.leaseId); assert_(amount <= held + 0.001, "Restitution supérieure à la caution détenue (" + held + ")."); }
      const pay = dbInsert_("Payments", { organizationId: t.organizationId, propertyId: t.propertyId, kind: kind, refType: refType, refId: safeText_(a.refId, 120), direction: PAY_DIRECTION_[kind], amount: amount,
        currency: "MAD", method: oneOf_(a.method || "TRANSFER", PAY_METHODS_, "Mode de paiement"), paidAt: paidAt, reference: safeText_(a.reference, 120), proofDocId: safeText_(a.proofDocId || "", 120),
        status: "RECORDED", reconciled: false, note: safeText_(a.note, 500), idempotencyKey: safeText_(a.requestKey || "", 120), recordedBy: p.email, createdAt: nowIso_() });
      paymentRefresh_(pay);
      audit_("PAYMENT_RECORDED", "Payment", pay.paymentId, t.organizationId, { refType: refType, refId: a.refId, kind: kind, amount: amount });
      return { ok: true, paymentId: pay.paymentId, id: pay.paymentId };
    });
  });
}
function paymentRefresh_(pay) {
  if (pay.refType === "RESERVATION") resvRefreshPaymentStatus_(pay.refId);
  if (pay.refType === "INVOICE") invRefreshPaid_(pay.refId);
  if (pay.refType === "EXPENSE") {
    const e = dbGet_("Expenses", pay.refId);
    const paid = sumBy_(dbAll_("Payments").filter(function (x) { return x.refType === "EXPENSE" && String(x.refId) === String(pay.refId) && x.status === "RECORDED"; }), function (x) { return x.amount; });
    if (e) dbUpdate_("Expenses", e.expenseId, { status: paid + 0.005 >= num_(e.amount) ? "PAID" : (e.status === "PAID" ? "INVOICED" : e.status), paidAt: paid + 0.005 >= num_(e.amount) ? nowIso_() : "" });
  }
}
function payVoid_(p, a) {
  const pay = dbGet_("Payments", safeText_(a.paymentId, 120));
  if (!pay || pay.kind === "SUBSCRIPTION") notFound_("Paiement");
  paymentTarget_(p, pay.refType, pay.refId, pay.kind);
  assert_(pay.status === "RECORDED", "Paiement déjà annulé.");
  assert_(!bool_(pay.reconciled), "Paiement rapproché : annulez d'abord le rapprochement.");
  const reason = reqText_(a.reason, "Motif", 3, 300);
  withLock_(function () { dbUpdate_("Payments", pay.paymentId, { status: "VOID", voidedAt: nowIso_(), voidedBy: p.email, note: safeText_((pay.note ? pay.note + " | " : "") + "Annulé : " + reason, 500) }); paymentRefresh_(pay); });
  audit_("PAYMENT_VOIDED", "Payment", pay.paymentId, pay.organizationId, { reason: reason, amount: pay.amount });
  return { ok: true };
}
/** Rapprochement bancaire MANUEL (aucune connexion bancaire automatique n'existe). */
function payReconcile_(p, a) {
  const pay = dbGet_("Payments", safeText_(a.paymentId, 120));
  if (!pay || pay.kind === "SUBSCRIPTION") notFound_("Paiement");
  assertPropAny_(p, pay.propertyId, ["finance.manage"]);
  assert_(pay.status === "RECORDED", "Paiement annulé.");
  const on = a.reconciled !== false;
  dbUpdate_("Payments", pay.paymentId, { reconciled: on, reconciledAt: on ? nowIso_() : "", reconciledBy: on ? p.email : "", reference: a.bankReference ? safeText_(a.bankReference, 120) : pay.reference });
  audit_(on ? "PAYMENT_RECONCILED" : "PAYMENT_UNRECONCILED", "Payment", pay.paymentId, pay.organizationId, {});
  return { ok: true };
}
function payList_(p, a) {
  a = a || {};
  const allowed = {}; finScopeProps_(p, {}).forEach(function (x) { allowed[String(x.propertyId)] = x; });
  accessibleProps_(p, "reservation.edit").forEach(function (x) { allowed[String(x.propertyId)] = x; });
  const rows = dbAll_("Payments").filter(function (x) {
    if (x.kind === "SUBSCRIPTION" || !allowed[String(x.propertyId)]) return false;
    if (x.refType !== "RESERVATION" && !canProp_(p, allowed[String(x.propertyId)], "finance.view") && !canProp_(p, allowed[String(x.propertyId)], "lease.manage")) return false;
    if (a.propertyId && String(x.propertyId) !== String(a.propertyId)) return false;
    if (a.direction && x.direction !== a.direction) return false;
    if (a.kind && x.kind !== a.kind) return false;
    if (a.reconciled === true && !bool_(x.reconciled)) return false; if (a.reconciled === false && bool_(x.reconciled)) return false;
    if (a.from && x.paidAt < a.from) return false; if (a.to && x.paidAt > a.to) return false;
    if (!a.includeVoid && x.status === "VOID") return false;
    return matchesQuery_(a.q, [x.reference, x.refId, x.note]);
  }).sort(function (x, y) { return String(y.paidAt).localeCompare(String(x.paidAt)); })
    .map(function (x) { return { paymentId: x.paymentId, propertyId: x.propertyId, propertyName: (allowed[String(x.propertyId)] || {}).name, kind: x.kind, refType: x.refType, refId: x.refId, direction: x.direction,
      amount: x.amount, method: x.method, paidAt: x.paidAt, reference: x.reference, status: x.status, reconciled: x.reconciled, reconciledAt: x.reconciledAt, proofDocId: x.proofDocId, recordedBy: x.recordedBy, note: x.note }; });
  const page = pageOf_(rows, a);
  page.totals = { in: sumBy_(rows.filter(function (x) { return x.direction === "IN" && x.status === "RECORDED"; }), function (x) { return x.amount; }),
    out: sumBy_(rows.filter(function (x) { return x.direction === "OUT" && x.status === "RECORDED"; }), function (x) { return x.amount; }) };
  return page;
}

/* ------------------------------ Dépenses / revenus divers ------------------------------ */
function expCreate_(p, a) {
  const prop = assertProp_(p, a.propertyId, "finance.manage");
  const e = dbInsert_("Expenses", { organizationId: prop.organizationId, propertyId: prop.propertyId, category: oneOf_(a.category, getSetting_("list.expenseCategories", prop.organizationId), "Catégorie"),
    description: reqText_(a.description, "Description", 2, 300), supplier: safeText_(a.supplier, 120), amount: money_(a.amount, "Montant", { min: 0.01 }), vatAmount: a.vatAmount ? money_(a.vatAmount, "TVA") : 0,
    currency: "MAD", expenseDate: a.expenseDate ? dateOnly_(a.expenseDate, "Date") : todayStr_(), status: oneOf_(a.status || "INVOICED", ["PLANNED", "INVOICED"], "Statut"), refType: "MANUAL", refId: "",
    uniqueKey: "manual:" + newId_("x"), documentId: safeText_(a.documentId || "", 120), createdAt: nowIso_(), createdBy: p.email });
  audit_("EXPENSE_CREATED", "Expense", e.expenseId, prop.organizationId, { amount: e.amount, category: e.category });
  return { ok: true, expenseId: e.expenseId, id: e.expenseId };
}
function expCancel_(p, a) {
  const e = dbGet_("Expenses", safeText_(a.expenseId, 120)); if (!e) notFound_("Dépense");
  assertProp_(p, e.propertyId, "finance.manage");
  assert_(e.refType === "MANUAL" || e.refType === "CLEANING", "Les dépenses issues de factures se gèrent depuis la facture.");
  assert_(e.status !== "PAID", "Dépense déjà payée : annulez d'abord le paiement.");
  dbUpdate_("Expenses", e.expenseId, { status: "CANCELLED" });
  audit_("EXPENSE_CANCELLED", "Expense", e.expenseId, e.organizationId, {});
  return { ok: true };
}
function expList_(p, a) {
  a = a || {};
  const allowed = {}; finScopeProps_(p, {}).forEach(function (x) { allowed[String(x.propertyId)] = x; });
  const rows = dbAll_("Expenses").filter(function (e) {
    if (!allowed[String(e.propertyId)]) return false;
    if (a.propertyId && String(e.propertyId) !== String(a.propertyId)) return false;
    if (a.category && e.category !== a.category) return false;
    if (a.status && e.status !== a.status) return false; else if (!a.status && e.status === "CANCELLED") return false;
    if (a.from && e.expenseDate < a.from) return false; if (a.to && e.expenseDate > a.to) return false;
    return matchesQuery_(a.q, [e.description, e.supplier]);
  }).sort(function (x, y) { return String(y.expenseDate).localeCompare(String(x.expenseDate)); })
    .map(function (e) { return { expenseId: e.expenseId, propertyId: e.propertyId, propertyName: allowed[String(e.propertyId)].name, category: e.category, description: e.description, supplier: e.supplier, amount: e.amount,
      vatAmount: e.vatAmount, expenseDate: e.expenseDate, status: e.status, refType: e.refType, refId: e.refId, documentId: e.documentId }; });
  const page = pageOf_(rows, a);
  page.total = rows.length; page.sum = sumBy_(rows, function (x) { return x.amount; });
  return page;
}
function revCreate_(p, a) {
  const prop = assertProp_(p, a.propertyId, "finance.manage");
  const r = dbInsert_("RevenueRecords", { organizationId: prop.organizationId, propertyId: prop.propertyId, category: safeText_(a.category || "OTHER", 40).toUpperCase(), description: reqText_(a.description, "Description", 2, 300),
    amount: money_(a.amount, "Montant", { min: 0.01 }), currency: "MAD", revenueDate: a.revenueDate ? dateOnly_(a.revenueDate, "Date") : todayStr_(), status: "EXPECTED", createdAt: nowIso_(), createdBy: p.email });
  audit_("REVENUE_RECORD_CREATED", "RevenueRecord", r.revenueId, prop.organizationId, { amount: r.amount });
  return { ok: true, revenueId: r.revenueId };
}
function finSummary_(p, a) {
  const res = finCompute_(p, a || {});
  res.previous = finComputeForProps_(finScopeProps_(p, a || {}), previousPeriod_(res.period), a || {}).totals;
  return res;
}
