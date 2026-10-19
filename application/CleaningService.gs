/**
 * Ménage et contrôle qualité.
 * Cycle : CREATED (à attribuer) → OFFERED (proposée, délai d'acceptation calculé côté serveur) → ACCEPTED → IN_PROGRESS
 *         → COMPLETED (déclarée terminée) → VALIDATED (contrôlée par le responsable). EXPIRED / CANCELLED en sortie.
 * Refus ou empêchement : la mission revient à CREATED (sans prestataire) et le responsable est alerté.
 * L'expiration est vérifiée par la tâche planifiée jobFrequent (toutes les 15 min) sur horodatages serveur ;
 * l'interface n'affiche qu'un compte à rebours indicatif.
 */
var CLEAN_PRIORITIES_ = ["LOW", "NORMAL", "HIGH", "URGENT"];

function cleanMine_(p, m) { return String(m.providerUserId) === p.userId || (m.providerEmail && normalizeEmail_(m.providerEmail) === p.email); }
function cleanMgr_(p, m) { return canProp_(p, dbGet_("Properties", m.propertyId), "cleaning.manage"); }
function cleanLoad_(p, id, mode) {
  const m = dbGet_("CleaningMissions", safeText_(id, 120));
  if (!m) throw new AppError("FORBIDDEN", "Mission introuvable ou accès refusé.");
  const ok = mode === "provider" ? cleanMine_(p, m) && hasRole_(p, "CLEANER") : mode === "manager" ? cleanMgr_(p, m) : (cleanMine_(p, m) || cleanMgr_(p, m));
  if (!ok) throw new AppError("FORBIDDEN", "Mission introuvable ou accès refusé.");
  if (mode !== "read") assertOrgWritable_(m.organizationId);
  return m;
}
function cleanProvider_(email) {
  email = validateEmail_(email);
  const u = dbAll_("Users").find(function (x) { return normalizeEmail_(x.email) === email && x.status === "ACTIVE"; });
  assert_(u && dbAll_("UserRoles").some(function (r) { return String(r.userId) === String(u.userId) && r.role === "CLEANER" && r.status === "ACTIVE"; }), "Le prestataire doit avoir un compte actif avec le rôle CLEANER.");
  return u;
}
function cleanOffer_(m, provider, by) {
  const minutes = Number(getSetting_("cleaning.acceptanceMinutes", m.organizationId)) || 120;
  const patch = { providerUserId: provider.userId, providerEmail: normalizeEmail_(provider.email), status: "OFFERED", expiresAt: new Date(Date.now() + minutes * 60000).toISOString(),
    responseAt: "", expiryAlertedAt: "", declineReason: "", updatedAt: nowIso_(), reassignCount: (Number(m.reassignCount) || 0) + (m.providerUserId || m.status === "EXPIRED" ? 1 : 0) };
  dbUpdate_("CleaningMissions", m.missionId, patch);
  const prop = dbGet_("Properties", m.propertyId);
  notify_({ eventKey: "clean-offer:" + m.missionId + ":" + patch.expiresAt, userIds: [provider.userId], type: "CLEANING_OFFER", organizationId: m.organizationId,
    title: "Nouvelle mission de ménage : " + prop.name, body: "Prévue le " + Utilities.formatDate(parseTs_(m.startAt) || new Date(), tz_(), "dd/MM HH:mm") + ". Réponse attendue avant " + Utilities.formatDate(new Date(patch.expiresAt), tz_(), "dd/MM HH:mm") + ".", link: "#cleaning/" + m.missionId });
  return patch;
}
function cleanEstimate_(prop) { return 60 + 30 * (Number(prop.bedrooms) || 1); }

