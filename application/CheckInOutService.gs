/**
 * Check-in / check-out (interface terrain des gardiens).
 * Le gardien ne modifie ni les montants ni les dates : il enregistre uniquement les événements d'arrivée/départ,
 * l'état du logement, les photos, la signature éventuelle et les anomalies. Les heures réelles sont horodatées par le serveur.
 */
function checkEventOut_(x) {
  return { id: x.checkInId || x.checkOutId, reservationId: x.reservationId, plannedAt: x.plannedAt, actualAt: x.actualAt, agentEmail: x.agentEmail, lateMinutes: x.lateMinutes,
    checklist: parseJson_(x.checklistJson, {}), conditionNotes: x.conditionNotes, meters: parseJson_(x.metersJson, {}), photoDocIds: parseJson_(x.photoDocIdsJson, []),
    comments: x.comments, incidentId: x.incidentId, status: x.status };
}

function opsToday_(p, a) {
  a = a || {};
  const day = a.date ? dateOnly_(a.date, "Date") : todayStr_();
  const props = indexBy_(dbAll_("Properties"), "propertyId");
  const cis = indexBy_(dbAll_("CheckIns"), "reservationId"), cos = indexBy_(dbAll_("CheckOuts"), "reservationId");
  const now = Date.now();
  const mine = dbAll_("Reservations").filter(function (r) {
    if (["CONFIRMED", "IN_PROGRESS", "COMPLETED", "PENDING"].indexOf(r.status) < 0) return false;
    if (a.propertyId && String(r.propertyId) !== String(a.propertyId)) return false;
    return canResv_(p, r, "checkin.operate");
  });
  const map = function (r, kind) {
    const prop = props[String(r.propertyId)], grace = (Number(getSetting_("checkin.graceMinutes", r.organizationId)) || 120) * 60000;
    const planned = kind === "ARRIVAL" ? resvStartMs_(r, prop) : resvEndMs_(r, prop);
    const done = kind === "ARRIVAL" ? cis[String(r.reservationId)] : cos[String(r.reservationId)];
    return { reservationId: r.reservationId, propertyId: r.propertyId, propertyName: prop ? prop.name : "", address: prop ? prop.address : "", guestName: r.guestName, guestCount: r.guestCount,
      guestPhone: r.guestPhone, status: r.status, plannedAt: new Date(planned).toISOString(), done: !!done, actualAt: done ? done.actualAt : "",
      late: !done && now > planned + grace && (kind === "ARRIVAL" ? r.status === "CONFIRMED" : r.status === "IN_PROGRESS"), checkIn: r.checkIn, checkOut: r.checkOut,
      rooms: prop ? parseJson_(prop.roomsJson, []) : [] };
  };
  const arrivals = mine.filter(function (r) { return r.checkIn === day; }).map(function (r) { return map(r, "ARRIVAL"); });
  const departures = mine.filter(function (r) { return r.checkOut === day; }).map(function (r) { return map(r, "DEPARTURE"); });
  const overdue = mine.filter(function (r) { return r.checkIn < day && r.status === "CONFIRMED"; }).map(function (r) { return Object.assign(map(r, "ARRIVAL"), { kind: "ARRIVAL_MISSING" }); })
    .concat(mine.filter(function (r) { return r.checkOut < day && r.status === "IN_PROGRESS"; }).map(function (r) { return Object.assign(map(r, "DEPARTURE"), { kind: "DEPARTURE_MISSING" }); }));
  const sortT = function (x, y) { return String(x.plannedAt).localeCompare(String(y.plannedAt)); };
  return { date: day, arrivals: arrivals.sort(sortT), departures: departures.sort(sortT), overdue: overdue,
    checklistTemplate: ["Clés / badges remis", "Logement propre", "Équipements fonctionnels", "Linge présent", "Consignes expliquées", "Compteurs relevés"] };
}

