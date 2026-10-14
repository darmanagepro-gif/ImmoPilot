/**
 * Réservations courte durée.
 *
 * RÈGLE DES DATES ET HEURES (documentée dans ARCHITECTURE.md) :
 *  - checkIn / checkOut : dates locales AAAA-MM-JJ dans le fuseau du projet (Africa/Casablanca par défaut).
 *  - L'arrivée a lieu à l'heure d'arrivée du bien (ou paramètre reservation.defaultCheckIn, 15:00),
 *    le départ à l'heure de départ (reservation.defaultCheckOut, 11:00). Les instants sont stockés en UTC (checkInAt / checkOutAt).
 *  - Deux séjours sont en conflit si [arrivée, départ + battement) se chevauchent, le battement étant
 *    minTurnaroundMinutes (bien) ou reservation.minTurnaroundMinutes (120 min). Un départ à 11:00 et une arrivée
 *    le même jour à 15:00 sont donc AUTORISÉS ; une arrivée à 12:00 le même jour serait refusée.
 *  - Un blocage de calendrier couvre [début 12:00, fin 12:00) : la date de fin est le jour de libération.
 *  - Un bail longue durée actif sur le bien bloque les réservations courte durée sur sa période.
 *  - Statuts bloquants : PENDING, CONFIRMED, IN_PROGRESS, COMPLETED. DRAFT, CANCELLED et NO_SHOW ne bloquent pas.
 *  - La vérification est refaite côté serveur SOUS VERROU (LockService) avec relecture des données : deux requêtes
 *    simultanées, même issues de comptes ou d'agences différents, ne peuvent pas créer de double réservation.
 */
var RESV_BLOCKING_ = ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED"];
var RESV_TRANSITIONS_ = { DRAFT: ["PENDING", "CONFIRMED", "CANCELLED"], PENDING: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["IN_PROGRESS", "CANCELLED", "NO_SHOW", "PENDING"],
  IN_PROGRESS: ["COMPLETED"], COMPLETED: [], CANCELLED: [], NO_SHOW: [] };
var RESV_SOURCES_ = ["DIRECT", "AIRBNB", "BOOKING", "EXPEDIA", "PHONE", "AGENCY", "WEBSITE", "OTHER"];

/** Idempotence : une même clé de requête ne produit qu'un seul effet (double clic, réseau instable). À appeler sous verrou. */
function idemRun_(key, op, orgId, fn) {
  if (!key) return fn();
  key = safeText_(key, 120);
  assert_(/^[\w-]{12,120}$/.test(key), "Clé de requête invalide.");
  const old = dbGet_("OperationRequests", key);
  if (old) { assert_(old.operation === op, "Clé déjà utilisée pour une autre opération."); return { ok: true, duplicate: true, id: old.resourceId }; }
  const res = fn();
  dbInsert_("OperationRequests", { requestKey: key, organizationId: orgId || "", operation: op, resourceId: (res && (res.id || res.reservationId || res.paymentId)) || "", createdAt: nowIso_() });
  return res;
}