/** Création automatique après un départ (appelée par le check-out). Idempotent par réservation. */
function cleaningAutoCreate_(prop, r, p) {
  const ex = dbAll_("CleaningMissions").find(function (m) { return String(m.reservationId) === String(r.reservationId) && m.status !== "CANCELLED"; });
  if (ex) return ex;
  const start = new Date();
  const est = cleanEstimate_(prop);
  const m = dbInsert_("CleaningMissions", { organizationId: prop.organizationId, propertyId: prop.propertyId, reservationId: r.reservationId, providerUserId: "", providerEmail: "",
    startAt: start.toISOString(), endAt: new Date(start.getTime() + est * 60000).toISOString(), price: 0, currency: prop.currency || cur_(), status: "CREATED", priority: "HIGH",
    estimatedMinutes: est, notes: "Créée automatiquement après le départ de " + r.guestName, createdAt: nowIso_(), createdBy: p ? p.email : "system", updatedAt: nowIso_(), reassignCount: 0, source: "CHECKOUT" });
  const def = dbAll_("PropertyAssignments").find(function (a) { return String(a.propertyId) === String(prop.propertyId) && a.role === "CLEANER" && a.status === "ACTIVE"; });
  if (def) { try { const u = cleanProvider_(def.email); const patch = cleanOffer_(m, u); Object.assign(m, patch); } catch (e) { console.error("Auto-attribution ménage : " + e.message); } }
  else notify_({ eventKey: "clean-unassigned:" + m.missionId, userIds: propertyManagers_(prop, "canManageOperations"), type: "CLEANING_UNASSIGNED", organizationId: prop.organizationId,
    title: "Mission de ménage à attribuer : " + prop.name, body: "Aucune équipe de ménage n'est associée au bien.", link: "#cleaning/" + m.missionId });
  auditAs_(p ? p.email : "system", p ? p.userId : "", "CLEANING_MISSION_CREATED", "CleaningMission", m.missionId, prop.organizationId, { source: "CHECKOUT", status: m.status });
  return m;
}

function cleanOut_(p, m, props) {
  const prop = (props || {})[String(m.propertyId)] || dbGet_("Properties", m.propertyId) || {};
  const mgr = cleanMgr_(p, m);
  const late = ["ACCEPTED", "OFFERED", "CREATED"].indexOf(m.status) >= 0 && parseTs_(m.startAt) && parseTs_(m.startAt).getTime() + 30 * 60000 < Date.now();
  return { missionId: m.missionId, propertyId: m.propertyId, propertyName: prop.name, address: prop.address, reservationId: m.reservationId, providerEmail: m.providerEmail, status: m.status,
    priority: m.priority, startAt: m.startAt, endAt: m.endAt, estimatedMinutes: m.estimatedMinutes, expiresAt: m.expiresAt, acceptedAt: m.acceptedAt, startedAt: m.startedAt, completedAt: m.completedAt,
    actualMinutes: m.actualMinutes, validatedAt: m.validatedAt, notes: m.notes, anomalies: parseJson_(m.anomaliesJson, []), reassignCount: m.reassignCount, declineReason: m.declineReason,
    price: mgr || cleanMine_(p, m) ? m.price : null, currency: m.currency, qualityScore: m.qualityScore, validationNote: m.validationNote, late: !!late, isMine: cleanMine_(p, m), canManage: mgr,
    serverNow: nowIso_() };
}

