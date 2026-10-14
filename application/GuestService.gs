/**
 * Voyageurs et pièces d'identité (données sensibles).
 * Minimisation : la référence complète de la pièce n'est conservée que si le paramètre guests.storeIdReference est activé
 * (obligation légale validée localement) ; sinon seuls les 3 derniers caractères sont gardés. Les scans sont stockés
 * comme documents sensibles (accès guestdoc.view uniquement), purgés automatiquement après la durée de rétention,
 * jamais exportés, jamais joints à un e-mail, jamais écrits dans les journaux.
 *
 * Portail voyageur : accès sans compte, par lien à jeton (256 bits, haché en base), limité à UNE réservation,
 * valable jusqu'au lendemain du départ, révocable.
 */
var ID_TYPES_ = ["CIN", "PASSPORT", "RESIDENCE_PERMIT", "DRIVING_LICENSE", "OTHER"];

function maskIdRef_(ref, orgId) {
  ref = safeText_(ref, 40).replace(/\s+/g, "").toUpperCase();
  if (!ref) return "";
  assert_(/^[A-Z0-9-]{3,40}$/.test(ref), "Référence de pièce invalide.");
  return getSetting_("guests.storeIdReference", orgId) === true ? ref : "****" + ref.slice(-3);
}
function guestOut_(g, level) {
  const o = { guestId: g.guestId, firstName: g.firstName, lastName: g.lastName, isPrimary: g.isPrimary, status: g.status };
  if (level !== "min") { o.email = g.email; o.phone = g.phone; }
  if (level === "full") { o.nationality = g.nationality; o.idType = g.idType; o.idRef = g.idRefMasked; }
  return o;
}
function guestListFor_(p, r) {
  const level = canResv_(p, r, "guestdoc.view") ? "full" : (canResv_(p, r, "guest.view") ? "std" : "min");
  return dbAll_("Guests").filter(function (g) { return String(g.reservationId) === String(r.reservationId); }).map(function (g) {
    const o = guestOut_(g, level);
    if (level === "full") o.documents = dbAll_("Documents").filter(function (d) { return d.ownerType === "GUEST" && String(d.ownerId) === String(g.guestId) && d.status === "ACTIVE"; })
      .map(function (d) { return { documentId: d.documentId, fileName: d.fileName, category: d.category, createdAt: d.createdAt }; });
    return o;
  });
}
function guestApplyInput_(a, orgId) {
  const o = {};
  if (a.lastName !== undefined) o.lastName = reqText_(a.lastName, "Nom", 1, 80);
  if (a.firstName !== undefined) o.firstName = safeText_(a.firstName, 80);
  if (a.email !== undefined) o.email = a.email ? validateEmail_(a.email) : "";
  if (a.phone !== undefined) o.phone = safeText_(a.phone, 30);
  if (a.nationality !== undefined) o.nationality = safeText_(a.nationality, 60);
  if (a.idType !== undefined) o.idType = a.idType ? oneOf_(a.idType, ID_TYPES_, "Type de pièce") : "";
  if (a.idRef !== undefined) o.idRefMasked = maskIdRef_(a.idRef, orgId);
  return o;
}