function resvTimes_(prop, checkIn, checkOut, inTime, outTime) {
  const tin = inTime || prop.checkInTime || getSetting_("reservation.defaultCheckIn", prop.organizationId);
  const tout = outTime || prop.checkOutTime || getSetting_("reservation.defaultCheckOut", prop.organizationId);
  [tin, tout].forEach(function (t) { assert_(/^([01]\d|2[0-3]):[0-5]\d$/.test(t), "Heure invalide (HH:MM)."); });
  const s = localToDate_(checkIn, tin), e = localToDate_(checkOut, tout);
  assert_(e.getTime() > s.getTime(), "Le départ doit être postérieur à l'arrivée.");
  return { start: s, end: e };
}
function resvStartMs_(r, prop) { const d = parseTs_(r.checkInAt) || localToDate_(r.checkIn, (prop && prop.checkInTime) || DEFAULT_SETTINGS["reservation.defaultCheckIn"]); return d.getTime(); }
function resvEndMs_(r, prop) { const d = parseTs_(r.checkOutAt) || localToDate_(r.checkOut, (prop && prop.checkOutTime) || DEFAULT_SETTINGS["reservation.defaultCheckOut"]); return d.getTime(); }
function turnaroundMs_(prop) {
  const v = prop.minTurnaroundMinutes !== null && prop.minTurnaroundMinutes !== "" ? Number(prop.minTurnaroundMinutes) : Number(getSetting_("reservation.minTurnaroundMinutes", prop.organizationId));
  return (isFinite(v) ? v : 120) * 60000;
}
/** Recherche de conflit (réservations, blocages, baux). Pure lecture : appeler sous verrou avant écriture. */
function findConflict_(prop, startMs, endMs, ignoreId) {
  const turn = turnaroundMs_(prop), pid = String(prop.propertyId);
  const r = dbAll_("Reservations").find(function (x) {
    if (String(x.propertyId) !== pid || RESV_BLOCKING_.indexOf(x.status) < 0 || String(x.reservationId) === String(ignoreId || "")) return false;
    const s = resvStartMs_(x, prop), e = resvEndMs_(x, prop);
    return startMs < e + turn && s < endMs + turn;
  });
  if (r) return { reason: "RESERVATION_CONFLICT", message: "Conflit avec une réservation existante (" + r.checkIn + " → " + r.checkOut + ").", conflict: { reservationId: r.reservationId, checkIn: r.checkIn, checkOut: r.checkOut } };
  const b = dbAll_("AvailabilityBlocks").find(function (x) {
    if (String(x.propertyId) !== pid || x.status !== "ACTIVE") return false;
    const s = localToDate_(x.startDate, "12:00").getTime(), e = localToDate_(x.endDate, "12:00").getTime();
    return startMs < e && s < endMs;
  });
  if (b) return { reason: "BLOCKED_PERIOD", message: "Période bloquée (" + b.startDate + " → " + b.endDate + ").", conflict: { blockId: b.blockId, startDate: b.startDate, endDate: b.endDate } };
  const l = dbAll_("Leases").find(function (x) {
    if (String(x.propertyId) !== pid || ["ACTIVE", "NOTICE"].indexOf(x.status) < 0) return false;
    const s = localToDate_(x.startDate, "00:00").getTime(), e = x.endDate ? localToDate_(addDaysStr_(x.endDate, 1), "00:00").getTime() : 8.64e15;
    return startMs < e && s < endMs;
  });
  if (l) return { reason: "LEASE_CONFLICT", message: "Le bien est loué en longue durée sur cette période.", conflict: { leaseId: l.leaseId } };
  return null;
}

/** Montants : encaissements et remboursements issus UNIQUEMENT de la table Payments (jamais déduits d'une échéance). */
function resvMoney_(r) {
  const pays = dbAll_("Payments").filter(function (x) { return x.refType === "RESERVATION" && String(x.refId) === String(r.reservationId) && x.status === "RECORDED"; });
  const paidIn = sumBy_(pays.filter(function (x) { return x.kind === "RESERVATION" && x.direction === "IN"; }), function (x) { return x.amount; });
  const refunded = sumBy_(pays.filter(function (x) { return x.kind === "REFUND" && x.direction === "OUT"; }), function (x) { return x.amount; });
  const depIn = sumBy_(pays.filter(function (x) { return x.kind === "DEPOSIT" && x.direction === "IN"; }), function (x) { return x.amount; });
  const depOut = sumBy_(pays.filter(function (x) { return x.kind === "DEPOSIT_REFUND" && x.direction === "OUT"; }), function (x) { return x.amount; });
  const due = r.status === "CANCELLED" || r.status === "NO_SHOW" ? round2_(Math.max(0, paidIn - num_(r.refundDue))) : round2_(num_(r.totalPrice) + num_(r.taxes) + num_(r.fees));
  const net = round2_(paidIn - refunded);
  const balance = round2_(due - net);
  let status = "UNPAID";
  if (refunded > 0 && net <= 0) status = "REFUNDED";
  else if (net <= 0) status = due <= 0 ? "PAID" : "UNPAID";
  else if (net < due) status = "PARTIAL";
  else if (net === due) status = "PAID";
  else status = "OVERPAID";
  return { amountDue: due, paid: paidIn, refunded: refunded, netPaid: net, balance: balance, paymentStatus: status, depositHeld: round2_(depIn - depOut), depositReceived: depIn, depositReturned: depOut };
}
function resvRefreshPaymentStatus_(reservationId) {
  const r = dbGet_("Reservations", reservationId); if (!r) return;
  const m = resvMoney_(r);
  const depositStatus = m.depositReceived <= 0 ? (num_(r.deposit) > 0 ? "EXPECTED" : "NONE") : (m.depositHeld <= 0 ? "RETURNED" : "HELD");
  if (m.paymentStatus !== r.paymentStatus || depositStatus !== r.depositStatus) dbUpdate_("Reservations", r.reservationId, { paymentStatus: m.paymentStatus, depositStatus: depositStatus });
}