/* ------------------------------ Routes ------------------------------ */
function cleanList_(p, a) {
  a = a || {};
  const props = indexBy_(dbAll_("Properties"), "propertyId");
  const rows = dbAll_("CleaningMissions").filter(function (m) {
    if (!(cleanMine_(p, m) || canProp_(p, props[String(m.propertyId)], "cleaning.manage"))) return false;
    if (a.mine && !cleanMine_(p, m)) return false;
    if (a.propertyId && String(m.propertyId) !== String(a.propertyId)) return false;
    if (a.status) { if (String(a.status).split(",").indexOf(m.status) < 0) return false; }
    const d = String(m.startAt).slice(0, 10);
    if (a.from && d < a.from) return false; if (a.to && d > a.to) return false;
    return matchesQuery_(a.q, [m.providerEmail, (props[String(m.propertyId)] || {}).name, m.missionId]);
  }).sort(function (x, y) { return String(y.startAt).localeCompare(String(x.startAt)); });
  const page = pageOf_(rows, a);
  page.items = page.items.map(function (m) { return cleanOut_(p, m, props); });
  return page;
}
function cleanGet_(p, a) {
  const m = cleanLoad_(p, a.missionId, "read");
  const prop = dbGet_("Properties", m.propertyId);
  const o = cleanOut_(p, m);
  o.rooms = parseJson_(prop.roomsJson, []);
  o.checklistTemplate = parseJson_(prop.cleaningChecklistJson, []).length ? parseJson_(prop.cleaningChecklistJson, []) : ["Sols", "Surfaces", "Linge changé", "Sanitaires", "Poubelles", "Consommables"];
  o.accessInstructions = prop.accessInstructions;
  o.checklists = dbAll_("CleaningChecklists").filter(function (c) { return String(c.missionId) === String(m.missionId); }).map(function (c) { return { room: c.room, items: parseJson_(c.itemsJson, {}), doneAt: c.doneAt }; });
  o.photos = dbAll_("CleaningPhotos").filter(function (c) { return String(c.missionId) === String(m.missionId); }).map(function (c) { return { photoId: c.photoId, room: c.room, phase: c.phase, documentId: c.documentId, takenAt: c.takenAt }; });
  o.legacyReports = dbAll_("CleaningReports").filter(function (c) { return String(c.missionId) === String(m.missionId); }).map(function (c) { return { submittedAt: c.submittedAt, checklist: parseJson_(c.checklistJson, {}), notes: c.notes }; });
  o.history = auditHistory_("CleaningMission", m.missionId, 30);
  return o;
}
function cleanCreate_(p, a) {
  const prop = assertProp_(p, a.propertyId, "cleaning.manage");
  let reservationId = safeText_(a.reservationId || "", 120);
  if (reservationId) { const r = dbGet_("Reservations", reservationId); assert_(r && String(r.propertyId) === String(prop.propertyId), "Réservation d'un autre bien."); }
  const start = parseTs_(a.startAt); assert_(start, "Date et heure prévues obligatoires.");
  const est = a.estimatedMinutes ? Math.round(Number(a.estimatedMinutes)) : cleanEstimate_(prop);
  assert_(est >= 15 && est <= 1440, "Durée estimée invalide (15 à 1440 min).");
  const provider = a.providerEmail ? cleanProvider_(a.providerEmail) : null;
  return withLock_(function () {
    const m = dbInsert_("CleaningMissions", { organizationId: prop.organizationId, propertyId: prop.propertyId, reservationId: reservationId, providerUserId: "", providerEmail: "",
      startAt: start.toISOString(), endAt: new Date(start.getTime() + est * 60000).toISOString(), price: a.price === "" || a.price == null ? 0 : money_(a.price, "Tarif"), currency: prop.currency || cur_(),
      status: "CREATED", priority: oneOf_(a.priority || "NORMAL", CLEAN_PRIORITIES_, "Priorité"), estimatedMinutes: est, notes: safeText_(a.notes, 1000), createdAt: nowIso_(), createdBy: p.email,
      updatedAt: nowIso_(), reassignCount: 0, source: "MANUAL" });
    if (provider) cleanOffer_(m, provider);
    audit_("CLEANING_MISSION_CREATED", "CleaningMission", m.missionId, prop.organizationId, { source: "MANUAL", offered: !!provider });
    return { ok: true, missionId: m.missionId, id: m.missionId };
  });
}
function cleanAssign_(p, a) {
  const m0 = cleanLoad_(p, a.missionId, "manager");
  const provider = cleanProvider_(a.providerEmail);
  return withLock_(function () {
    const m = dbGet_("CleaningMissions", m0.missionId);
    assert_(["CREATED", "EXPIRED", "OFFERED", "DECLINED"].indexOf(m.status) >= 0, "Mission non réattribuable (statut " + m.status + ").");
    cleanOffer_(m, provider);
    audit_("CLEANING_ASSIGNED", "CleaningMission", m.missionId, m.organizationId, { provider: provider.email, reassign: !!m.providerUserId || m.status === "EXPIRED" });
    return { ok: true };
  });
}
/** Réponse du prestataire : ACCEPTED, DECLINED (offre) ou UNAVAILABLE (empêchement après acceptation). */
function cleanRespond_(p, a) {
  const m0 = cleanLoad_(p, a.missionId, "provider");
  const decision = oneOf_(a.decision, ["ACCEPTED", "DECLINED", "UNAVAILABLE"], "Décision");
  return withLock_(function () {
    const m = dbGet_("CleaningMissions", m0.missionId), prop = dbGet_("Properties", m.propertyId);
    if (decision === "UNAVAILABLE") assert_(m.status === "ACCEPTED", "Empêchement possible uniquement sur une mission acceptée et non démarrée.");
    else {
      assert_(m.status === "OFFERED", "Mission déjà traitée (statut " + m.status + ").");
      assert_(parseTs_(m.expiresAt).getTime() > Date.now(), "Le délai d'acceptation est dépassé.", "EXPIRED");
    }
    if (decision === "ACCEPTED") dbUpdate_("CleaningMissions", m.missionId, { status: "ACCEPTED", responseAt: nowIso_(), acceptedAt: nowIso_(), updatedAt: nowIso_() });
    else {
      const reason = decision === "UNAVAILABLE" ? reqText_(a.reason, "Motif de l'empêchement", 3, 300) : safeText_(a.reason, 300);
      dbUpdate_("CleaningMissions", m.missionId, { status: "CREATED", providerUserId: "", providerEmail: "", responseAt: nowIso_(), declineReason: reason, updatedAt: nowIso_() });
      notify_({ eventKey: "clean-" + decision + ":" + m.missionId + ":" + Date.now(), userIds: propertyManagers_(prop, "canManageOperations"), type: "CLEANING_DECLINED", organizationId: m.organizationId,
        title: (decision === "DECLINED" ? "Mission refusée : " : "Empêchement signalé : ") + prop.name, body: p.email + (reason ? " — " + reason : "") + ". Réattribuez la mission.", link: "#cleaning/" + m.missionId });
    }
    audit_("CLEANING_" + decision, "CleaningMission", m.missionId, m.organizationId, { provider: p.email });
    return { ok: true, status: decision === "ACCEPTED" ? "ACCEPTED" : "CREATED" };
  });
}
function cleanStart_(p, a) {
  const m = cleanLoad_(p, a.missionId, "provider");
  assert_(m.status === "ACCEPTED", "La mission doit être acceptée avant de démarrer.");
  dbUpdate_("CleaningMissions", m.missionId, { status: "IN_PROGRESS", startedAt: nowIso_(), updatedAt: nowIso_() });
  audit_("CLEANING_STARTED", "CleaningMission", m.missionId, m.organizationId, {});
  return { ok: true };
}
/** Contrôle par pièce : checklist + rattachement des photos avant/après (documents déjà déposés sur la mission). */
function cleanRoom_(p, a) {
  const m = cleanLoad_(p, a.missionId, "provider");
  assert_(m.status === "IN_PROGRESS", "La mission doit être en cours.");
  const room = reqText_(a.room, "Pièce", 1, 60);
  const items = {}; if (a.items && typeof a.items === "object") Object.keys(a.items).slice(0, 40).forEach(function (k) { items[safeText_(k, 120)] = a.items[k] === true; });
  const before = assertDocsOf_(a.beforeDocIds || [], "CLEANING", m.missionId), after = assertDocsOf_(a.afterDocIds || [], "CLEANING", m.missionId);
  return withLock_(function () {
    const ex = dbAll_("CleaningChecklists").find(function (c) { return String(c.missionId) === String(m.missionId) && c.room === room; });
    const done = Object.keys(items).length > 0 && Object.keys(items).every(function (k) { return items[k]; });
    if (ex) dbUpdate_("CleaningChecklists", ex.checklistId, { itemsJson: items, doneAt: done ? nowIso_() : "", updatedAt: nowIso_() });
    else dbInsert_("CleaningChecklists", { organizationId: m.organizationId, missionId: m.missionId, room: room, itemsJson: items, doneAt: done ? nowIso_() : "", updatedAt: nowIso_() });
    const known = {}; dbAll_("CleaningPhotos").forEach(function (c) { if (String(c.missionId) === String(m.missionId)) known[c.documentId] = true; });
    const rows = [];
    before.forEach(function (d) { if (!known[d]) rows.push({ organizationId: m.organizationId, missionId: m.missionId, propertyId: m.propertyId, room: room, phase: "BEFORE", documentId: d, takenAt: nowIso_(), takenBy: p.email }); });
    after.forEach(function (d) { if (!known[d]) rows.push({ organizationId: m.organizationId, missionId: m.missionId, propertyId: m.propertyId, room: room, phase: "AFTER", documentId: d, takenAt: nowIso_(), takenBy: p.email }); });
    dbInsertMany_("CleaningPhotos", rows);
    audit_("CLEANING_ROOM_UPDATED", "CleaningMission", m.missionId, m.organizationId, { room: room, done: done, photos: rows.length });
    return { ok: true, done: done, photosAdded: rows.length };
  });
}
/** Anomalie (objet manquant, dégradation…), avec création facultative d'un incident lié à la mission. */
function cleanAnomaly_(p, a) {
  const m = cleanLoad_(p, a.missionId, "read");
  assert_(cleanMine_(p, m) || cleanMgr_(p, m), "Accès refusé.", "FORBIDDEN");
  assert_(["ACCEPTED", "IN_PROGRESS", "COMPLETED"].indexOf(m.status) >= 0, "Mission non active.");
  const type = oneOf_(a.type || "OTHER", getSetting_("list.cleaningAnomalies", m.organizationId), "Type d'anomalie");
  const desc = reqText_(a.description, "Description", 3, 1000);
  return withLock_(function () {
    const fresh = dbGet_("CleaningMissions", m.missionId);
    const list = parseJson_(fresh.anomaliesJson, []);
    let incidentId = "";
    if (a.createIncident) {
      const prop = dbGet_("Properties", m.propertyId);
      incidentId = incidentInsert_(p, prop, { category: type === "DAMAGE" || type === "BREAKAGE" ? "DAMAGE" : (type === "DIRT" ? "CLEANING" : "OTHER"), severity: a.severity || "MEDIUM",
        description: desc, title: "Ménage — " + type + (a.room ? " (" + a.room + ")" : ""), reservationId: m.reservationId, missionId: m.missionId, source: "CLEANING", photoDocIds: [] }).incidentId;
    }
    list.push({ type: type, room: safeText_(a.room, 60), description: desc, at: nowIso_(), by: p.email, incidentId: incidentId });
    dbUpdate_("CleaningMissions", m.missionId, { anomaliesJson: list, updatedAt: nowIso_() });
    audit_("CLEANING_ANOMALY_REPORTED", "CleaningMission", m.missionId, m.organizationId, { type: type, incidentId: incidentId });
    return { ok: true, incidentId: incidentId };
  });
}
function cleanComplete_(p, a) {
  const m = cleanLoad_(p, a.missionId, "provider");
  assert_(m.status === "IN_PROGRESS", "La mission doit être en cours.");
  const lists = dbAll_("CleaningChecklists").filter(function (c) { return String(c.missionId) === String(m.missionId); });
  assert_(lists.length > 0, "Renseignez la checklist d'au moins une pièce.");
  if (getSetting_("cleaning.requirePhotos", m.organizationId) !== false) {
    const photos = dbAll_("CleaningPhotos").filter(function (c) { return String(c.missionId) === String(m.missionId); });
    const missing = lists.filter(function (l) { return !photos.some(function (x) { return x.room === l.room && x.phase === "BEFORE"; }) || !photos.some(function (x) { return x.room === l.room && x.phase === "AFTER"; }); }).map(function (l) { return l.room; });
    assert_(!missing.length, "Photos avant ET après requises pour : " + missing.join(", ") + ".");
  }
  const computed = m.startedAt ? Math.max(1, Math.round((Date.now() - parseTs_(m.startedAt).getTime()) / 60000)) : null;
  const declared = a.actualMinutes ? Math.round(Number(a.actualMinutes)) : computed;
  assert_(declared && declared >= 1 && declared <= 1440, "Durée réelle invalide.");
  dbUpdate_("CleaningMissions", m.missionId, { status: "COMPLETED", completedAt: nowIso_(), actualMinutes: declared, notes: a.notes ? safeText_((m.notes ? m.notes + "\n" : "") + a.notes, 1000) : m.notes, updatedAt: nowIso_() });
  const prop = dbGet_("Properties", m.propertyId);
  audit_("CLEANING_COMPLETED", "CleaningMission", m.missionId, m.organizationId, { actualMinutes: declared, measuredMinutes: computed });
  notify_({ eventKey: "clean-done:" + m.missionId, userIds: propertyManagers_(prop, "canManageOperations"), type: "CLEANING_DONE", organizationId: m.organizationId,
    title: "Ménage terminé, à valider : " + prop.name, body: "Durée déclarée : " + declared + " min.", link: "#cleaning/" + m.missionId, email: false });
  return { ok: true, actualMinutes: declared };
}
/** Validation (ou renvoi) par le responsable ; crée la dépense de ménage une seule fois (clé unique). */
function cleanValidate_(p, a) {
  const m0 = cleanLoad_(p, a.missionId, "manager");
  return withLock_(function () {
    const m = dbGet_("CleaningMissions", m0.missionId);
    assert_(m.status === "COMPLETED", "Seule une mission terminée peut être contrôlée.");
    if (a.decision === "REJECT") {
      dbUpdate_("CleaningMissions", m.missionId, { status: "IN_PROGRESS", validationNote: reqText_(a.note, "Motif", 3, 500), updatedAt: nowIso_() });
      notify_({ eventKey: "clean-reject:" + m.missionId + ":" + Date.now(), userIds: [m.providerUserId], type: "CLEANING_REJECTED", organizationId: m.organizationId, title: "Mission à reprendre", body: a.note, link: "#cleaning/" + m.missionId });
      audit_("CLEANING_REJECTED", "CleaningMission", m.missionId, m.organizationId, {});
      return { ok: true, status: "IN_PROGRESS" };
    }
    const score = a.qualityScore === undefined || a.qualityScore === "" ? "" : Math.round(Number(a.qualityScore));
    assert_(score === "" || (score >= 1 && score <= 5), "Note qualité de 1 à 5.");
    const price = a.price === undefined || a.price === "" ? num_(m.price) : money_(a.price, "Tarif");
    dbUpdate_("CleaningMissions", m.missionId, { status: "VALIDATED", validatedAt: nowIso_(), validatedBy: p.email, qualityScore: score, validationNote: safeText_(a.note, 500), price: price, updatedAt: nowIso_() });
    if (price > 0) dbInsertUnique_("Expenses", "uniqueKey", "cleaning:" + m.missionId, { organizationId: m.organizationId, propertyId: m.propertyId, category: "CLEANING", description: "Ménage mission " + m.missionId,
      supplier: m.providerEmail, amount: price, vatAmount: 0, currency: m.currency || cur_(), expenseDate: String(m.completedAt || nowIso_()).slice(0, 10), status: "INVOICED", refType: "CLEANING", refId: m.missionId, createdAt: nowIso_(), createdBy: p.email });
    audit_("CLEANING_VALIDATED", "CleaningMission", m.missionId, m.organizationId, { qualityScore: score, price: price });
    return { ok: true, status: "VALIDATED" };
  });
}
function cleanCancel_(p, a) {
  const m = cleanLoad_(p, a.missionId, "manager");
  assert_(["CREATED", "OFFERED", "ACCEPTED", "EXPIRED"].indexOf(m.status) >= 0, "Mission non annulable.");
  dbUpdate_("CleaningMissions", m.missionId, { status: "CANCELLED", updatedAt: nowIso_(), validationNote: safeText_(a.reason, 300) });
  audit_("CLEANING_CANCELLED", "CleaningMission", m.missionId, m.organizationId, {});
  return { ok: true };
}