/* --------------------------- Routes authentifiées --------------------------- */
function guestList_(p, a) {
  a = a || {};
  if (a.reservationId) { const r = assertResv_(p, a.reservationId, "guest.view"); return { items: guestListFor_(p, r), total: 0 }; }
  const props = indexBy_(dbAll_("Properties"), "propertyId"), resv = indexBy_(dbAll_("Reservations"), "reservationId");
  const rows = dbAll_("Guests").filter(function (g) {
    const r = resv[String(g.reservationId)];
    if (!r || !canResv_(p, r, "guest.view")) return false;
    if (a.propertyId && String(r.propertyId) !== String(a.propertyId)) return false;
    if (a.from && r.checkOut < a.from) return false; if (a.to && r.checkIn > a.to) return false;
    return matchesQuery_(a.q, [g.lastName, g.firstName, g.email, g.phone, r.reservationId]);
  }).map(function (g) {
    const r = resv[String(g.reservationId)];
    return Object.assign(guestOut_(g, "std"), { reservationId: r.reservationId, propertyName: (props[String(r.propertyId)] || {}).name, checkIn: r.checkIn, checkOut: r.checkOut, idProvided: !!g.idType });
  }).sort(function (x, y) { return String(y.checkIn).localeCompare(String(x.checkIn)); });
  return pageOf_(rows, a);
}
function guestSave_(p, a) {
  const r = assertResv_(p, a.reservationId, "reservation.edit");
  const data = guestApplyInput_(a, r.organizationId);
  if (data.idType || data.idRefMasked) assert_(canResv_(p, r, "guestdoc.view"), "Droits insuffisants pour enregistrer une pièce d'identité.", "FORBIDDEN");
  return withLock_(function () {
    if (a.guestId) {
      const g = dbGet_("Guests", safeText_(a.guestId, 120));
      assert_(g && String(g.reservationId) === String(r.reservationId) && g.status === "ACTIVE", "Voyageur introuvable pour cette réservation.");
      data.updatedAt = nowIso_(); dbUpdate_("Guests", g.guestId, data);
      audit_("GUEST_UPDATED", "Guest", g.guestId, r.organizationId, { fields: Object.keys(data) });
      return { ok: true, guestId: g.guestId };
    }
    const count = dbAll_("Guests").filter(function (g) { return String(g.reservationId) === String(r.reservationId) && g.status === "ACTIVE"; }).length;
    assert_(count < Math.max(Number(r.guestCount) || 1, 1) + 2, "Nombre de fiches voyageurs supérieur au nombre de voyageurs.");
    assert_(data.lastName, "Nom obligatoire.");
    const g = dbInsert_("Guests", Object.assign({ organizationId: r.organizationId, propertyId: r.propertyId, reservationId: r.reservationId, isPrimary: false, status: "ACTIVE", createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_() }, data));
    audit_("GUEST_CREATED", "Guest", g.guestId, r.organizationId, { reservationId: r.reservationId });
    return { ok: true, guestId: g.guestId };
  });
}
/** Effacement des données d'identité d'un voyageur (droit à l'effacement / fin de nécessité). */
function guestPurge_(p, a) {
  const g = dbGet_("Guests", safeText_(a.guestId, 120));
  if (!g) notFound_("Voyageur");
  const r = assertResv_(p, g.reservationId, "guestdoc.view");
  dbUpdate_("Guests", g.guestId, { idType: "", idRefMasked: "", nationality: "", status: "PURGED", purgedAt: nowIso_() });
  dbAll_("Documents").filter(function (d) { return d.ownerType === "GUEST" && String(d.ownerId) === String(g.guestId) && d.status === "ACTIVE"; }).forEach(function (d) {
    try { DriveApp.getFileById(d.fileId).setTrashed(true); } catch (e) { console.error(e.message); }
    dbUpdate_("Documents", d.documentId, { status: "PURGED", purgedAt: nowIso_() });
  });
  audit_("GUEST_DATA_PURGED", "Guest", g.guestId, r.organizationId, {});
  return { ok: true };
}