function resvAgencyFor_(p, prop, requested) {
  const acc = propertyAccess_(p, prop);
  if (acc.via.OWNER || acc.via.SUPPORT) {
    if (!requested) return { agencyOrganizationId: "", rate: prop.managementCommissionRate };
    const perm = dbAll_("AgencyPropertyPermissions").find(function (z) { return String(z.propertyId) === String(prop.propertyId) && String(z.agencyOrganizationId) === String(requested) && z.status === "ACTIVE"; });
    assert_(perm, "Cette agence n'est pas attribuée à ce bien.");
    return { agencyOrganizationId: String(requested), rate: perm.commissionRate !== null && perm.commissionRate !== "" ? perm.commissionRate : prop.managementCommissionRate };
  }
  const perms = dbAll_("AgencyPropertyPermissions").filter(function (z) { return String(z.propertyId) === String(prop.propertyId) && z.status === "ACTIVE" && bool_(z.canManageReservations) && acc.agencyOrgIds.indexOf(String(z.agencyOrganizationId)) >= 0; });
  assert_(perms.length, "Aucune autorisation de réservation pour ce bien.", "FORBIDDEN");
  const perm = requested ? perms.find(function (z) { return String(z.agencyOrganizationId) === String(requested); }) : perms[0];
  assert_(perm, "Agence non autorisée pour ce bien.", "FORBIDDEN");
  return { agencyOrganizationId: String(perm.agencyOrganizationId), rate: perm.commissionRate !== null && perm.commissionRate !== "" ? perm.commissionRate : prop.managementCommissionRate };
}

function resvPriceInput_(prop, a, nights, guestCount) {
  const totalPrice = a.totalPrice === "" || a.totalPrice == null ? round2_(num_(prop.nightlyPrice) * nights) : money_(a.totalPrice, "Prix total");
  const fees = a.fees === "" || a.fees == null ? round2_(num_(prop.cleaningFee)) : money_(a.fees, "Frais");
  const taxes = a.taxes === "" || a.taxes == null ? round2_(num_(prop.touristTaxPerNight) * nights * guestCount) : money_(a.taxes, "Taxes");
  return { totalPrice: totalPrice, fees: fees, taxes: taxes, deposit: a.deposit === "" || a.deposit == null ? 0 : money_(a.deposit, "Caution") };
}

function resvOut_(p, r, prop, acc) {
  acc = acc || propertyAccess_(p, prop) || { caps: {} };
  const full = !!acc.caps["reservation.view"];
  const o = { reservationId: r.reservationId, propertyId: r.propertyId, propertyName: prop ? prop.name : "", city: prop ? prop.city : "", checkIn: r.checkIn, checkOut: r.checkOut,
    checkInAt: r.checkInAt, checkOutAt: r.checkOutAt, guestName: r.guestName, guestCount: r.guestCount, status: r.status, guestPhone: r.guestPhone };
  if (full) {
    const m = resvMoney_(r);
    Object.assign(o, { agencyOrganizationId: r.agencyOrganizationId, guestEmail: r.guestEmail, source: r.source, notes: r.notes, totalPrice: r.totalPrice, taxes: r.taxes, fees: r.fees,
      commissionRate: r.commissionRate, commissionAmount: r.commissionAmount, deposit: r.deposit, depositStatus: r.depositStatus, paymentStatus: m.paymentStatus, amountDue: m.amountDue, paid: m.netPaid,
      balance: m.balance, depositHeld: m.depositHeld, cancelReason: r.cancelReason, refundDue: r.refundDue, version: r.version, currency: r.currency || "MAD",
      canEdit: !!acc.caps["reservation.edit"], canCancel: !!acc.caps["reservation.cancel"], nights: diffDays_(r.checkIn, r.checkOut) });
  }
  return o;
}

/* --------------------------------- Routes --------------------------------- */
function resvList_(p, a) {
  a = a || {};
  const props = indexBy_(dbAll_("Properties"), "propertyId");
  const rows = dbAll_("Reservations").filter(function (r) {
    const prop = props[String(r.propertyId)];
    if (!prop || !(canResv_(p, r, "reservation.view") || canResv_(p, r, "checkin.operate"))) return false;
    if (a.propertyId && String(r.propertyId) !== String(a.propertyId)) return false;
    if (a.agencyOrganizationId && String(r.agencyOrganizationId) !== String(a.agencyOrganizationId)) return false;
    if (a.status) { if (r.status !== a.status) return false; } else if (!a.includeCancelled && (r.status === "CANCELLED")) return false;
    if (a.paymentStatus && r.paymentStatus !== a.paymentStatus) return false;
    if (a.from && String(r.checkOut) < String(a.from)) return false;
    if (a.to && String(r.checkIn) > String(a.to)) return false;
    return matchesQuery_(a.q, [r.guestName, r.reservationId, prop.name, r.guestEmail, r.guestPhone]);
  }).sort(function (x, y) { return a.sort === "desc" ? String(y.checkIn).localeCompare(String(x.checkIn)) : String(x.checkIn).localeCompare(String(y.checkIn)); });
  const page = a.all ? { items: rows, total: rows.length } : pageOf_(rows, a);
  page.items = page.items.map(function (r) { return resvOut_(p, r, props[String(r.propertyId)]); });
  return page;
}