/* ------------------------- Documents PDF : ordre de mission et rapport de ménage ------------------------- */
/** Donneur d'ordre (agence qui gère le bien si c'est elle qui a créé ou validé la mission, sinon le propriétaire) et prestataire. */
function cleanParties_(m, prop) {
  const ownerOrg = dbGet_("Organizations", prop.organizationId) || {};
  const byOrg = dbGet_("Organizations", commissionBeneficiary_({ createdBy: m.validatedBy || m.createdBy }, prop)) || ownerOrg;
  const u = m.providerUserId ? dbGet_("Users", m.providerUserId) : null;
  const art = dbAll_("Artisans").find(function (c) { return m.providerEmail && normalizeEmail_(c.email) === normalizeEmail_(m.providerEmail) && c.status !== "BLOCKED"; });
  return { owner: ownerOrg, orderer: byOrg, provider: { name: (art && art.name) || (u && u.displayName) || m.providerEmail || "À attribuer", email: m.providerEmail || "", phone: (art && art.phone) || (u && u.phone) || "" } };
}
function cleanDT_(s) { const d = parseTs_(s); return d ? Utilities.formatDate(d, tz_(), "dd/MM/yyyy HH:mm") : "—"; }
function cleanMoney_(v, cur) { return v === "" || v == null ? "—" : (Math.round(num_(v) * 100) / 100).toLocaleString("fr-FR") + " " + (cur || cur_()); }