function opsActualAt_(a) {
  if (!a.actualAt) return new Date();
  const d = parseTs_(a.actualAt);
  assert_(d && Math.abs(Date.now() - d.getTime()) <= 24 * 3600000 && d.getTime() <= Date.now() + 5 * 60000, "Heure réelle invalide (24 h maximum dans le passé).");
  return d;
}
function opsCommon_(p, a, r, kind) {
  const prop = dbGet_("Properties", r.propertyId);
  const photos = assertDocsOf_(Array.isArray(a.photoDocIds) ? a.photoDocIds : [], "RESERVATION", r.reservationId);
  const checklist = a.checklist && typeof a.checklist === "object" && !Array.isArray(a.checklist) ? a.checklist : {};
  const cl = {}; Object.keys(checklist).slice(0, 40).forEach(function (k) { cl[safeText_(k, 80)] = checklist[k] === true || checklist[k] === "true"; });
  if (a.signatureDocId) { assertDocsOf_([a.signatureDocId], "RESERVATION", r.reservationId); cl.__signatureDocId = a.signatureDocId; }
  const meters = {}; if (a.meters && typeof a.meters === "object") Object.keys(a.meters).slice(0, 10).forEach(function (k) { meters[safeText_(k, 40)] = safeText_(a.meters[k], 40); });
  const actual = opsActualAt_(a);
  const planned = kind === "IN" ? resvStartMs_(r, prop) : resvEndMs_(r, prop);
  let incidentId = "";
  if (a.incident && a.incident.description) {
    incidentId = incidentInsert_(p, prop, { category: a.incident.category || "OTHER", severity: a.incident.severity || "MEDIUM", description: a.incident.description, reservationId: r.reservationId,
      title: (kind === "IN" ? "Constat d'arrivée" : "Constat de départ") + " : " + (a.incident.category || "OTHER"), source: kind === "IN" ? "CHECKIN" : "CHECKOUT", photoDocIds: [] }).incidentId;
  }
  return { prop: prop, row: { organizationId: r.organizationId, propertyId: r.propertyId, reservationId: r.reservationId, plannedAt: new Date(planned).toISOString(), actualAt: actual.toISOString(),
    agentUserId: p.userId, agentEmail: p.email, checklistJson: cl, conditionNotes: safeText_(a.conditionNotes, 2000), metersJson: meters, photoDocIdsJson: photos, comments: safeText_(a.comments, 2000),
    incidentId: incidentId, status: "DONE", idempotencyKey: safeText_(a.requestKey || "", 120), createdAt: nowIso_(), lateMinutes: Math.max(0, Math.round((actual.getTime() - planned) / 60000)) } };
}

function opsCheckIn_(p, a) {
  const r0 = assertResv_(p, a.reservationId, "checkin.operate");
  return withLock_(function () {
    return idemRun_(a.requestKey, "CHECK_IN", r0.organizationId, function () {
      const r = dbGet_("Reservations", r0.reservationId);
      assert_(r.status === "CONFIRMED", "Check-in impossible : la réservation doit être confirmée (statut " + r.status + ").");
      assert_(!dbAll_("CheckIns").some(function (x) { return String(x.reservationId) === String(r.reservationId); }), "Check-in déjà effectué.");
      const today = todayStr_();
      assert_(today >= addDaysStr_(r.checkIn, -1) && today <= r.checkOut, "Check-in hors de la période du séjour.");
      const c = opsCommon_(p, a, r, "IN");
      const row = dbInsert_("CheckIns", c.row);
      dbUpdate_("Reservations", r.reservationId, { status: "IN_PROGRESS", version: Number(r.version || 0) + 1, updatedAt: nowIso_(), updatedBy: p.email });
      audit_("CHECK_IN_DONE", "Reservation", r.reservationId, r.organizationId, { checkInId: row.checkInId, lateMinutes: row.lateMinutes, photos: c.row.photoDocIdsJson.length });
      if (row.lateMinutes > 0 || row.incidentId) notify_({ eventKey: "checkin:" + row.checkInId, userIds: propertyManagers_(c.prop, "canManageReservations"), type: "CHECK_IN", organizationId: r.organizationId,
        title: "Arrivée enregistrée : " + c.prop.name, body: r.guestName + (row.lateMinutes ? " — retard " + row.lateMinutes + " min" : "") + (row.incidentId ? " — anomalie signalée" : ""), link: "#reservation/" + r.reservationId, email: !!row.incidentId });
      return { ok: true, checkInId: row.checkInId, id: row.checkInId, actualAt: row.actualAt, incidentId: row.incidentId };
    });
  });
}

function opsCheckOut_(p, a) {
  const r0 = assertResv_(p, a.reservationId, "checkin.operate");
  return withLock_(function () {
    return idemRun_(a.requestKey, "CHECK_OUT", r0.organizationId, function () {
      const r = dbGet_("Reservations", r0.reservationId);
      assert_(r.status === "IN_PROGRESS", "Check-out impossible : aucun check-in enregistré (statut " + r.status + ").");
      assert_(!dbAll_("CheckOuts").some(function (x) { return String(x.reservationId) === String(r.reservationId); }), "Check-out déjà effectué.");
      const c = opsCommon_(p, a, r, "OUT");
      const row = dbInsert_("CheckOuts", c.row);
      dbUpdate_("Reservations", r.reservationId, { status: "COMPLETED", version: Number(r.version || 0) + 1, updatedAt: nowIso_(), updatedBy: p.email });
      audit_("CHECK_OUT_DONE", "Reservation", r.reservationId, r.organizationId, { checkOutId: row.checkOutId, lateMinutes: row.lateMinutes });
      const mission = cleaningAutoCreate_(c.prop, r, p);
      notify_({ eventKey: "checkout:" + row.checkOutId, userIds: propertyManagers_(c.prop, "canManageOperations"), type: "CHECK_OUT", organizationId: r.organizationId,
        title: "Départ enregistré : " + c.prop.name, body: r.guestName + (mission ? " — mission de ménage " + (mission.status === "OFFERED" ? "proposée" : "à attribuer") : ""), link: "#cleaning", email: false });
      return { ok: true, checkOutId: row.checkOutId, id: row.checkOutId, actualAt: row.actualAt, cleaningMissionId: mission ? mission.missionId : "", incidentId: row.incidentId };
    });
  });
}