function resvGet_(p, a) {
  const r = dbGet_("Reservations", safeText_(a.reservationId, 120));
  if (!r || !(canResv_(p, r, "reservation.view") || canResv_(p, r, "checkin.operate"))) throw new AppError("FORBIDDEN", "Réservation introuvable ou accès refusé.");
  const prop = dbGet_("Properties", r.propertyId), acc = propertyAccess_(p, prop);
  const o = resvOut_(p, r, prop, acc);
  o.arrivalInstructions = prop.arrivalInstructions; o.accessInstructions = prop.accessInstructions; o.departureInstructions = prop.departureInstructions;
  if (acc.caps["reservation.view"]) {
    o.payments = dbAll_("Payments").filter(function (x) { return x.refType === "RESERVATION" && String(x.refId) === String(r.reservationId); })
      .map(function (x) { return { paymentId: x.paymentId, kind: x.kind, direction: x.direction, amount: x.amount, method: x.method, paidAt: x.paidAt, reference: x.reference, status: x.status, reconciled: x.reconciled }; });
    o.history = auditHistory_("Reservation", r.reservationId, 40);
    o.documents = docList_(p, { ownerType: "RESERVATION", ownerId: r.reservationId });
  }
  if (acc.caps["guest.view"]) o.guests = guestListFor_(p, r);
  o.checkIns = dbAll_("CheckIns").filter(function (x) { return String(x.reservationId) === String(r.reservationId); }).map(checkEventOut_);
  o.checkOuts = dbAll_("CheckOuts").filter(function (x) { return String(x.reservationId) === String(r.reservationId); }).map(checkEventOut_);
  o.legacyGuestEvents = dbAll_("GuestEvents").filter(function (x) { return String(x.reservationId) === String(r.reservationId); }).map(function (x) { return { eventType: x.eventType, eventAt: x.eventAt, actorEmail: x.actorEmail, travelerName: x.travelerName }; });
  o.canOperate = canResv_(p, r, "checkin.operate");
  return o;
}

function resvAvailability_(p, a) {
  const prop = assertPropAny_(p, a.propertyId, ["reservation.view", "reservation.edit"]);
  const ci = dateOnly_(a.checkIn, "Arrivée"), co = dateOnly_(a.checkOut, "Départ");
  const t = resvTimes_(prop, ci, co, a.checkInTime, a.checkOutTime);
  const c = findConflict_(prop, t.start.getTime(), t.end.getTime(), a.ignoreReservationId);
  return c ? { available: false, reason: c.reason, message: c.message, conflict: c.conflict } : { available: true, nights: diffDays_(ci, co) };
}