/** Ordre de mission de ménage (avant intervention) : parties, lieu, horaires, tarif convenu, consignes et engagements. */
function cleanOrderPdf_(p, a) {
  const m = cleanLoad_(p, a.missionId, "read"), prop = dbGet_("Properties", m.propertyId), P = cleanParties_(m, prop);
  const rooms = parseJson_(prop.roomsJson, []), tasks = parseJson_(prop.cleaningChecklistJson, []).length ? parseJson_(prop.cleaningChecklistJson, []) : ["Sols", "Surfaces", "Linge changé", "Sanitaires", "Poubelles", "Consommables"];
  let html = "<h2>Parties</h2>" + htmlTable_(["", "Organisation / personne", "Contact"], [
    ["Donneur d'ordre", P.orderer.name || "", P.orderer.billingEmail || ""], ["Propriétaire du bien (règlement)", P.owner.name || "", P.owner.billingEmail || ""],
    ["Prestataire", P.provider.name, [P.provider.email, P.provider.phone].filter(String).join(" — ")]]);
  html += "<h2>Mission</h2>" + htmlTable_(["Champ", "Valeur"], [["Référence", m.missionId], ["Bien", prop.name], ["Adresse", [prop.address, prop.neighborhood, prop.city].filter(String).join(", ")],
    ["Début prévu", cleanDT_(m.startAt)], ["Fin prévue", cleanDT_(m.endAt)], ["Durée estimée", (m.estimatedMinutes || "—") + " min"], ["Priorité", ({ LOW: "Basse", NORMAL: "Normale", HIGH: "Haute", URGENT: "Urgente" })[m.priority || "NORMAL"] || m.priority],
    ["Tarif convenu", cleanMoney_(m.price, m.currency)], ["Réservation liée", m.reservationId || "—"], ["Consignes", m.notes || "—"]]);
  html += "<h2>Pièces et tâches attendues</h2>" + htmlTable_(["Pièce", "Tâches"], (rooms.length ? rooms : ["Logement"]).map(function (r) { return [r, tasks.join(", ")]; }));
  html += "<h2>Engagements</h2><div class='box'><ul style='margin:0;padding-left:16px'>" + [
    "Accepter ou refuser la mission dans le délai indiqué dans l'application.",
    "Prendre des photos AVANT et APRÈS dans chaque pièce et cocher la liste des tâches dans l'application.",
    "Signaler immédiatement toute anomalie (objet manquant, casse, dégradation) depuis la mission.",
    "Respecter les consignes d'accès et la confidentialité des lieux ; restituer les clés selon les consignes.",
    "La mission est réglée au tarif convenu après validation par le donneur d'ordre ; la dépense est imputée au propriétaire du bien."
  ].map(function (x) { return "<li>" + escapeHtml_(x) + "</li>"; }).join("") + "</ul></div>";
  html += "<h2>Signatures</h2><table class='sign'><tr><td>Le donneur d'ordre<br><span class='muted'>" + escapeHtml_(P.orderer.name || "") + "</span></td><td>Le prestataire<br><span class='muted'>" + escapeHtml_(P.provider.name) + "</span></td></tr></table>";
  html += "<p class='muted'>Modèle indicatif : à adapter et faire valider par un professionnel avant usage contractuel.</p>";
  audit_("CLEANING_ORDER_PDF", "CleaningMission", m.missionId, m.organizationId, {});
  return storeGeneratedPdf_(p, htmlToPdf_(pdfShell_("Ordre de mission de ménage", html, { subtitle: prop.name + " — " + cleanDT_(m.startAt) }), "OrdreMission_" + m.missionId),
    { propertyId: prop.propertyId, organizationId: prop.organizationId }, "CLEANING", m.missionId, "ORDER");
}

