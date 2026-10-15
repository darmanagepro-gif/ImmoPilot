/**
 * Déclencheurs installables et tâches planifiées.
 * - installTriggers() (éditeur, une fois) : jobFrequent toutes les 15 min, jobDaily chaque jour vers 6 h (fuseau du projet).
 * - Les tâches s'exécutent avec l'identité du propriétaire du script (autorisations accordées lors de la 1re exécution).
 * - Chaque exécution est journalisée dans ScheduledJobs ; un verrou empêche deux exécutions simultanées ;
 *   chaque sous-tâche est isolée (l'échec de l'une n'empêche pas les autres : reprise au passage suivant).
 * - Les fonctions jobFrequent / jobDaily sont aussi techniquement appelables depuis le navigateur (fonctions globales) :
 *   elles ne renvoient que des compteurs et sont limitées à une exécution toutes les 5 minutes.
 */
function installTriggers() {
  assertEditor_();
  const existing = ScriptApp.getProjectTriggers();
  const has = function (fn) { return existing.some(function (t) { return t.getHandlerFunction() === fn; }); };
  const created = [];
  if (!has("jobFrequent")) { ScriptApp.newTrigger("jobFrequent").timeBased().everyMinutes(15).create(); created.push("jobFrequent"); }
  if (!has("jobDaily")) { ScriptApp.newTrigger("jobDaily").timeBased().everyDays(1).atHour(6).inTimezone(tz_()).create(); created.push("jobDaily"); }
  // Saisie manuelle dans le classeur de données : le cache des tables est vidé automatiquement.
  if (!has("surModificationBase")) { ScriptApp.newTrigger("surModificationBase").forSpreadsheet(dbSpreadsheet_().getId()).onEdit().create(); created.push("surModificationBase"); }
  // L'ancien déclencheur de la phase 4 (p4ExpireCleaningMissions) est remplacé par jobFrequent.
  existing.filter(function (t) { return t.getHandlerFunction() === "p4ExpireCleaningMissions"; }).forEach(function (t) { ScriptApp.deleteTrigger(t); created.push("(supprimé) p4ExpireCleaningMissions"); });
  return { ok: true, changes: created, triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }) };
}
function uninstallTriggers() {
  assertEditor_();
  let n = 0;
  ScriptApp.getProjectTriggers().filter(function (t) { return ["jobFrequent", "jobDaily"].indexOf(t.getHandlerFunction()) >= 0; }).forEach(function (t) { ScriptApp.deleteTrigger(t); n++; });
  return { ok: true, removed: n };
}

function runJob_(name, tasks) {
  ctxReset_(); dbReset_(); dbcBegin_("request");
  const cache = CacheService.getScriptCache(), key = "jobrun_" + name;
  if (cache.get(key)) return { skipped: true, reason: "Exécution récente." };
  cache.put(key, "1", 290);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { skipped: true, reason: "Verrou occupé." };
  LOCK_DEPTH_++;
  const started = Date.now(), result = {}, errors = [];
  let jobRow = null;
  try {
    jobRow = dbInsert_("ScheduledJobs", { jobName: name, startedAt: nowIso_(), status: "RUNNING" });
    Object.keys(tasks).forEach(function (k) {
      if (Date.now() - started > 4.5 * 60000) { result[k] = "reporté (limite de temps)"; return; }
      try { dbReset_(); result[k] = tasks[k](); } catch (e) { errors.push(k + " : " + e.message); result[k] = "ERREUR"; console.error(name + "/" + k + " : " + (e.stack || e.message)); }
    });
    dbUpdate_("ScheduledJobs", jobRow.jobRunId, { finishedAt: nowIso_(), status: errors.length ? "PARTIAL" : "OK", resultJson: result, error: errors.join(" | ").slice(0, 2000) });
  } catch (e) {
    if (jobRow) try { dbUpdate_("ScheduledJobs", jobRow.jobRunId, { finishedAt: nowIso_(), status: "FAILED", error: String(e.message).slice(0, 2000) }); } catch (e2) { console.error(e2.message); }
    throw e;
  } finally { LOCK_DEPTH_--; try { dbcCommit_(); } finally { lock.releaseLock(); } }
  return { ok: !errors.length, result: result, errors: errors };
}