function resvCreate_(p, a) {
  const prop = assertProp_(p, a.propertyId, "reservation.edit");
  assert_(prop.status === "ACTIVE", "Le bien n'est pas actif (statut " + prop.status + ").");
  assert_(prop.rentalMode !== "LONG_TERM", "Ce bien est configuré en location longue durée uniquement.");
  const ci = dateOnly_(a.checkIn, "Arrivée"), co = dateOnly_(a.checkOut, "Départ");
  const nights = diffDays_(ci, co);
  assert_(nights >= 1 && nights <= 365, "Durée de séjour invalide (1 à 365 nuits).");
  const t = resvTimes_(prop, ci, co, a.checkInTime, a.checkOutTime);
  const guestCount = parseInt(a.guestCount, 10) || 1;
  assert_(guestCount >= 1 && guestCount <= 100, "Nombre de voyageurs invalide.");
  if (prop.capacity) assert_(guestCount <= Number(prop.capacity), "Capacité maximale du bien dépassée (" + prop.capacity + ").");
  const guestName = reqText_(a.guestName, "Nom du voyageur", 2, 120);
  const status = oneOf_(a.status || "CONFIRMED", ["DRAFT", "PENDING", "CONFIRMED"], "Statut");
  const ag = resvAgencyFor_(p, prop, safeText_(a.agencyOrganizationId || "", 120));
  const price = resvPriceInput_(prop, a, nights, guestCount);
  const rate = ag.rate === null || ag.rate === "" ? 0 : Number(ag.rate);
  const row = {
    organizationId: prop.organizationId, propertyId: prop.propertyId, agencyOrganizationId: ag.agencyOrganizationId, checkIn: ci, checkOut: co, checkInAt: t.start.toISOString(), checkOutAt: t.end.toISOString(),
    guestCount: guestCount, guestName: guestName, guestEmail: a.guestEmail ? validateEmail_(a.guestEmail) : "", guestPhone: safeText_(a.guestPhone, 30), status: status,
    notes: safeText_(a.notes, 1000), source: oneOf_(a.source || "DIRECT", RESV_SOURCES_, "Origine"), totalPrice: price.totalPrice, taxes: price.taxes, fees: price.fees,
    commissionRate: rate, commissionAmount: round2_(price.totalPrice * rate / 100), deposit: price.deposit, depositStatus: price.deposit > 0 ? "EXPECTED" : "NONE",
    paymentStatus: "UNPAID", currency: prop.currency || "MAD", version: 1, idempotencyKey: safeText_(a.requestKey || "", 120),
    createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_(), updatedBy: p.email
  };
  return withLock_(function () {
    return idemRun_(a.requestKey, "RESERVATION_CREATE", prop.organizationId, function () {
      const fresh = dbGet_("Properties", prop.propertyId);
      assert_(fresh && fresh.status === "ACTIVE", "Bien indisponible.");
      if (status !== "DRAFT") { const c = findConflict_(fresh, t.start.getTime(), t.end.getTime(), ""); if (c) throw new AppError("CONFLICT", c.message); }
      const ins = dbInsert_("Reservations", row);
      const names = guestName.split(/\s+/);
      dbInsert_("Guests", { organizationId: prop.organizationId, propertyId: prop.propertyId, reservationId: ins.reservationId, lastName: names.length > 1 ? names.slice(1).join(" ") : names[0],
        firstName: names.length > 1 ? names[0] : "", email: row.guestEmail, phone: row.guestPhone, isPrimary: true, status: "ACTIVE", createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_() });
      audit_("RESERVATION_CREATED", "Reservation", ins.reservationId, prop.organizationId, { propertyId: prop.propertyId, checkIn: ci, checkOut: co, status: status, agency: ag.agencyOrganizationId });
      if (status === "CONFIRMED") notify_({ eventKey: "resv-confirmed:" + ins.reservationId, userIds: propertyManagers_(prop, "canManageReservations").filter(function (u) { return u !== p.userId; }), type: "RESERVATION_CONFIRMED",
        organizationId: prop.organizationId, title: "Réservation confirmée : " + prop.name, body: guestName + " — " + ci + " → " + co, link: "#reservation/" + ins.reservationId });
      return { ok: true, reservationId: ins.reservationId, id: ins.reservationId };
    });
  });
}