function opsHistory_(p, a) {
  a = a || {};
  const props = indexBy_(dbAll_("Properties"), "propertyId"), resv = indexBy_(dbAll_("Reservations"), "reservationId");
  const rows = dbAll_("CheckIns").map(function (x) { return Object.assign(checkEventOut_(x), { kind: "CHECK_IN" }); })
    .concat(dbAll_("CheckOuts").map(function (x) { return Object.assign(checkEventOut_(x), { kind: "CHECK_OUT" }); }))
    .filter(function (x) {
      const r = resv[String(x.reservationId)];
      if (!r || !(canResv_(p, r, "checkin.operate") || canResv_(p, r, "reservation.view"))) return false;
      if (a.propertyId && String(r.propertyId) !== String(a.propertyId)) return false;
      const d = String(x.actualAt).slice(0, 10);
      if (a.from && d < a.from) return false; if (a.to && d > a.to) return false;
      if (a.lateOnly && !(x.lateMinutes > 0)) return false;
      return true;
    }).map(function (x) { const r = resv[String(x.reservationId)]; return Object.assign(x, { propertyName: (props[String(r.propertyId)] || {}).name, guestName: r.guestName }); })
    .sort(function (x, y) { return String(y.actualAt).localeCompare(String(x.actualAt)); });
  return pageOf_(rows, a);
}

/** Rapport PDF d'arrivée/départ (état des lieux simplifié). */
function opsReport_(p, a) {
  const r = assertResv_(p, a.reservationId, "reservation.view");
  const prop = dbGet_("Properties", r.propertyId);
  const ev = [];
  dbAll_("CheckIns").filter(function (x) { return String(x.reservationId) === String(r.reservationId); }).forEach(function (x) { ev.push(["Arrivée", checkEventOut_(x)]); });
  dbAll_("CheckOuts").filter(function (x) { return String(x.reservationId) === String(r.reservationId); }).forEach(function (x) { ev.push(["Départ", checkEventOut_(x)]); });
  assert_(ev.length, "Aucun check-in / check-out enregistré.");
  const docs = indexBy_(dbAll_("Documents"), "documentId");
  let html = "<p><b>Bien :</b> " + escapeHtml_(prop.name) + " — <b>Voyageur :</b> " + escapeHtml_(r.guestName) + " — <b>Séjour :</b> " + r.checkIn + " → " + r.checkOut + "</p>";
  ev.forEach(function (e) {
    const x = e[1];
    html += "<h2>" + e[0] + "</h2>" + htmlTable_(["Champ", "Valeur"], [["Prévu", x.plannedAt], ["Réel", x.actualAt], ["Retard (min)", x.lateMinutes], ["Agent", x.agentEmail], ["État", x.conditionNotes], ["Commentaires", x.comments],
      ["Compteurs", JSON.stringify(x.meters)], ["Incident", x.incidentId || "—"]]) +
      "<p><b>Checklist :</b> " + Object.keys(x.checklist).filter(function (k) { return k.indexOf("__") !== 0; }).map(function (k) { return escapeHtml_(k) + (x.checklist[k] ? " ✔" : " ✘"); }).join(" · ") + "</p>" +
      "<p><b>Photos :</b> " + x.photoDocIds.map(function (id) { return escapeHtml_((docs[id] || {}).fileName || id); }).join(", ") + "</p>" + (x.checklist.__signatureDocId ? "<p>Signature enregistrée (document " + escapeHtml_(x.checklist.__signatureDocId) + ")</p>" : "");
  });
  const pdf = htmlToPdf_(pdfShell_("Rapport d'arrivée / départ", html), "EtatDesLieux_" + r.reservationId);
  return storeGeneratedPdf_(p, pdf, { propertyId: prop.propertyId, organizationId: prop.organizationId }, "CHECKIN", r.reservationId, "REPORT");
}