/** Toutes les 15 minutes : expiration des missions de ménage, retards d'arrivée/départ. */
function jobFrequent() {
  return jobSummary_(runJob_("jobFrequent", { cleaning: cleaningExpireJob_, checkinAlerts: checkinAlertsJob_ }));
}
/** Ne renvoie qu'un résumé (le détail est consigné dans ScheduledJobs) : la fonction est aussi appelable depuis le web. */
function jobSummary_(r) { return { ok: !!(r && r.ok), skipped: !!(r && r.skipped), errorCount: r && r.errors ? r.errors.length : 0 }; }
/** Chaque jour : baux, abonnements, devis expirés, alertes incidents, rétention, arrivées imminentes, sauvegarde. */
function jobDaily() {
  return jobSummary_(runJob_("jobDaily", { leases: leaseJob_, subscriptions: subscriptionJob_, quotes: quoteExpireJob_, incidents: incidentAlertsJob_, retention: purgeExpiredDocuments_,
    arrivals: upcomingArrivalsJob_, guestTokens: guestTokenExpireJob_, backup: function () { return backupDatabase_("quotidien").name; } }));
}

/** Arrivées non enregistrées et départs dépassés (une alerte par réservation). */
function checkinAlertsJob_() {
  const now = Date.now(); let n = 0;
  const cis = indexBy_(dbAll_("CheckIns"), "reservationId"), cos = indexBy_(dbAll_("CheckOuts"), "reservationId");
  dbAll_("Reservations").filter(function (r) { return r.status === "CONFIRMED" || r.status === "IN_PROGRESS"; }).forEach(function (r) {
    const prop = dbGet_("Properties", r.propertyId); if (!prop) return;
    const grace = (Number(getSetting_("checkin.graceMinutes", r.organizationId)) || 120) * 60000;
    if (r.status === "CONFIRMED" && !cis[String(r.reservationId)] && resvStartMs_(r, prop) + grace < now && r.checkOut >= todayStr_()) {
      notify_({ eventKey: "arrival-missing:" + r.reservationId, userIds: propertyManagers_(prop, "canManageReservations").concat(guardsOf_(prop, r)), type: "ARRIVAL_LATE", organizationId: r.organizationId,
        title: "Arrivée non enregistrée : " + prop.name, body: r.guestName + " était attendu(e) le " + r.checkIn + ". Retard ou absence (no-show) à confirmer.", link: "#reservation/" + r.reservationId }); n++;
    }
    if (r.status === "IN_PROGRESS" && !cos[String(r.reservationId)] && resvEndMs_(r, prop) + grace < now) {
      notify_({ eventKey: "departure-missing:" + r.reservationId, userIds: propertyManagers_(prop, "canManageReservations").concat(guardsOf_(prop, r)), type: "DEPARTURE_LATE", organizationId: r.organizationId,
        title: "Départ non enregistré : " + prop.name, body: r.guestName + " devait partir le " + r.checkOut + ".", link: "#checkin" }); n++;
    }
  });
  return { alerts: n };
}
function guardsOf_(prop, r) {
  return dbAll_("PropertyAssignments").filter(function (a) { return String(a.propertyId) === String(prop.propertyId) && a.role === "GUARD" && a.status === "ACTIVE" && (!a.reservationId || String(a.reservationId) === String(r.reservationId)); }).map(function (a) { return a.userId; });
}
/** Arrivées du lendemain : rappel aux gardiens et gestionnaires. */
function upcomingArrivalsJob_() {
  const tomorrow = addDaysStr_(todayStr_(), 1); let n = 0;
  dbAll_("Reservations").filter(function (r) { return r.status === "CONFIRMED" && r.checkIn === tomorrow; }).forEach(function (r) {
    const prop = dbGet_("Properties", r.propertyId); if (!prop) return;
    notify_({ eventKey: "arrival-soon:" + r.reservationId, userIds: guardsOf_(prop, r).concat(propertyManagers_(prop, "canManageReservations")), type: "ARRIVAL_SOON", organizationId: r.organizationId,
      title: "Arrivée demain : " + prop.name, body: r.guestName + " (" + r.guestCount + " pers.) — " + Utilities.formatDate(new Date(resvStartMs_(r, prop)), tz_(), "dd/MM HH:mm"), link: "#checkin", email: false }); n++;
  });
  return { reminders: n };
}
function guestTokenExpireJob_() {
  let n = 0;
  dbAll_("GuestAccessTokens").filter(function (t) { return t.status === "ACTIVE" && parseTs_(t.expiresAt) && parseTs_(t.expiresAt).getTime() < Date.now(); }).forEach(function (t) { dbUpdate_("GuestAccessTokens", t.tokenId, { status: "EXPIRED" }); n++; });
  return { expired: n };
}