/** Modification avec contrôle de version (concurrence optimiste) et revérification des disponibilités sous verrou. */
function resvUpdate_(p, a) {
  const r0 = assertResv_(p, a.reservationId, "reservation.edit");
  assert_(["DRAFT", "PENDING", "CONFIRMED", "IN_PROGRESS"].indexOf(r0.status) >= 0, "Réservation non modifiable (statut " + r0.status + ").");
  return withLock_(function () {
    const r = dbGet_("Reservations", r0.reservationId);
    if (a.version !== undefined && a.version !== null && a.version !== "") assert_(Number(a.version) === Number(r.version || 0), "La réservation a été modifiée entre-temps. Rechargez-la.", "CONFLICT");
    const prop = dbGet_("Properties", r.propertyId);
    const patch = {};
    const ci = a.checkIn !== undefined ? dateOnly_(a.checkIn, "Arrivée") : r.checkIn, co = a.checkOut !== undefined ? dateOnly_(a.checkOut, "Départ") : r.checkOut;
    const datesChanged = ci !== r.checkIn || co !== r.checkOut || a.checkInTime || a.checkOutTime;
    if (datesChanged) {
      assert_(r.status !== "IN_PROGRESS" || ci === r.checkIn, "Séjour en cours : seule la date de départ peut être modifiée.");
      const t = resvTimes_(prop, ci, co, a.checkInTime, a.checkOutTime);
      if (r.status !== "DRAFT") { const c = findConflict_(prop, t.start.getTime(), t.end.getTime(), r.reservationId); if (c) throw new AppError("CONFLICT", c.message); }
      Object.assign(patch, { checkIn: ci, checkOut: co, checkInAt: t.start.toISOString(), checkOutAt: t.end.toISOString() });
    }
    if (a.guestName !== undefined) patch.guestName = reqText_(a.guestName, "Nom du voyageur", 2, 120);
    if (a.guestCount !== undefined) { const g = parseInt(a.guestCount, 10); assert_(g >= 1 && g <= 100 && (!prop.capacity || g <= Number(prop.capacity)), "Nombre de voyageurs invalide."); patch.guestCount = g; }
    if (a.guestEmail !== undefined) patch.guestEmail = a.guestEmail ? validateEmail_(a.guestEmail) : "";
    if (a.guestPhone !== undefined) patch.guestPhone = safeText_(a.guestPhone, 30);
    if (a.notes !== undefined) patch.notes = safeText_(a.notes, 1000);
    if (a.source !== undefined) patch.source = oneOf_(a.source, RESV_SOURCES_, "Origine");
    ["totalPrice", "taxes", "fees", "deposit"].forEach(function (k) { if (a[k] !== undefined && a[k] !== "") patch[k] = money_(a[k], k); });
    if (patch.totalPrice !== undefined) patch.commissionAmount = round2_(patch.totalPrice * num_(r.commissionRate) / 100);
    patch.version = Number(r.version || 0) + 1; patch.updatedAt = nowIso_(); patch.updatedBy = p.email;
    dbUpdate_("Reservations", r.reservationId, patch);
    audit_("RESERVATION_UPDATED", "Reservation", r.reservationId, r.organizationId, diff_(r, patch, Object.keys(patch).filter(function (k) { return ["version", "updatedAt", "updatedBy"].indexOf(k) < 0; })));
    resvRefreshPaymentStatus_(r.reservationId);
    return { ok: true, version: patch.version };
  });
}

function resvSetStatus_(p, a) {
  const r0 = assertResv_(p, a.reservationId, "reservation.edit");
  const to = oneOf_(a.status, ["PENDING", "CONFIRMED", "NO_SHOW"], "Statut");
  return withLock_(function () {
    const r = dbGet_("Reservations", r0.reservationId), prop = dbGet_("Properties", r.propertyId);
    assert_((RESV_TRANSITIONS_[r.status] || []).indexOf(to) >= 0, "Transition " + r.status + " → " + to + " non autorisée.");
    if (to === "NO_SHOW") assert_(Date.now() >= resvStartMs_(r, prop), "Le no-show ne peut être déclaré qu'après l'heure d'arrivée prévue.");
    if (r.status === "DRAFT" && RESV_BLOCKING_.indexOf(to) >= 0) { const c = findConflict_(prop, resvStartMs_(r, prop), resvEndMs_(r, prop), r.reservationId); if (c) throw new AppError("CONFLICT", c.message); }
    dbUpdate_("Reservations", r.reservationId, { status: to, version: Number(r.version || 0) + 1, updatedAt: nowIso_(), updatedBy: p.email });
    audit_("RESERVATION_STATUS_" + to, "Reservation", r.reservationId, r.organizationId, { from: r.status });
    if (to === "CONFIRMED") notify_({ eventKey: "resv-confirmed:" + r.reservationId, userIds: propertyManagers_(prop, "canManageReservations").filter(function (u) { return u !== p.userId; }), type: "RESERVATION_CONFIRMED",
      organizationId: r.organizationId, title: "Réservation confirmée : " + prop.name, body: r.guestName + " — " + r.checkIn + " → " + r.checkOut, link: "#reservation/" + r.reservationId });
    return { ok: true, status: to };
  });
}