/** Rapport de ménage (après intervention) : horaires réels, liste par pièce, photos avant / après, anomalies, validation. */
function cleanReportPdf_(p, a) {
  const m = cleanLoad_(p, a.missionId, "read"), prop = dbGet_("Properties", m.propertyId), P = cleanParties_(m, prop);
  assert_(["COMPLETED", "VALIDATED"].indexOf(m.status) >= 0, "Le rapport est disponible quand la mission est terminée.");
  const checklists = dbAll_("CleaningChecklists").filter(function (c) { return String(c.missionId) === String(m.missionId); });
  const photos = dbAll_("CleaningPhotos").filter(function (c) { return String(c.missionId) === String(m.missionId); });
  const anomalies = parseJson_(m.anomaliesJson, []);
  let html = "<h2>Synthèse</h2>" + htmlTable_(["Champ", "Valeur"], [["Référence", m.missionId], ["Bien", prop.name + " — " + [prop.address, prop.city].filter(String).join(", ")],
    ["Prestataire", P.provider.name], ["Donneur d'ordre", P.orderer.name || ""], ["Prévu", cleanDT_(m.startAt) + " → " + cleanDT_(m.endAt)],
    ["Réalisé", cleanDT_(m.startedAt) + " → " + cleanDT_(m.completedAt)], ["Durée réelle", (m.actualMinutes || "—") + " min (estimée : " + (m.estimatedMinutes || "—") + " min)"],
    ["Statut", m.status === "VALIDATED" ? "Validée le " + cleanDT_(m.validatedAt) + " par " + (m.validatedBy || "") : "Terminée, en attente de validation"],
    ["Note qualité", m.qualityScore ? m.qualityScore + " / 5" : "—"], ["Tarif", cleanMoney_(m.price, m.currency)], ["Anomalies", String(anomalies.length)]]);
  html += "<h2>Liste des tâches par pièce</h2>" + (checklists.length ? htmlTable_(["Pièce", "Tâches réalisées", "Terminé le"], checklists.map(function (c) {
    const it = parseJson_(c.itemsJson, {}); return [c.room, Object.keys(it).map(function (k) { return (it[k] ? "✔ " : "✘ ") + k; }).join(" · "), cleanDT_(c.doneAt)]; })) : "<p class='muted'>Aucune liste de tâches enregistrée.</p>");
  const roomsWithPhotos = []; photos.forEach(function (ph) { if (roomsWithPhotos.indexOf(ph.room) < 0) roomsWithPhotos.push(ph.room); });
  html += "<h2>Photos avant / après</h2>";
  if (!photos.length) html += "<p class='muted'>Aucune photo enregistrée pour cette mission.</p>";
  let embedded = 0;
  roomsWithPhotos.slice(0, 8).forEach(function (room) {
    const pick = function (phase) { const x = photos.filter(function (ph) { return ph.room === room && ph.phase === phase; })[0]; if (!x || embedded >= 16) return "<span class='muted'>—</span>"; const src = pdfImageData_(x.documentId); if (!src) return "<span class='muted'>Photo consultable dans l'application</span>"; embedded++; return "<img src='" + src + "'>"; };
    html += "<p style='margin:8px 0 2px'><b>" + escapeHtml_(room) + "</b></p><table class='photos'><tr><td><b>AVANT</b><br>" + pick("BEFORE") + "</td><td><b>APRÈS</b><br>" + pick("AFTER") + "</td></tr></table>";
  });
  html += "<h2>Anomalies signalées</h2>" + (anomalies.length ? htmlTable_(["Type", "Pièce", "Description", "Date"], anomalies.map(function (x) { return [x.type, x.room || "", x.description || "", cleanDT_(x.at)]; })) : "<p>Aucune anomalie signalée.</p>");
  if (m.validationNote) html += "<h2>Commentaire de validation</h2><p>" + escapeHtml_(m.validationNote) + "</p>";
  html += "<h2>Signatures</h2><table class='sign'><tr><td>Le prestataire<br><span class='muted'>" + escapeHtml_(P.provider.name) + "</span></td><td>Le donneur d'ordre<br><span class='muted'>" + escapeHtml_(P.orderer.name || "") + "</span></td></tr></table>";
  audit_("CLEANING_REPORT_PDF", "CleaningMission", m.missionId, m.organizationId, { photos: embedded });
  return storeGeneratedPdf_(p, htmlToPdf_(pdfShell_("Rapport de ménage", html, { subtitle: prop.name + " — " + cleanDT_(m.completedAt) }), "RapportMenage_" + m.missionId),
    { propertyId: prop.propertyId, organizationId: prop.organizationId }, "CLEANING", m.missionId, "REPORT");
}

