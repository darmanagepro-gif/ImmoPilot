/**
 * Locations longue durée : locataires, baux, échéancier, paiements partiels, retards, quittances, préavis, renouvellement,
 * fin de bail et restitution de caution.
 * Règles :
 *  - Une échéance n'est JAMAIS considérée payée parce que sa date est passée : seul un paiement enregistré (Payments, RENT) la solde.
 *  - Statut d'échéance calculé : PAID, PARTIAL, LATE (échéance + rent.graceDays dépassée avec solde), DUE, UPCOMING, CANCELLED.
 *  - Période mensuelle k : [début + k mois, début + k+1 mois). Échéance au jour dueDay du mois de début de période (borné à la période).
 *    Dernière période partielle proratisée au nombre de jours. Indexation annuelle à partir de nextIndexationDate.
 *  - Bail sans date de fin : échéancier glissant sur 12 mois, prolongé chaque jour par jobDaily.
 *  - Les modèles de contrat sont des modèles à faire valider localement par un professionnel : aucune conformité juridique n'est garantie.
 */
function rentPaid_(scheduleId) {
  return sumBy_(dbAll_("Payments").filter(function (x) { return x.refType === "RENT_SCHEDULE" && String(x.refId) === String(scheduleId) && x.status === "RECORDED" && x.kind === "RENT"; }), function (x) { return x.amount; });
}
function leaseDepositHeld_(leaseId) {
  const pays = dbAll_("Payments").filter(function (x) { return x.refType === "LEASE" && String(x.refId) === String(leaseId) && x.status === "RECORDED"; });
  return round2_(sumBy_(pays.filter(function (x) { return x.kind === "DEPOSIT"; }), function (x) { return x.amount; }) - sumBy_(pays.filter(function (x) { return x.kind === "DEPOSIT_REFUND"; }), function (x) { return x.amount; }));
}
function rentStatus_(s, today) {
  today = today || todayStr_();
  const paid = rentPaid_(s.scheduleId), due = num_(s.amountDue), remaining = round2_(Math.max(0, due - paid));
  let st;
  if (s.status === "CANCELLED") st = "CANCELLED";
  else if (remaining <= 0.005) st = "PAID";
  else if (addDaysStr_(s.dueDate, Number(getSetting_("rent.graceDays", s.organizationId)) || 0) < today) st = "LATE";
  else if (paid > 0) st = "PARTIAL";
  else if (s.dueDate <= today) st = "DUE";
  else st = "UPCOMING";
  return { scheduleId: s.scheduleId, leaseId: s.leaseId, propertyId: s.propertyId, period: s.period, dueDate: s.dueDate, rentAmount: s.rentAmount, chargesAmount: s.chargesAmount, amountDue: due,
    paid: paid, remaining: remaining, status: st, daysLate: st === "LATE" ? diffDays_(s.dueDate, today) : 0 };
}
/** Construction pure de l'échéancier (testée) : retourne les périodes manquantes jusqu'à untilDate. */
function buildRentPeriods_(lease, untilDate) {
  const out = [], start = lease.startDate, end = lease.endDate || "", dueDay = Math.min(Math.max(Number(lease.dueDay) || 1, 1), 28);
  for (let k = 0; k < 600; k++) {
    const ps = addMonthsStr_(start, k), pe = addMonthsStr_(start, k + 1);
    if (ps > untilDate || (end && ps > end)) break;
    let ratio = 1;
    if (end && addDaysStr_(end, 1) < pe) ratio = diffDays_(ps, addDaysStr_(end, 1)) / diffDays_(ps, pe);
    let factor = 1;
    if (num_(lease.indexationRate) > 0 && lease.nextIndexationDate && ps >= lease.nextIndexationDate) {
      const years = 1 + Math.floor(Math.max(0, diffDays_(lease.nextIndexationDate, ps)) / 365.25);
      factor = Math.pow(1 + num_(lease.indexationRate) / 100, years);
    }
    let due = ps.slice(0, 8) + ("0" + dueDay).slice(-2);
    if (due < ps) due = ps;
    if (due >= pe) due = addDaysStr_(pe, -1);
    const rent = round2_(num_(lease.monthlyRent) * factor * ratio), ch = round2_(num_(lease.charges) * ratio);
    out.push({ period: ps.slice(0, 7), periodStart: ps, dueDate: due, rentAmount: rent, chargesAmount: ch, amountDue: round2_(rent + ch) });
  }
  return out;
}
function leaseGenerateSchedules_(lease) {
  const until = lease.endDate || addMonthsStr_(todayStr_(), 12);
  const existing = {}; dbAll_("RentSchedules").forEach(function (s) { if (String(s.leaseId) === String(lease.leaseId)) existing[s.uniqueKey] = true; });
  const rows = buildRentPeriods_(lease, until).filter(function (x) { return !existing[lease.leaseId + ":" + x.period]; }).map(function (x) {
    return { organizationId: lease.organizationId, propertyId: lease.propertyId, leaseId: lease.leaseId, period: x.period, dueDate: x.dueDate, rentAmount: x.rentAmount, chargesAmount: x.chargesAmount,
      amountDue: x.amountDue, status: "OPEN", createdAt: nowIso_(), uniqueKey: lease.leaseId + ":" + x.period };
  });
  dbInsertMany_("RentSchedules", rows);
  return rows.length;
}