/* --------------------------- Portail voyageur --------------------------- */
function guestTokenCreate_(p, a) {
  const r = assertResv_(p, a.reservationId, "reservation.edit");
  assert_(["PENDING", "CONFIRMED", "IN_PROGRESS"].indexOf(r.status) >= 0, "Réservation inactive.");
  assertFeature_(r.organizationId, "guest_portal");
  const token = randomToken_();
  withLock_(function () {
    dbAll_("GuestAccessTokens").filter(function (t) { return String(t.reservationId) === String(r.reservationId) && t.status === "ACTIVE"; }).forEach(function (t) { dbUpdate_("GuestAccessTokens", t.tokenId, { status: "REVOKED" }); });
    dbInsert_("GuestAccessTokens", { organizationId: r.organizationId, reservationId: r.reservationId, tokenHash: sha256Hex_(token), status: "ACTIVE",
      expiresAt: localToDate_(addDaysStr_(r.checkOut, 1), "23:59").toISOString(), createdAt: nowIso_(), createdBy: p.email, useCount: 0 });
  });
  const url = appUrl_() + "?action=guest&token=" + token;
  let emailed = false;
  if (a.sendEmail && r.guestEmail) {
    const prop = dbGet_("Properties", r.propertyId);
    emailed = sendMailSafe_(r.guestEmail, "Préparez votre arrivée — " + prop.name, "Bonjour " + r.guestName + ",\n\nComplétez vos informations d'arrivée et consultez les consignes via ce lien personnel (valable jusqu'au lendemain de votre départ) :\n" + url + "\n\n" + IMMO_CONFIG.APP_NAME, "guest-portal:" + sha256Hex_(token).slice(0, 16), r.organizationId).ok;
  }
  audit_("GUEST_PORTAL_LINK_CREATED", "Reservation", r.reservationId, r.organizationId, { emailed: emailed });
  return { ok: true, url: url, emailed: emailed, whatsapp: r.guestPhone ? waLink_(r.guestPhone, "Bonjour " + r.guestName + ", préparez votre arrivée ici : " + url) : "" };
}
function guestTokenRevoke_(p, a) {
  const r = assertResv_(p, a.reservationId, "reservation.edit");
  let n = 0;
  dbAll_("GuestAccessTokens").filter(function (t) { return String(t.reservationId) === String(r.reservationId) && t.status === "ACTIVE"; }).forEach(function (t) { dbUpdate_("GuestAccessTokens", t.tokenId, { status: "REVOKED" }); n++; });
  audit_("GUEST_PORTAL_LINK_REVOKED", "Reservation", r.reservationId, r.organizationId, { count: n });
  return { ok: true, revoked: n };
}
function guestFromToken_(token) {
  token = String(token || "");
  assert_(/^[a-f0-9]{64}$/.test(token), "Lien invalide.", "AUTH");
  rateLimit_("guestportal:" + token.slice(0, 16), 60, 600);
  const h = sha256Hex_(token);
  const t = dbAll_("GuestAccessTokens").find(function (x) { return safeEq_(x.tokenHash, h); });
  assert_(t && t.status === "ACTIVE", "Lien invalide ou révoqué.", "AUTH");
  assert_(parseTs_(t.expiresAt).getTime() > Date.now(), "Ce lien a expiré.", "EXPIRED");
  const r = dbGet_("Reservations", t.reservationId);
  assert_(r && ["PENDING", "CONFIRMED", "IN_PROGRESS"].indexOf(r.status) >= 0, "Réservation inactive.", "AUTH");
  dbUpdate_("GuestAccessTokens", t.tokenId, { lastUsedAt: nowIso_(), useCount: (Number(t.useCount) || 0) + 1 });
  return { t: t, r: r, prop: dbGet_("Properties", r.propertyId) };
}
function guestPortalGet_(a) {
  const x = guestFromToken_(a.token), r = x.r, prop = x.prop;
  const showAccess = todayStr_() >= addDaysStr_(r.checkIn, -1);
  return { propertyName: prop.name, city: prop.city, address: prop.address, checkIn: r.checkIn, checkOut: r.checkOut,
    checkInTime: prop.checkInTime || getSetting_("reservation.defaultCheckIn", r.organizationId), checkOutTime: prop.checkOutTime || getSetting_("reservation.defaultCheckOut", r.organizationId),
    guestCount: r.guestCount, guestName: r.guestName, houseRules: prop.houseRules, arrivalInstructions: prop.arrivalInstructions, departureInstructions: prop.departureInstructions,
    accessInstructions: showAccess ? prop.accessInstructions : "", accessAvailableFrom: showAccess ? "" : addDaysStr_(r.checkIn, -1),
    guests: dbAll_("Guests").filter(function (g) { return String(g.reservationId) === String(r.reservationId) && g.status === "ACTIVE"; }).map(function (g) {
      return { guestId: g.guestId, firstName: g.firstName, lastName: g.lastName, idProvided: !!g.idType, documentCount: dbAll_("Documents").filter(function (d) { return d.ownerType === "GUEST" && String(d.ownerId) === String(g.guestId) && d.status === "ACTIVE"; }).length };
    }), incidentCategories: getSetting_("list.incidentCategories", r.organizationId), idTypes: ID_TYPES_ };
}
function guestPortalSave_(a) {
  const x = guestFromToken_(a.token), r = x.r;
  const list = Array.isArray(a.guests) ? a.guests.slice(0, Math.max(Number(r.guestCount) || 1, 1)) : [];
  assert_(list.length, "Aucun voyageur transmis.");
  return withLock_(function () {
    const saved = [];
    list.forEach(function (g) {
      const data = guestApplyInput_({ lastName: g.lastName, firstName: g.firstName, nationality: g.nationality, idType: g.idType, idRef: g.idRef, email: g.email, phone: g.phone }, r.organizationId);
      if (g.guestId) {
        const ex = dbGet_("Guests", safeText_(g.guestId, 120));
        assert_(ex && String(ex.reservationId) === String(r.reservationId) && ex.status === "ACTIVE", "Voyageur inconnu.");
        data.updatedAt = nowIso_(); dbUpdate_("Guests", ex.guestId, data); saved.push(ex.guestId);
      } else {
        const n = dbAll_("Guests").filter(function (z) { return String(z.reservationId) === String(r.reservationId) && z.status === "ACTIVE"; }).length;
        assert_(n < (Number(r.guestCount) || 1), "Nombre maximal de voyageurs atteint.");
        saved.push(dbInsert_("Guests", Object.assign({ organizationId: r.organizationId, propertyId: r.propertyId, reservationId: r.reservationId, isPrimary: false, status: "ACTIVE", createdAt: nowIso_(), createdBy: "guest-portal", updatedAt: nowIso_() }, data)).guestId);
      }
    });
    auditAs_("guest-portal", "", "GUEST_PORTAL_INFO_SAVED", "Reservation", r.reservationId, r.organizationId, { guests: saved.length });
    return { ok: true, guestIds: saved };
  });
}
function guestPortalUpload_(a) {
  const x = guestFromToken_(a.token), r = x.r;
  const g = dbGet_("Guests", safeText_(a.guestId, 120));
  assert_(g && String(g.reservationId) === String(r.reservationId) && g.status === "ACTIVE", "Voyageur inconnu.");
  assert_(dbAll_("Documents").filter(function (d) { return d.ownerType === "GUEST" && String(d.ownerId) === String(g.guestId) && d.status === "ACTIVE"; }).length < 4, "Nombre maximal de documents atteint.");
  const ctx = { propertyId: r.propertyId, organizationId: r.organizationId, sensitive: true };
  const d = storeFile_(ctx, "GUEST", g.guestId, "ID_DOCUMENT", a, "guest-portal");
  auditAs_("guest-portal", "", "GUEST_PORTAL_DOCUMENT_UPLOADED", "Guest", g.guestId, r.organizationId, { size: d.sizeBytes });
  return { ok: true, documentId: d.documentId };
}
function guestPortalIncident_(a) {
  const x = guestFromToken_(a.token), r = x.r, prop = x.prop;
  rateLimit_("guestinc:" + r.reservationId, 5, 3600);
  const cat = oneOf_(a.category || "OTHER", getSetting_("list.incidentCategories", r.organizationId), "Catégorie");
  const i = dbInsert_("IncidentsV4", { organizationId: r.organizationId, propertyId: r.propertyId, reservationId: r.reservationId, category: cat, priority: "NORMAL", severity: "MEDIUM",
    title: "Signalement voyageur : " + cat, description: reqText_(a.description, "Description", 5, 2000), status: "OPEN", photoFileIdsJson: "[]", createdAt: nowIso_(), createdBy: "guest:" + r.reservationId,
    updatedAt: nowIso_(), updatedBy: "guest-portal", source: "GUEST" });
  auditAs_("guest-portal", "", "INCIDENT_CREATED", "Incident", i.incidentId, r.organizationId, { source: "GUEST" });
  notify_({ eventKey: "incident-new:" + i.incidentId, userIds: propertyManagers_(prop, "canManageOperations"), type: "INCIDENT", organizationId: r.organizationId,
    title: "Problème signalé par un voyageur : " + prop.name, body: cat + " — " + i.description.slice(0, 200), link: "#incident/" + i.incidentId });
  return { ok: true, incidentId: i.incidentId };
}