/** Tâche planifiée : expiration des offres non acceptées et alertes de retard. */
function cleaningExpireJob_() {
  const now = Date.now(); let expired = 0, late = 0;
  dbAll_("CleaningMissions").filter(function (m) { return m.status === "OFFERED" && parseTs_(m.expiresAt) && parseTs_(m.expiresAt).getTime() <= now; }).forEach(function (m) {
    dbUpdate_("CleaningMissions", m.missionId, { status: "EXPIRED", expiryAlertedAt: nowIso_(), updatedAt: nowIso_() });
    auditAs_("system", "", "CLEANING_EXPIRED", "CleaningMission", m.missionId, m.organizationId, { provider: m.providerEmail });
    const prop = dbGet_("Properties", m.propertyId);
    if (prop) notify_({ eventKey: "clean-expired:" + m.missionId + ":" + m.expiresAt, userIds: propertyManagers_(prop, "canManageOperations"), type: "CLEANING_EXPIRED", organizationId: m.organizationId,
      title: "Mission de ménage non acceptée : " + prop.name, body: "Aucune réponse de " + m.providerEmail + " dans le délai. Réattribuez la mission.", link: "#cleaning/" + m.missionId });
    expired++;
  });
  dbAll_("CleaningMissions").filter(function (m) { return m.status === "ACCEPTED" && !m.lateAlertedAt && parseTs_(m.startAt) && parseTs_(m.startAt).getTime() + 30 * 60000 < now; }).forEach(function (m) {
    dbUpdate_("CleaningMissions", m.missionId, { lateAlertedAt: nowIso_() });
    const prop = dbGet_("Properties", m.propertyId);
    if (prop) notify_({ eventKey: "clean-late:" + m.missionId, userIds: propertyManagers_(prop, "canManageOperations").concat([m.providerUserId]), type: "CLEANING_LATE", organizationId: m.organizationId,
      title: "Mission de ménage non démarrée : " + prop.name, body: "Prévue à " + Utilities.formatDate(parseTs_(m.startAt), tz_(), "dd/MM HH:mm") + ".", link: "#cleaning/" + m.missionId });
    late++;
  });
  return { expired: expired, lateAlerts: late };
}