function leaseOut_(p, l, props, tenants) {
  const prop = (props || {})[String(l.propertyId)] || dbGet_("Properties", l.propertyId) || {}, t = (tenants || {})[String(l.tenantId)] || dbGet_("Tenants", l.tenantId) || {};
  const sched = dbAll_("RentSchedules").filter(function (s) { return String(s.leaseId) === String(l.leaseId) && s.status === "OPEN"; }).map(function (s) { return rentStatus_(s); });
  return { leaseId: l.leaseId, propertyId: l.propertyId, propertyName: prop.name, tenantId: l.tenantId, tenantName: t.fullName, tenantEmail: t.email, tenantPhone: t.phone, startDate: l.startDate, endDate: l.endDate,
    durationMonths: l.durationMonths, monthlyRent: l.monthlyRent, charges: l.charges, deposit: l.deposit, dueDay: l.dueDay, indexationRate: l.indexationRate, nextIndexationDate: l.nextIndexationDate, terms: l.terms,
    status: l.status, noticeDate: l.noticeDate, noticeBy: l.noticeBy, depositStatus: l.depositStatus, depositHeld: leaseDepositHeld_(l.leaseId), depositReturned: l.depositReturned, depositDeductions: l.depositDeductions,
    documentId: l.documentId, endReason: l.endReason, renewedFromLeaseId: l.renewedFromLeaseId,
    arrears: sumBy_(sched.filter(function (s) { return s.status === "LATE"; }), function (s) { return s.remaining; }), lateCount: sched.filter(function (s) { return s.status === "LATE"; }).length,
    nextDue: sched.filter(function (s) { return s.remaining > 0; }).sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); })[0] || null };
}
function leaseLoad_(p, id, cap) {
  const l = dbGet_("Leases", safeText_(id, 120));
  if (!l) throw new AppError("FORBIDDEN", "Bail introuvable ou accès refusé.");
  const prop = dbGet_("Properties", l.propertyId);
  const self = myTenantIds_(p).indexOf(String(l.tenantId)) >= 0;
  if (!(canProp_(p, prop, cap) || (cap === "lease.view" && self))) throw new AppError("FORBIDDEN", "Bail introuvable ou accès refusé.");
  if (cap === "lease.manage") { assertOrgWritable_(l.organizationId); assertFeature_(l.organizationId, "leases"); }
  return { l: l, prop: prop, self: self };
}