/** Pénalité d'annulation selon la politique (jours avant arrivée → % retenu). */
function cancellationPenalty_(r, orgId, today) {
  const policy = (getSetting_("reservation.cancellationPolicy", orgId) || []).slice().sort(function (x, y) { return y.daysBefore - x.daysBefore; });
  const days = diffDays_(today || todayStr_(), r.checkIn);
  let pct = 100;
  for (let i = 0; i < policy.length; i++) if (days >= policy[i].daysBefore) { pct = policy[i].penaltyPercent; break; }
  return { daysBefore: days, penaltyPercent: pct, penalty: round2_((num_(r.totalPrice) + num_(r.fees)) * pct / 100) };
}
function resvCancel_(p, a) {
  const r0 = assertResv_(p, a.reservationId, "reservation.cancel");
  const reason = oneOf_(a.reason || "OTHER", getSetting_("list.cancelReasons", r0.organizationId), "Motif d'annulation");
  return withLock_(function () {
    const r = dbGet_("Reservations", r0.reservationId);
    assert_(["DRAFT", "PENDING", "CONFIRMED"].indexOf(r.status) >= 0, "Cette réservation ne peut plus être annulée (statut " + r.status + ").");
    const pen = cancellationPenalty_(r, r.organizationId);
    const m = resvMoney_(r);
    const refundDue = a.waivePenalty === true ? m.netPaid : round2_(Math.max(0, m.netPaid - pen.penalty));
    dbUpdate_("Reservations", r.reservationId, { status: "CANCELLED", cancelReason: reason, cancelledAt: nowIso_(), cancelledBy: p.email, refundDue: refundDue,
      notes: a.note ? safeText_((r.notes ? r.notes + "\n" : "") + "Annulation : " + a.note, 1000) : r.notes, version: Number(r.version || 0) + 1, updatedAt: nowIso_(), updatedBy: p.email });
    dbAll_("CleaningMissions").filter(function (mm) { return String(mm.reservationId) === String(r.reservationId) && ["CREATED", "OFFERED"].indexOf(mm.status) >= 0; })
      .forEach(function (mm) { dbUpdate_("CleaningMissions", mm.missionId, { status: "CANCELLED", updatedAt: nowIso_() }); });
    resvRefreshPaymentStatus_(r.reservationId);
    audit_("RESERVATION_CANCELLED", "Reservation", r.reservationId, r.organizationId, { reason: reason, penaltyPercent: pen.penaltyPercent, refundDue: refundDue, waived: a.waivePenalty === true });
    return { ok: true, penaltyPercent: pen.penaltyPercent, penalty: pen.penalty, refundDue: refundDue, note: refundDue > 0 ? "Le remboursement doit être enregistré comme paiement sortant (REFUND) une fois effectué." : "" };
  });
}

/** Calendrier mensuel : réservations et blocages des biens accessibles. */
function resvCalendar_(p, a) {
  const month = /^\d{4}-\d{2}$/.test(String(a.month || "")) ? a.month : todayStr_().slice(0, 7);
  const from = month + "-01", toExcl = addMonthsStr_(from, 1);
  const props = accessibleProps_(p, "reservation.view").concat(accessibleProps_(p, "checkin.operate")).filter(function (x, i, arr) {
    return x.status !== "ARCHIVED" && arr.findIndex(function (y) { return y.propertyId === x.propertyId; }) === i && (!a.propertyId || String(x.propertyId) === String(a.propertyId));
  });
  const ids = {}; props.forEach(function (x) { ids[String(x.propertyId)] = true; });
  const events = dbAll_("Reservations").filter(function (r) { return ids[String(r.propertyId)] && ["CANCELLED", "DRAFT"].indexOf(r.status) < 0 && r.checkIn < toExcl && r.checkOut >= from && (canResv_(p, r, "reservation.view") || canResv_(p, r, "checkin.operate")); })
    .map(function (r) { return { type: "RESERVATION", id: r.reservationId, propertyId: r.propertyId, start: r.checkIn, end: r.checkOut, label: r.guestName, status: r.status }; })
    .concat(dbAll_("AvailabilityBlocks").filter(function (b) { return ids[String(b.propertyId)] && b.status === "ACTIVE" && b.startDate < toExcl && b.endDate >= from; })
      .map(function (b) { return { type: "BLOCK", id: b.blockId, propertyId: b.propertyId, start: b.startDate, end: b.endDate, label: b.reason, status: "BLOCKED", canCancel: canProp_(p, dbGet_("Properties", b.propertyId), "property.edit") }; }));
  return { month: month, from: from, days: diffDays_(from, toExcl), properties: props.map(function (x) { return { propertyId: x.propertyId, name: x.name }; }), events: events };
}

function blockCreate_(p, a) {
  const prop = assertProp_(p, a.propertyId, "property.edit");
  const s = dateOnly_(a.startDate, "Début"), e = dateOnly_(a.endDate, "Fin");
  assert_(s < e, "La fin doit être postérieure au début.");
  return withLock_(function () {
    const st = localToDate_(s, "12:00").getTime(), en = localToDate_(e, "12:00").getTime();
    const c = findConflict_(prop, st, en, "");
    if (c && c.reason === "RESERVATION_CONFLICT") throw new AppError("CONFLICT", "Impossible de bloquer : " + c.message);
    const b = dbInsert_("AvailabilityBlocks", { organizationId: prop.organizationId, propertyId: prop.propertyId, startDate: s, endDate: e, reason: safeText_(a.reason || "Bloqué par le propriétaire", 200),
      status: "ACTIVE", createdAt: nowIso_(), createdBy: p.email, blockType: oneOf_(a.blockType || "OWNER", ["OWNER", "MAINTENANCE", "OTHER"], "Type") });
    audit_("AVAILABILITY_BLOCK_CREATED", "AvailabilityBlock", b.blockId, prop.organizationId, { startDate: s, endDate: e });
    return { ok: true, blockId: b.blockId };
  });
}
function blockCancel_(p, a) {
  const b = dbGet_("AvailabilityBlocks", safeText_(a.blockId, 120));
  if (!b) notFound_("Blocage");
  assertProp_(p, b.propertyId, "property.edit");
  dbUpdate_("AvailabilityBlocks", b.blockId, { status: "CANCELLED" });
  audit_("AVAILABILITY_BLOCK_CANCELLED", "AvailabilityBlock", b.blockId, b.organizationId, {});
  return { ok: true };
}