/* ------------------------------ Locataires ------------------------------ */
function tenantList_(p, a) {
  a = a || {};
  const orgs = p.roles.filter(function (r) { return r.caps.indexOf("lease.manage") >= 0 || r.caps.indexOf("lease.view") >= 0; }).map(function (r) { return r.organizationId; });
  const viaLease = {}; dbAll_("Leases").forEach(function (l) { if (canProp_(p, dbGet_("Properties", l.propertyId), "lease.view")) viaLease[String(l.tenantId)] = true; });
  const rows = dbAll_("Tenants").filter(function (t) {
    if (!(viaLease[String(t.tenantId)] || (orgs.indexOf(String(t.organizationId)) >= 0 && hasOrgCap_(p, t.organizationId, "lease.manage")))) return false;
    if (a.status && t.status !== a.status) return false;
    return matchesQuery_(a.q, [t.fullName, t.email, t.phone]);
  }).sort(function (x, y) { return String(x.fullName).localeCompare(String(y.fullName)); })
    .map(function (t) { return { tenantId: t.tenantId, organizationId: t.organizationId, fullName: t.fullName, email: t.email, phone: t.phone, nationality: t.nationality, status: t.status, hasAccount: !!t.userId,
      activeLeases: dbAll_("Leases").filter(function (l) { return String(l.tenantId) === String(t.tenantId) && ["ACTIVE", "NOTICE"].indexOf(l.status) >= 0; }).length }; });
  return pageOf_(rows, a);
}
function tenantOrg_(p, a) {
  if (a.propertyId) { const prop = assertProp_(p, a.propertyId, "lease.manage"); return String(prop.organizationId); }
  const orgId = safeText_(a.organizationId, 120); assertOrgCap_(p, orgId, "lease.manage"); return orgId;
}
function tenantCreate_(p, a) {
  const orgId = tenantOrg_(p, a);
  assertFeature_(orgId, "leases");
  const email = a.email ? validateEmail_(a.email) : "";
  const u = email ? dbAll_("Users").find(function (x) { return normalizeEmail_(x.email) === email; }) : null;
  const t = dbInsert_("Tenants", { organizationId: orgId, userId: u && dbAll_("UserRoles").some(function (r) { return String(r.userId) === String(u.userId) && r.role === "TENANT" && r.status === "ACTIVE"; }) ? u.userId : "",
    fullName: reqText_(a.fullName, "Nom complet", 2, 120), email: email, phone: safeText_(a.phone, 30), nationality: safeText_(a.nationality, 60), idType: a.idType ? oneOf_(a.idType, idTypes_(), "Pièce") : "",
    status: "ACTIVE", createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_() });
  audit_("TENANT_CREATED", "Tenant", t.tenantId, orgId, {});
  return { ok: true, tenantId: t.tenantId, id: t.tenantId };
}
function tenantUpdate_(p, a) {
  const t = dbGet_("Tenants", safeText_(a.tenantId, 120)); if (!t) notFound_("Locataire");
  assertOrgCap_(p, t.organizationId, "lease.manage");
  const patch = { updatedAt: nowIso_() };
  if (a.fullName !== undefined) patch.fullName = reqText_(a.fullName, "Nom", 2, 120);
  if (a.email !== undefined) patch.email = a.email ? validateEmail_(a.email) : "";
  if (a.phone !== undefined) patch.phone = safeText_(a.phone, 30);
  if (a.nationality !== undefined) patch.nationality = safeText_(a.nationality, 60);
  if (a.status !== undefined) patch.status = oneOf_(a.status, ["ACTIVE", "INACTIVE"], "Statut");
  dbUpdate_("Tenants", t.tenantId, patch);
  audit_("TENANT_UPDATED", "Tenant", t.tenantId, t.organizationId, { fields: Object.keys(patch) });
  return { ok: true };
}

/* ------------------------------ Baux ------------------------------ */
function leaseInput_(a, l) {
  const o = {};
  if (a.startDate !== undefined) o.startDate = dateOnly_(a.startDate, "Date de début");
  if (a.endDate !== undefined) o.endDate = a.endDate ? dateOnly_(a.endDate, "Date de fin") : "";
  if (a.monthlyRent !== undefined) o.monthlyRent = money_(a.monthlyRent, "Loyer", { min: 1 });
  if (a.charges !== undefined) o.charges = a.charges === "" ? 0 : money_(a.charges, "Charges");
  if (a.deposit !== undefined) o.deposit = a.deposit === "" ? 0 : money_(a.deposit, "Caution");
  if (a.dueDay !== undefined) { const d = parseInt(a.dueDay, 10); assert_(d >= 1 && d <= 28, "Jour d'échéance de 1 à 28."); o.dueDay = d; }
  if (a.indexationRate !== undefined) o.indexationRate = a.indexationRate === "" ? 0 : rate_(a.indexationRate, "Indexation");
  if (a.nextIndexationDate !== undefined) o.nextIndexationDate = a.nextIndexationDate ? dateOnly_(a.nextIndexationDate, "Date d'indexation") : "";
  if (a.terms !== undefined) o.terms = safeText_(a.terms, 20000);
  const s = o.startDate || (l && l.startDate), e = o.endDate !== undefined ? o.endDate : (l && l.endDate);
  if (s && e) { assert_(e > s, "La fin doit être postérieure au début."); o.durationMonths = Math.max(1, Math.round(diffDays_(s, e) / 30.44)); }
  else if (o.endDate === "") o.durationMonths = "";
  if (o.indexationRate > 0 && !o.nextIndexationDate && !(l && l.nextIndexationDate) && s) o.nextIndexationDate = addMonthsStr_(s, 12);
  return o;
}
function leaseList_(p, a) {
  a = a || {};
  const props = indexBy_(dbAll_("Properties"), "propertyId"), tenants = indexBy_(dbAll_("Tenants"), "tenantId"), mine = myTenantIds_(p);
  const rows = dbAll_("Leases").filter(function (l) {
    if (!(canProp_(p, props[String(l.propertyId)], "lease.view") || mine.indexOf(String(l.tenantId)) >= 0)) return false;
    if (a.status) { if (String(a.status).split(",").indexOf(l.status) < 0) return false; }
    if (a.propertyId && String(l.propertyId) !== String(a.propertyId)) return false;
    return matchesQuery_(a.q, [(tenants[String(l.tenantId)] || {}).fullName, (props[String(l.propertyId)] || {}).name]);
  }).sort(function (x, y) { return String(y.startDate).localeCompare(String(x.startDate)); });
  const page = pageOf_(rows, a);
  page.items = page.items.map(function (l) { return leaseOut_(p, l, props, tenants); });
  return page;
}
function leaseGet_(p, a) {
  const x = leaseLoad_(p, a.leaseId, "lease.view");
  const o = leaseOut_(p, x.l);
  o.canManage = canProp_(p, x.prop, "lease.manage"); o.isTenant = x.self;
  o.schedules = dbAll_("RentSchedules").filter(function (s) { return String(s.leaseId) === String(x.l.leaseId); }).map(function (s) { return rentStatus_(s); }).sort(function (u, v) { return String(u.dueDate).localeCompare(String(v.dueDate)); });
  o.payments = dbAll_("Payments").filter(function (z) { return (z.refType === "LEASE" && String(z.refId) === String(x.l.leaseId)) || (z.refType === "RENT_SCHEDULE" && o.schedules.some(function (s) { return s.scheduleId === z.refId; })); })
    .map(function (z) { return { paymentId: z.paymentId, kind: z.kind, refId: z.refId, amount: z.amount, paidAt: z.paidAt, method: z.method, status: z.status, reference: z.reference }; });
  o.documents = docList_(p, { ownerType: "LEASE", ownerId: x.l.leaseId });
  if (o.canManage) o.history = auditHistory_("Lease", x.l.leaseId, 30);
  return o;
}
function leaseCreate_(p, a) {
  const prop = assertProp_(p, a.propertyId, "lease.manage");
  assertFeature_(prop.organizationId, "leases");
  assert_(prop.rentalMode !== "SHORT_TERM", "Ce bien est configuré en courte durée uniquement : passez-le en « Longue durée » ou « Mixte ».");
  const t = dbGet_("Tenants", safeText_(a.tenantId, 120));
  assert_(t && t.status === "ACTIVE" && String(t.organizationId) === String(prop.organizationId), "Locataire inconnu pour l'organisation de ce bien.");
  const d = leaseInput_(a, null);
  assert_(d.startDate && d.monthlyRent, "Date de début et loyer obligatoires.");
  const l = dbInsert_("Leases", Object.assign({ charges: 0, deposit: 0, dueDay: 5, indexationRate: 0 }, d, { organizationId: prop.organizationId, propertyId: prop.propertyId, tenantId: t.tenantId, status: "DRAFT",
    depositStatus: num_(d.deposit) > 0 ? "EXPECTED" : "NONE", createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_(), updatedBy: p.email }));
  audit_("LEASE_CREATED", "Lease", l.leaseId, prop.organizationId, { monthlyRent: l.monthlyRent, startDate: l.startDate });
  return { ok: true, leaseId: l.leaseId, id: l.leaseId };
}
function leaseUpdate_(p, a) {
  const x = leaseLoad_(p, a.leaseId, "lease.manage");
  if (x.l.status !== "DRAFT") ["startDate", "monthlyRent", "charges", "deposit", "dueDay"].forEach(function (k) { assert_(a[k] === undefined, "Bail actif : « " + k + " » n'est modifiable que par renouvellement ou avenant."); });
  const d = leaseInput_(a, x.l); d.updatedAt = nowIso_(); d.updatedBy = p.email;
  dbUpdate_("Leases", x.l.leaseId, d);
  audit_("LEASE_UPDATED", "Lease", x.l.leaseId, x.l.organizationId, diff_(x.l, d, Object.keys(d).filter(function (k) { return ["updatedAt", "updatedBy", "terms"].indexOf(k) < 0; })));
  if (x.l.status === "ACTIVE" && (d.endDate !== undefined || d.indexationRate !== undefined)) leaseGenerateSchedules_(dbGet_("Leases", x.l.leaseId));
  return { ok: true };
}
function leaseActivate_(p, a) {
  const x = leaseLoad_(p, a.leaseId, "lease.manage");
  return withLock_(function () {
    const l = dbGet_("Leases", x.l.leaseId);
    assert_(l.status === "DRAFT", "Seul un bail en brouillon peut être activé.");
    const s = localToDate_(l.startDate, "00:00").getTime(), e = l.endDate ? localToDate_(addDaysStr_(l.endDate, 1), "00:00").getTime() : 8.64e15;
    const other = dbAll_("Leases").find(function (o) { return String(o.propertyId) === String(l.propertyId) && o.leaseId !== l.leaseId && ["ACTIVE", "NOTICE"].indexOf(o.status) >= 0 &&
      o.startDate <= (l.endDate || "9999-12-31") && (!o.endDate || o.endDate >= l.startDate); });
    assert_(!other, "Un autre bail actif couvre cette période.", "CONFLICT");
    const r = dbAll_("Reservations").find(function (z) { return String(z.propertyId) === String(l.propertyId) && RESV_BLOCKING_.indexOf(z.status) >= 0 && z.status !== "COMPLETED" && resvStartMs_(z, x.prop) < e && resvEndMs_(z, x.prop) > s; });
    assert_(!r, "Des réservations courte durée existent sur cette période (" + (r ? r.checkIn + " → " + r.checkOut : "") + ").", "CONFLICT");
    dbUpdate_("Leases", l.leaseId, { status: "ACTIVE", updatedAt: nowIso_(), updatedBy: p.email });
    const n = leaseGenerateSchedules_(dbGet_("Leases", l.leaseId));
    audit_("LEASE_ACTIVATED", "Lease", l.leaseId, l.organizationId, { schedules: n });
    return { ok: true, schedulesCreated: n };
  });
}
function leaseNotice_(p, a) {
  const x = leaseLoad_(p, a.leaseId, "lease.manage");
  assert_(x.l.status === "ACTIVE", "Préavis possible uniquement sur un bail actif.");
  const notice = a.noticeDate ? dateOnly_(a.noticeDate, "Date du préavis") : todayStr_(), endDate = dateOnly_(a.plannedEndDate, "Date de fin prévue");
  assert_(endDate >= notice, "La fin prévue doit suivre le préavis.");
  dbUpdate_("Leases", x.l.leaseId, { status: "NOTICE", noticeDate: notice, noticeBy: oneOf_(a.noticeBy || "TENANT", ["TENANT", "LANDLORD"], "Origine"), endDate: endDate, updatedAt: nowIso_(), updatedBy: p.email });
  audit_("LEASE_NOTICE", "Lease", x.l.leaseId, x.l.organizationId, { endDate: endDate });
  leaseCancelSchedulesAfter_(x.l.leaseId, endDate);
  return { ok: true };
}
function leaseCancelSchedulesAfter_(leaseId, endDate) {
  let n = 0;
  dbAll_("RentSchedules").filter(function (s) { return String(s.leaseId) === String(leaseId) && s.status === "OPEN" && s.dueDate > endDate && rentPaid_(s.scheduleId) <= 0; })
    .forEach(function (s) { dbUpdate_("RentSchedules", s.scheduleId, { status: "CANCELLED" }); n++; });
  return n;
}
function leaseEnd_(p, a) {
  const x = leaseLoad_(p, a.leaseId, "lease.manage");
  assert_(["ACTIVE", "NOTICE"].indexOf(x.l.status) >= 0, "Bail non actif.");
  const end = a.endDate ? dateOnly_(a.endDate, "Date de fin") : todayStr_();
  assert_(end >= x.l.startDate, "Date de fin antérieure au début.");
  dbUpdate_("Leases", x.l.leaseId, { status: "ENDED", endDate: end, endReason: safeText_(a.reason, 300), depositStatus: leaseDepositHeld_(x.l.leaseId) > 0 ? "TO_RETURN" : x.l.depositStatus, updatedAt: nowIso_(), updatedBy: p.email });
  const cancelled = leaseCancelSchedulesAfter_(x.l.leaseId, end);
  const open = dbAll_("RentSchedules").filter(function (s) { return String(s.leaseId) === String(x.l.leaseId) && s.status === "OPEN"; }).map(function (s) { return rentStatus_(s); }).filter(function (s) { return s.remaining > 0; });
  audit_("LEASE_ENDED", "Lease", x.l.leaseId, x.l.organizationId, { endDate: end, schedulesCancelled: cancelled, unpaid: open.length });
  return { ok: true, schedulesCancelled: cancelled, unpaidSchedules: open.length, unpaidAmount: sumBy_(open, function (s) { return s.remaining; }), depositHeld: leaseDepositHeld_(x.l.leaseId) };
}
function leaseRenew_(p, a) {
  const x = leaseLoad_(p, a.leaseId, "lease.manage");
  assert_(["ACTIVE", "NOTICE"].indexOf(x.l.status) >= 0 && x.l.endDate, "Renouvellement possible pour un bail actif à durée déterminée.");
  const start = a.startDate ? dateOnly_(a.startDate, "Début") : addDaysStr_(x.l.endDate, 1);
  assert_(start > x.l.endDate, "Le nouveau bail doit commencer après la fin de l'actuel.");
  const d = leaseInput_({ startDate: start, endDate: a.endDate || addDaysStr_(addMonthsStr_(start, 12), -1), monthlyRent: a.monthlyRent || x.l.monthlyRent, charges: a.charges !== undefined ? a.charges : x.l.charges,
    deposit: x.l.deposit, dueDay: x.l.dueDay, indexationRate: x.l.indexationRate, terms: a.terms !== undefined ? a.terms : x.l.terms }, null);
  return withLock_(function () {
    const n = dbInsert_("Leases", Object.assign(d, { organizationId: x.l.organizationId, propertyId: x.l.propertyId, tenantId: x.l.tenantId, status: "ACTIVE", depositStatus: x.l.depositStatus,
      renewedFromLeaseId: x.l.leaseId, createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_(), updatedBy: p.email }));
    // La caution détenue est transférée comptablement : on journalise sans créer de flux financier fictif.
    dbUpdate_("Leases", x.l.leaseId, { status: "RENEWED", updatedAt: nowIso_(), updatedBy: p.email });
    const s = leaseGenerateSchedules_(dbGet_("Leases", n.leaseId));
    audit_("LEASE_RENEWED", "Lease", n.leaseId, n.organizationId, { from: x.l.leaseId, schedules: s });
    return { ok: true, leaseId: n.leaseId, schedulesCreated: s, note: "La caution du bail précédent reste rattachée à celui-ci : restituez-la ou reportez-la explicitement." };
  });
}
/** Restitution de caution : paiement sortant réel + retenues justifiées. */
function leaseDepositReturn_(p, a) {
  const x = leaseLoad_(p, a.leaseId, "lease.manage");
  assert_(["ENDED", "NOTICE", "RENEWED"].indexOf(x.l.status) >= 0, "La caution se restitue en fin de bail.");
  const held = leaseDepositHeld_(x.l.leaseId);
  const ret = money_(a.amountReturned, "Montant restitué"), ded = round2_(held - ret);
  assert_(ret <= held + 0.001, "Montant supérieur à la caution détenue (" + held + ").");
  if (ded > 0) reqText_(a.deductionReason, "Motif des retenues", 3, 500);
  let paymentId = "";
  if (ret > 0) paymentId = payRecord_(p, { refType: "LEASE", refId: x.l.leaseId, kind: "DEPOSIT_REFUND", amount: ret, method: a.method || "TRANSFER", paidAt: a.paidAt, reference: a.reference, requestKey: a.requestKey }).paymentId;
  dbUpdate_("Leases", x.l.leaseId, { depositReturned: round2_(num_(x.l.depositReturned) + ret), depositDeductions: ded, depositStatus: ded > 0 ? "PARTIALLY_RETURNED" : "RETURNED", updatedAt: nowIso_(), updatedBy: p.email });
  if (ded > 0) dbInsertUnique_("RevenueRecords", "description", "Retenue sur caution bail " + x.l.leaseId, { organizationId: x.l.organizationId, propertyId: x.l.propertyId, category: "DEPOSIT_DEDUCTION",
    amount: ded, currency: cur_(), revenueDate: todayStr_(), status: "RECEIVED", receivedAt: nowIso_(), createdAt: nowIso_(), createdBy: p.email });
  audit_("LEASE_DEPOSIT_RETURNED", "Lease", x.l.leaseId, x.l.organizationId, { returned: ret, deductions: ded, reason: safeText_(a.deductionReason, 500) });
  return { ok: true, returned: ret, deductions: ded, paymentId: paymentId };
}
/** Quittance : uniquement pour une échéance intégralement payée. */
function leaseReceipt_(p, a) {
  const s = dbGet_("RentSchedules", safeText_(a.scheduleId, 120));
  if (!s) notFound_("Échéance");
  const x = leaseLoad_(p, s.leaseId, "lease.view");
  const st = rentStatus_(s);
  assert_(st.status === "PAID", "Quittance disponible uniquement pour une échéance entièrement réglée (statut : " + st.status + ").");
  const t = dbGet_("Tenants", x.l.tenantId) || {}, org = dbGet_("Organizations", x.l.organizationId) || {};
  const pays = dbAll_("Payments").filter(function (z) { return z.refType === "RENT_SCHEDULE" && String(z.refId) === String(s.scheduleId) && z.status === "RECORDED"; });
  const map = { bailleur: org.name, locataire: t.fullName, bien: x.prop.name, adresse: (x.prop.address || "") + " " + (x.prop.city || ""), periode: s.period, loyer: s.rentAmount, charges: s.chargesAmount, total: s.amountDue,
    date_paiement: pays.map(function (z) { return z.paidAt; }).join(", "), date: todayStr_() };
  const tpl = getSetting_("template.receiptDocId", x.l.organizationId);
  const pdf = tpl ? docFromTemplate_(tpl, map, propertyFolder_(x.l.organizationId, x.l.propertyId, "LEASE"), "Quittance_" + s.period + "_" + x.l.leaseId).pdf :
    htmlToPdf_(pdfShell_("Quittance de loyer — " + s.period, "<p>Je soussigné(e), " + escapeHtml_(org.name) + ", bailleur, déclare avoir reçu de <b>" + escapeHtml_(t.fullName) + "</b> la somme de <b>" + s.amountDue + " MAD</b> au titre du loyer et des charges de la période " + escapeHtml_(s.period) + " pour le logement : " + escapeHtml_(map.bien + " — " + map.adresse) + ".</p>" +
      htmlTable_(["Poste", "Montant (MAD)"], [["Loyer", s.rentAmount], ["Charges", s.chargesAmount], ["Total", s.amountDue]]) + "<p>Paiement(s) reçu(s) le : " + escapeHtml_(map.date_paiement) + "</p><p class='muted'>Document généré automatiquement — modèle à valider localement.</p>"), "Quittance_" + s.period);
  audit_("RENT_RECEIPT_GENERATED", "Lease", x.l.leaseId, x.l.organizationId, { period: s.period });
  return storeGeneratedPdf_(p, pdf, { propertyId: x.l.propertyId, organizationId: x.l.organizationId }, "LEASE", x.l.leaseId, "RECEIPT");
}
/** Contrat de bail généré depuis un modèle Google Docs ({{balises}}) ou un gabarit intégré. */
function leaseDocument_(p, a) {
  const x = leaseLoad_(p, a.leaseId, "lease.manage");
  const t = dbGet_("Tenants", x.l.tenantId) || {}, org = dbGet_("Organizations", x.l.organizationId) || {};
  const map = { bailleur: org.name, locataire: t.fullName, locataire_email: t.email, bien: x.prop.name, adresse: (x.prop.address || "") + " " + (x.prop.city || ""), surface: x.prop.surfaceM2, debut: x.l.startDate,
    fin: x.l.endDate || "indéterminée", loyer: x.l.monthlyRent, charges: x.l.charges, caution: x.l.deposit, jour_echeance: x.l.dueDay, indexation: x.l.indexationRate, conditions: x.l.terms, date: todayStr_() };
  const tpl = getSetting_("template.leaseDocId", x.l.organizationId);
  const pdf = tpl ? docFromTemplate_(tpl, map, propertyFolder_(x.l.organizationId, x.l.propertyId, "LEASE"), "Bail_" + x.l.leaseId).pdf :
    htmlToPdf_(pdfShell_("Contrat de location", "<p class='muted'>MODÈLE INDICATIF — à faire valider par un professionnel du " + escapeHtml_(edition_().leaseLaw) + " avant signature. ImmoPilot ne garantit pas la conformité juridique.</p>" +
      htmlTable_(["Clause", "Contenu"], Object.keys(map).map(function (k) { return [k, map[k] == null ? "" : map[k]]; })) + "<p>Fait à " + escapeHtml_(x.prop.city || "") + ", le " + todayStr_() + "</p><p>Signature bailleur : ______________ &nbsp; Signature locataire : ______________</p>"), "Bail_" + x.l.leaseId);
  const out = storeGeneratedPdf_(p, pdf, { propertyId: x.l.propertyId, organizationId: x.l.organizationId }, "LEASE", x.l.leaseId, "CONTRACT");
  dbUpdate_("Leases", x.l.leaseId, { documentId: out.documentId });
  audit_("LEASE_DOCUMENT_GENERATED", "Lease", x.l.leaseId, x.l.organizationId, { template: !!tpl });
  return out;
}
/** Espace locataire : ses baux, échéances et documents uniquement. */
function leaseMine_(p) {
  const ids = myTenantIds_(p);
  return dbAll_("Leases").filter(function (l) { return ids.indexOf(String(l.tenantId)) >= 0 && l.status !== "DRAFT"; }).map(function (l) { return leaseGet_(p, { leaseId: l.leaseId }); });
}