/** Confirmation au voyageur. Aucune pièce d'identité n'est jamais jointe. */
function resvSendConfirmation_(p, a) {
  const r = assertResv_(p, a.reservationId, "reservation.edit");
  assert_(r.guestEmail, "Aucune adresse e-mail voyageur.");
  assert_(["CONFIRMED", "PENDING"].indexOf(r.status) >= 0, "Réservation non confirmée.");
  const prop = dbGet_("Properties", r.propertyId), m = resvMoney_(r);
  const body = "Bonjour " + r.guestName + ",\n\nVotre réservation est " + (r.status === "CONFIRMED" ? "confirmée" : "en attente de confirmation") + ".\n\nLogement : " + prop.name + " (" + prop.city + ")\nArrivée : " + r.checkIn +
    " à partir de " + (prop.checkInTime || getSetting_("reservation.defaultCheckIn", r.organizationId)) + "\nDépart : " + r.checkOut + " avant " + (prop.checkOutTime || getSetting_("reservation.defaultCheckOut", r.organizationId)) +
    "\nVoyageurs : " + r.guestCount + "\nMontant total : " + m.amountDue + " " + (r.currency || "MAD") + "\nDéjà réglé : " + m.netPaid + " — Solde : " + m.balance +
    (prop.houseRules ? "\n\nRèglement intérieur :\n" + prop.houseRules : "") + "\n\nRéférence : " + r.reservationId + "\n\nÀ bientôt,\n" + IMMO_CONFIG.APP_NAME;
  const res = sendMailSafe_(r.guestEmail, "Votre réservation — " + prop.name + " (" + r.checkIn + ")", body, "resv-confirm-mail:" + r.reservationId + ":" + r.version, r.organizationId);
  audit_("RESERVATION_CONFIRMATION_SENT", "Reservation", r.reservationId, r.organizationId, { ok: res.ok });
  if (!res.ok) throw new AppError("EMAIL", "Envoi impossible : " + res.error);
  return { ok: true, duplicate: !!res.duplicate };
}

/** Fiche de réservation PDF (modèle Google Docs si configuré, sinon gabarit HTML intégré). */
function resvSheet_(p, a) {
  const r = assertResv_(p, a.reservationId, "reservation.view");
  const prop = dbGet_("Properties", r.propertyId), m = resvMoney_(r);
  const map = { reference: r.reservationId, bien: prop.name, adresse: (prop.address || "") + " " + (prop.city || ""), voyageur: r.guestName, voyageurs: r.guestCount, arrivee: r.checkIn, depart: r.checkOut,
    nuits: diffDays_(r.checkIn, r.checkOut), prix: r.totalPrice, frais: r.fees, taxes: r.taxes, total: m.amountDue, paye: m.netPaid, solde: m.balance, caution: r.deposit, statut: r.status, devise: r.currency || "MAD" };
  const ctx = { propertyId: prop.propertyId, organizationId: prop.organizationId, sensitive: false };
  const tpl = getSetting_("template.reservationDocId", prop.organizationId);
  let pdf;
  if (tpl) pdf = docFromTemplate_(tpl, map, propertyFolder_(prop.organizationId, prop.propertyId, "RESERVATION"), "Fiche_" + r.reservationId).pdf;
  else pdf = htmlToPdf_(pdfShell_("Fiche de réservation", htmlTable_(["Champ", "Valeur"], Object.keys(map).map(function (k) { return [k, map[k]]; }))), "Fiche_" + r.reservationId);
  const out = storeGeneratedPdf_(p, pdf, ctx, "RESERVATION", r.reservationId, "SHEET");
  audit_("RESERVATION_SHEET_GENERATED", "Reservation", r.reservationId, r.organizationId, {});
  return out;
}