/** Tâche quotidienne : prolongation des échéanciers glissants et alertes (échéances, retards, fins de bail). */
function leaseJob_() {
  const today = todayStr_(); let created = 0, alerts = 0;
  dbAll_("Leases").filter(function (l) { return ["ACTIVE", "NOTICE"].indexOf(l.status) >= 0; }).forEach(function (l) {
    if (!l.endDate) created += leaseGenerateSchedules_(l);
    const prop = dbGet_("Properties", l.propertyId); if (!prop) return;
    const t = dbGet_("Tenants", l.tenantId) || {};
    const managers = propertyManagers_(prop, "canManageOperations");
    const before = Number(getSetting_("alerts.rentDueDays", l.organizationId)) || 3;
    dbAll_("RentSchedules").filter(function (s) { return String(s.leaseId) === String(l.leaseId) && s.status === "OPEN"; }).forEach(function (s) {
      const st = rentStatus_(s, today);
      if (st.remaining > 0 && s.dueDate === addDaysStr_(today, before) && t.userId) { notify_({ eventKey: "rent-due:" + s.scheduleId, userIds: [t.userId], type: "RENT_DUE", organizationId: l.organizationId,
        title: "Échéance de loyer le " + s.dueDate, body: st.remaining + " MAD — " + prop.name, link: "#mylease" }); alerts++; }
      if (st.status === "LATE") { notify_({ eventKey: "rent-late:" + s.scheduleId + ":" + Math.floor(st.daysLate / 7), userIds: managers.concat(t.userId ? [t.userId] : []), type: "RENT_LATE", organizationId: l.organizationId,
        title: "Loyer en retard (" + st.daysLate + " j) : " + prop.name, body: (t.fullName || "") + " — reste dû " + st.remaining + " MAD (période " + s.period + ").", link: "#lease/" + l.leaseId }); alerts++; }
    });
    if (l.endDate) (getSetting_("alerts.leaseEndDays", l.organizationId) || [60, 30]).forEach(function (d) {
      if (l.endDate === addDaysStr_(today, d)) { notify_({ eventKey: "lease-end:" + l.leaseId + ":" + d, userIds: managers, type: "LEASE_ENDING", organizationId: l.organizationId,
        title: "Fin de bail dans " + d + " jours : " + prop.name, body: (t.fullName || "") + " — fin le " + l.endDate + ". Préparez renouvellement ou état des lieux.", link: "#lease/" + l.leaseId }); alerts++; }
    });
  });
  return { schedulesCreated: created, alerts: alerts };
}
