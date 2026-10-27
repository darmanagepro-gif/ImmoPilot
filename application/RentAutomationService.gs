/**
 * Location longue durée — envois automatiques au locataire, avec le PDF en pièce jointe :
 *  - APPEL DE LOYER (avis d'échéance) : rent.callDaysBefore jours avant l'échéance ;
 *  - RELANCES : aux jours rent.reminderDays après l'échéance (par défaut 5, 15 et 30), tant qu'il reste un impayé ;
 *    une relance regroupe TOUTES les échéances impayées du bail (jamais une rafale d'e-mails pour d'anciens impayés) ;
 *  - QUITTANCE : dès qu'une échéance est entièrement soldée par un paiement enregistré (bouton « Paiement » du bailleur).
 * Règles :
 *  - Désactivé par défaut. L'organisation active chaque envoi dans Paramètres (rent.autoCall, rent.autoReminders, rent.autoReceipt) ;
 *    un bail peut être exclu ou avoir ses propres délais (Leases.automationJson).
 *  - Jamais d'envoi en double : chaque envoi a une clé unique (RentMailings.uniqueKey). Un envoi en échec est retenté (3 essais au plus).
 *  - Envois automatiques entre 8 h et 20 h (heure locale), au plus RENT_MAIL_BATCH_ par passage de la tâche (toutes les 15 min) :
 *    le quota d'e-mails du compte est ainsi étalé sur la journée.
 *  - Une échéance n'est jamais considérée payée sans paiement enregistré (voir LeaseService.gs).
 */
var RENT_MAIL_BATCH_ = 12, RENT_MAIL_HOURS_ = [8, 20], RENT_MAIL_MAX_ATTEMPTS_ = 3;
var RENT_REMINDER_TITLES_ = ["Rappel de loyer", "Relance pour loyer impayé", "Dernière relance avant procédure"];

/** Jours de relance : entiers de 1 à 120, sans doublon, triés, 5 au plus. */
function rentReminderDays_(arr) {
  const out = (Array.isArray(arr) ? arr : String(arr || "").split(",")).map(function (x) { return parseInt(x, 10); })
    .filter(function (n, i, a) { return n >= 1 && n <= 120 && a.indexOf(n) === i; }).sort(function (a, b) { return a - b; }).slice(0, 5);
  assert_(out.length >= 1, "Indiquez au moins un délai de relance (en jours après l'échéance), par exemple 5, 15, 30.");
  return out;
}

/** Réglages effectifs d'un bail : ceux de l'organisation, éventuellement remplacés par ceux du bail. */
function rentAutoCfg_(lease) {
  const o = lease.organizationId, own = parseJson_(lease.automationJson, {}) || {};
  let days = getSetting_("rent.reminderDays", o);
  if (Array.isArray(own.reminderDays) && own.reminderDays.length) { try { days = rentReminderDays_(own.reminderDays); } catch (e) { /* réglage du bail invalide : celui de l'organisation */ } }
  else { try { days = rentReminderDays_(days); } catch (e) { days = [5, 15, 30]; } }
  const before = own.callDaysBefore !== undefined && own.callDaysBefore !== "" && own.callDaysBefore !== null ? Number(own.callDaysBefore) : Number(getSetting_("rent.callDaysBefore", o));
  return {
    leaseEnabled: own.enabled !== false,
    call: !!getSetting_("rent.autoCall", o), reminders: !!getSetting_("rent.autoReminders", o), receipt: !!getSetting_("rent.autoReceipt", o),
    callDaysBefore: isFinite(before) ? Math.max(0, Math.min(31, before)) : 7, reminderDays: days,
    copyEmail: String(getSetting_("rent.copyEmail", o) || ""), paymentInstructions: String(getSetting_("rent.paymentInstructions", o) || ""),
    custom: { enabled: own.enabled !== false, callDaysBefore: own.callDaysBefore === undefined ? "" : own.callDaysBefore, reminderDays: Array.isArray(own.reminderDays) ? own.reminderDays : [] }
  };
}

/** Contexte d'un bail pour les documents : bail, bien, locataire, bailleur (organisation propriétaire du bien). */
function rentCtx_(leaseOrId) {
  const l = typeof leaseOrId === "object" ? leaseOrId : dbGet_("Leases", leaseOrId);
  if (!l) notFound_("Bail");
  const prop = dbGet_("Properties", l.propertyId) || {}, t = dbGet_("Tenants", l.tenantId) || {}, org = dbGet_("Organizations", l.organizationId) || {};
  return { l: l, prop: prop, t: t, org: org, cfg: rentAutoCfg_(l) };
}
function rentIssuer_(org) {
  return { name: org.name || "Bailleur", lines: [org.address, [org.city].filter(String).join(" "), org.phone ? "Tél. " + org.phone : "", org.billingEmail || ""].filter(function (x) { return x; }) };
}
function rentAddress_(prop) { return [prop.address, prop.building, prop.doorNumber ? "porte " + prop.doorNumber : "", prop.city].filter(function (x) { return x; }).join(", "); }
function rentPeriodLabel_(s) {
  const mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const m = parseInt(String(s.period).slice(5, 7), 10);
  return (mois[m - 1] || "") + " " + String(s.period).slice(0, 4);
}
/** Échéances ouvertes d'un bail avec leur statut calculé, triées par date. */
function rentOpenSchedules_(leaseId, today) {
  return dbAll_("RentSchedules").filter(function (s) { return String(s.leaseId) === String(leaseId) && s.status === "OPEN"; })
    .map(function (s) { return rentStatus_(s, today); })
    .sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); });
}
function rentReference_(l, s) { return "LOY-" + String(s.period).replace("-", "") + "-" + String(l.leaseId).slice(-6).toUpperCase(); }
function rentParties_(c) {
  return "<table style='margin:6px 0 10px'><tr><th style='width:50%'>Bailleur</th><th>Locataire</th></tr><tr><td><b>" + escapeHtml_(c.org.name || "") + "</b><br>" +
    escapeHtml_([c.org.address, c.org.city].filter(String).join(", ")) + "</td><td><b>" + escapeHtml_(c.t.fullName || "") + "</b><br>" + escapeHtml_(c.prop.name || "") + "<br>" +
    escapeHtml_(rentAddress_(c.prop)) + "</td></tr></table>";
}
function rentPayInfoHtml_(c) {
  return c.cfg.paymentInstructions ? "<div class='box'><b>Modalités de paiement</b><br>" + escapeHtml_(c.cfg.paymentInstructions).replace(/\n/g, "<br>") + "</div>" : "";
}

/* ------------------------------ Documents PDF ------------------------------ */
/** Avis d'échéance (appel de loyer) d'une échéance, avec les arriérés éventuels. */
function rentCallPdf_(c, s) {
  const st = rentStatus_(s), cur = cur_(), today = todayStr_();
  // Arriérés : échéances antérieures DÉJÀ échues et non soldées (jamais les échéances à venir).
  const arrears = rentOpenSchedules_(c.l.leaseId, today).filter(function (x) { return x.scheduleId !== s.scheduleId && x.remaining > 0 && x.dueDate < s.dueDate && x.dueDate < today; });
  const arrearsTotal = sumBy_(arrears, function (x) { return x.remaining; });
  const rows = [["Loyer — " + rentPeriodLabel_(s), fmtAmount_(s.rentAmount, cur)], ["Charges", fmtAmount_(s.chargesAmount, cur)]];
  if (st.paid > 0) rows.push(["Déjà réglé sur cette échéance", "− " + fmtAmount_(st.paid, cur)]);
  rows.push(["<b>Montant de l'échéance</b>", "<b>" + escapeHtml_(fmtAmount_(st.remaining, cur)) + "</b>"]);
  arrears.forEach(function (a) { rows.push(["Arriéré — " + rentPeriodLabel_(a) + " (échéance du " + pdfDate_(a.dueDate) + ")", fmtAmount_(a.remaining, cur)]); });
  if (arrears.length) rows.push(["<b>Total à régler</b>", "<b>" + escapeHtml_(fmtAmount_(round2_(st.remaining + arrearsTotal), cur)) + "</b>"]);
  const table = "<table><tr><th>Désignation</th><th class='right'>Montant</th></tr>" + rows.map(function (r) { return "<tr><td>" + (/^<b>/.test(r[0]) ? r[0] : escapeHtml_(r[0])) + "</td><td class='right'>" + (/^<b>/.test(r[1]) ? r[1] : escapeHtml_(r[1])) + "</td></tr>"; }).join("") + "</table>";
  const inner = rentParties_(c) + "<p>Madame, Monsieur,</p><p>Nous vous prions de bien vouloir régler le loyer et les charges de la période <b>" + escapeHtml_(rentPeriodLabel_(s)) + "</b> pour le logement désigné ci-dessus, <b>au plus tard le " + pdfDate_(s.dueDate) + "</b>.</p>" +
    table + "<p>Référence à indiquer avec votre règlement : <b>" + escapeHtml_(rentReference_(c.l, s)) + "</b></p>" + rentPayInfoHtml_(c) +
    "<p class='muted'>Cet avis d'échéance ne vaut pas quittance. La quittance vous sera adressée après encaissement de la totalité de l'échéance.</p>" +
    "<p style='margin-top:18px'>Fait le " + pdfDate_(today) + ".<br>Le bailleur, " + escapeHtml_(c.org.name || "") + "</p>";
  return htmlToPdf_(pdfShell_("Avis d'échéance — appel de loyer", inner, { subtitle: (c.prop.name || "") + " · période " + rentPeriodLabel_(s), issuer: rentIssuer_(c.org),
    footer: "Document émis par " + (c.org.name || "le bailleur") + " via " + IMMO_CONFIG.APP_NAME + "." }), "Appel_loyer_" + s.period + "_" + String(c.l.leaseId).slice(-6));
}
/** Relance : niveau 1 à 3 ; liste toutes les échéances impayées échues du bail. */
function rentReminderPdf_(c, unpaid, level) {
  const cur = cur_(), today = todayStr_(), total = sumBy_(unpaid, function (x) { return x.remaining; });
  const lvl = Math.max(1, Math.min(3, level)), title = RENT_REMINDER_TITLES_[lvl - 1];
  const table = htmlTable_(["Période", "Échéance", "Montant dû", "Déjà réglé", "Reste dû", "Retard"], unpaid.map(function (x) {
    return [rentPeriodLabel_(x), pdfDate_(x.dueDate), fmtAmount_(x.amountDue, cur), fmtAmount_(x.paid, cur), fmtAmount_(x.remaining, cur), diffDays_(x.dueDate, today) + " j"];
  }));
  const texts = [
    "<p>Sauf erreur ou omission de notre part, nous n'avons pas encore reçu le règlement des sommes ci-dessous. Il s'agit peut-être d'un simple oubli : nous vous remercions de bien vouloir régulariser dès que possible.</p>",
    "<p>Malgré notre précédent rappel, les sommes ci-dessous restent impayées à ce jour. Nous vous demandons de procéder à leur règlement <b>sous 8 jours</b> à compter de la réception de ce courrier, ou de nous contacter sans tarder si vous rencontrez une difficulté, afin de convenir d'une solution.</p>",
    "<p>Malgré nos relances, les sommes ci-dessous restent impayées. Nous vous mettons en demeure de les régler <b>sous 8 jours</b> à compter de la réception de ce courrier. À défaut, nous nous verrons contraints d'engager, sans autre avis, les démarches prévues par le " + escapeHtml_(edition_().leaseLaw) + " pour le recouvrement des sommes dues.</p>"
  ];
  const inner = rentParties_(c) + "<p><b>Objet : " + escapeHtml_(title) + "</b></p><p>Madame, Monsieur,</p>" + texts[lvl - 1] + table +
    "<p><b>Total restant dû : " + escapeHtml_(fmtAmount_(total, cur)) + "</b></p>" + rentPayInfoHtml_(c) +
    "<p class='muted'>Si votre règlement nous est parvenu entre-temps, merci de ne pas tenir compte de ce courrier.</p>" +
    "<p style='margin-top:18px'>Fait le " + pdfDate_(today) + ".<br>Le bailleur, " + escapeHtml_(c.org.name || "") + "</p>";
  return htmlToPdf_(pdfShell_(title, inner, { subtitle: (c.prop.name || "") + " · " + unpaid.length + " échéance(s) impayée(s)", issuer: rentIssuer_(c.org),
    footer: "Document émis par " + (c.org.name || "le bailleur") + " via " + IMMO_CONFIG.APP_NAME + "." }), "Relance_" + lvl + "_" + today + "_" + String(c.l.leaseId).slice(-6));
}
/** Quittance d'une échéance entièrement réglée (modèle intégré ou modèle Google Docs de l'organisation). */
function rentReceiptPdf_(c, s) {
  const cur = cur_(), pays = dbAll_("Payments").filter(function (z) { return z.refType === "RENT_SCHEDULE" && String(z.refId) === String(s.scheduleId) && z.status === "RECORDED" && z.kind === "RENT"; });
  const tpl = getSetting_("template.receiptDocId", c.l.organizationId);
  const map = { bailleur: c.org.name, locataire: c.t.fullName, bien: c.prop.name, adresse: rentAddress_(c.prop), periode: s.period, loyer: s.rentAmount, charges: s.chargesAmount, total: s.amountDue,
    date_paiement: pays.map(function (z) { return pdfDate_(z.paidAt); }).join(", "), date: pdfDate_(todayStr_()) };
  if (tpl) return docFromTemplate_(tpl, map, propertyFolder_(c.l.organizationId, c.l.propertyId, "LEASE"), "Quittance_" + s.period + "_" + c.l.leaseId).pdf;
  const inner = rentParties_(c) + "<p>Je soussigné(e), <b>" + escapeHtml_(c.org.name || "") + "</b>, bailleur du logement désigné ci-dessus, déclare avoir reçu de <b>" + escapeHtml_(c.t.fullName || "") +
    "</b> la somme de <b>" + escapeHtml_(fmtAmount_(s.amountDue, cur)) + "</b> au titre du loyer et des charges de la période <b>" + escapeHtml_(rentPeriodLabel_(s)) + "</b>, et lui en donne quittance, sous réserve de tous mes droits.</p>" +
    htmlTable_(["Poste", "Montant"], [["Loyer", fmtAmount_(s.rentAmount, cur)], ["Charges", fmtAmount_(s.chargesAmount, cur)], ["Total réglé", fmtAmount_(s.amountDue, cur)]]) +
    "<h2>Paiement(s) reçu(s)</h2>" + htmlTable_(["Date", "Mode", "Référence", "Montant"], pays.map(function (z) { return [pdfDate_(z.paidAt), PDF_PAY_METHODS_[z.method] || z.method, z.reference || "—", fmtAmount_(z.amount, cur)]; })) +
    "<p class='muted'>Cette quittance annule tous les reçus partiels qui auraient pu être donnés pour la même période.</p>" +
    "<p style='margin-top:18px'>Fait le " + pdfDate_(todayStr_()) + ".<br>Le bailleur, " + escapeHtml_(c.org.name || "") + "</p>";
  return htmlToPdf_(pdfShell_("Quittance de loyer", inner, { subtitle: (c.prop.name || "") + " · période " + rentPeriodLabel_(s), issuer: rentIssuer_(c.org),
    footer: "Quittance délivrée gratuitement par " + (c.org.name || "le bailleur") + " via " + IMMO_CONFIG.APP_NAME + "." }), "Quittance_" + s.period + "_" + String(c.l.leaseId).slice(-6));
}

/* ------------------------------ Envoi et journal ------------------------------ */
/** Enregistre un PDF généré dans les documents du bail (dossier privé « Contrats » du bien). */
function rentStorePdf_(c, blob, category, actorEmail) {
  const d = storeFile_({ propertyId: c.l.propertyId, organizationId: c.l.organizationId }, "LEASE", c.l.leaseId, category,
    { mimeType: "application/pdf", fileName: blob.getName(), base64: Utilities.base64Encode(blob.getBytes()) }, actorEmail || "système");
  return d.documentId;
}
function rentMailText_(c, kind, data) {
  const cur = cur_(), hello = "Bonjour " + (c.t.fullName || "") + ",\n\n", sign = "\n\nCordialement,\n" + (c.org.name || "Le bailleur") +
    (c.org.phone ? "\nTél. " + c.org.phone : "") + "\n\n—\nMessage envoyé par " + IMMO_CONFIG.APP_NAME + " pour le compte de " + (c.org.name || "votre bailleur") + ".";
  const pay = c.cfg.paymentInstructions ? "\n\nModalités de paiement :\n" + c.cfg.paymentInstructions : "";
  if (kind === "CALL") return { subject: "Avis d'échéance — loyer " + rentPeriodLabel_(data.s) + " — " + (c.prop.name || ""),
    body: hello + "Veuillez trouver ci-joint l'avis d'échéance de votre loyer pour la période " + rentPeriodLabel_(data.s) + " (" + (c.prop.name || "") + ").\n\nMontant à régler : " +
      fmtAmount_(data.total, cur) + ", au plus tard le " + pdfDate_(data.s.dueDate) + ".\nRéférence à indiquer : " + rentReference_(c.l, data.s) + "." + pay +
      "\n\nSi vous avez déjà effectué ce règlement, merci de ne pas tenir compte de ce message." + sign };
  if (kind === "REMINDER") return { subject: RENT_REMINDER_TITLES_[data.level - 1] + " — " + (c.prop.name || ""),
    body: hello + ["Sauf erreur de notre part, votre loyer n'a pas encore été réglé.", "Malgré notre précédent rappel, des loyers restent impayés.", "Malgré nos relances, des loyers restent impayés : vous trouverez ci-joint notre dernière relance avant procédure."][data.level - 1] +
      "\n\nTotal restant dû : " + fmtAmount_(data.total, cur) + " (" + data.count + " échéance(s)). Le détail figure dans le document joint." + pay +
      "\n\nSi vous avez déjà réglé, merci de ne pas tenir compte de ce message. En cas de difficulté, contactez-nous." + sign };
  if (kind === "RECEIPT") return { subject: "Quittance de loyer — " + rentPeriodLabel_(data.s) + " — " + (c.prop.name || ""),
    body: hello + "Nous avons bien reçu votre règlement de " + fmtAmount_(data.s.amountDue, cur) + " pour la période " + rentPeriodLabel_(data.s) + ".\nVeuillez trouver ci-joint votre quittance de loyer.\n\nMerci." + sign };
  return { subject: data.subject, body: hello + data.message + sign };
}
/**
 * Envoie un e-mail au locataire avec un PDF et l'inscrit dans RentMailings.
 * o : { c, kind, level, scheduleId, uniqueKey, trigger: AUTO|MANUAL, actor, build: function () → Blob, category, mail: { subject, body } | fonction,
 *       documentId (facultatif : PDF déjà enregistré, réutilisé au lieu d'en créer un nouveau) }
 * Retour : { ok, status, mailingId, documentId, error }
 */
function rentDeliver_(o) {
  const c = o.c, to = String(c.t.email || "").trim(), key = o.uniqueKey;
  const prev = key ? dbAll_("RentMailings").filter(function (m) { return m.uniqueKey === key; })[0] : null;
  if (prev && prev.status === "SENT") return { ok: true, duplicate: true, status: "SENT", mailingId: prev.mailingId, documentId: prev.documentId };
  if (prev && o.trigger === "AUTO" && num_(prev.attempts) >= RENT_MAIL_MAX_ATTEMPTS_) return { ok: false, status: "FAILED", mailingId: prev.mailingId, error: prev.error };
  const base = { organizationId: c.l.organizationId, propertyId: c.l.propertyId, leaseId: c.l.leaseId, scheduleId: o.scheduleId || "", kind: o.kind, level: o.level || 0, recipient: to,
    trigger: o.trigger || "AUTO", uniqueKey: key || newId_("rml"), createdAt: nowIso_(), createdBy: o.actor || "système" };
  if (!to) {
    const row = prev ? (dbUpdate_("RentMailings", prev.mailingId, { status: "SKIPPED", error: "Aucune adresse e-mail pour le locataire.", attempts: num_(prev.attempts) + 1 }), prev)
      : dbInsert_("RentMailings", Object.assign(base, { status: "SKIPPED", error: "Aucune adresse e-mail pour le locataire.", attempts: 1 }));
    return { ok: false, status: "SKIPPED", mailingId: row.mailingId, error: "Aucune adresse e-mail pour le locataire : ajoutez-la dans « Locataires »." };
  }
  let docId = o.documentId || (prev && prev.documentId ? prev.documentId : ""), blob = null, error = "";
  try {
    blob = o.build();
    if (!docId) docId = rentStorePdf_(c, blob, o.category, o.actor);
  } catch (e) { error = "Document : " + String(e.message || e).slice(0, 250); }
  const txt = typeof o.mail === "function" ? o.mail() : o.mail;
  let res = { ok: false, error: error };
  if (!error) res = sendMailSafe_(to, txt.subject, txt.body, "rentmail:" + base.uniqueKey + ":" + (prev ? num_(prev.attempts) + 1 : 1), c.l.organizationId,
    { attachments: [blob], bcc: c.cfg.copyEmail || "", replyTo: c.org.billingEmail || "", senderName: c.org.name || IMMO_CONFIG.APP_NAME, plain: true });
  const patch = { status: res.ok ? "SENT" : "FAILED", sentAt: res.ok ? nowIso_() : "", error: res.ok ? "" : String(res.error || error).slice(0, 300), documentId: docId, subject: safeText_(txt.subject, 200) };
  let row;
  if (prev) { patch.attempts = num_(prev.attempts) + 1; dbUpdate_("RentMailings", prev.mailingId, patch); row = prev; }
  else row = dbInsert_("RentMailings", Object.assign(base, patch, { attempts: 1 }));
  audit_(res.ok ? "RENT_MAIL_SENT" : "RENT_MAIL_FAILED", "Lease", c.l.leaseId, c.l.organizationId, { kind: o.kind, level: o.level || 0, scheduleId: o.scheduleId || "", trigger: base.trigger });
  if (!res.ok && base.trigger === "AUTO" && c.prop.propertyId) notify_({ eventKey: "rentmail-failed:" + base.uniqueKey, userIds: propertyManagers_(c.prop, "canManageOperations"), type: "RENT_MAIL_FAILED",
    organizationId: c.l.organizationId, email: false, title: "Envoi au locataire impossible : " + (c.prop.name || ""), body: (c.t.fullName || "") + " — " + patch.error, link: "#lease/" + c.l.leaseId });
  return { ok: !!res.ok, status: patch.status, mailingId: row.mailingId, documentId: docId, error: res.ok ? "" : patch.error, to: to };
}

function rentSendCall_(c, s, trigger, actor) {
  const today = todayStr_(), st = rentStatus_(s), arrears = rentOpenSchedules_(c.l.leaseId, today).filter(function (x) { return x.scheduleId !== s.scheduleId && x.remaining > 0 && x.dueDate < s.dueDate && x.dueDate < today; });
  const total = round2_(st.remaining + sumBy_(arrears, function (x) { return x.remaining; }));
  return rentDeliver_({ c: c, kind: "CALL", scheduleId: s.scheduleId, uniqueKey: trigger === "AUTO" ? "CALL:" + s.scheduleId : "", trigger: trigger, actor: actor, category: "RENT_CALL",
    build: function () { return rentCallPdf_(c, s); }, mail: function () { return rentMailText_(c, "CALL", { s: s, total: total }); } });
}
function rentSendReminder_(c, unpaid, level, trigger, actor) {
  const total = sumBy_(unpaid, function (x) { return x.remaining; });
  return rentDeliver_({ c: c, kind: "REMINDER", level: level, scheduleId: unpaid[0].scheduleId, trigger: trigger, actor: actor, category: "RENT_REMINDER",
    uniqueKey: trigger === "AUTO" ? "REMINDER:" + c.l.leaseId + ":" + unpaid[0].scheduleId + ":" + level : "",
    build: function () { return rentReminderPdf_(c, unpaid, level); }, mail: function () { return rentMailText_(c, "REMINDER", { level: level, total: total, count: unpaid.length }); } });
}
function rentSendReceipt_(c, s, trigger, actor) {
  return rentDeliver_({ c: c, kind: "RECEIPT", scheduleId: s.scheduleId, uniqueKey: trigger === "AUTO" ? "RECEIPT:" + s.scheduleId : "", trigger: trigger, actor: actor, category: "RECEIPT",
    build: function () { return rentReceiptPdf_(c, s); }, mail: function () { return rentMailText_(c, "RECEIPT", { s: s }); } });
}
/** Niveau de relance atteint par l'impayé le plus ancien (0 = aucune relance due). */
function rentReminderLevel_(cfg, oldestDue, today) {
  const late = diffDays_(oldestDue, today);
  return cfg.reminderDays.filter(function (d) { return late >= d; }).length;
}
function rentUnpaidDue_(leaseId, today) { return rentOpenSchedules_(leaseId, today).filter(function (x) { return x.remaining > 0 && x.dueDate < today; }); }

/**
 * Après un paiement enregistré sur une échéance (FinanceService.payRecord_) : quittance envoyée automatiquement si l'échéance
 * est soldée et que l'organisation l'a activé. Ne fait jamais échouer l'enregistrement du paiement.
 */
function rentAfterPayment_(pay, actorEmail) {
  try {
    if (!pay || pay.refType !== "RENT_SCHEDULE") return null;
    const s = dbGet_("RentSchedules", pay.refId); if (!s) return null;
    if (rentStatus_(s).status !== "PAID") return { receipt: false, reason: "PARTIAL" };
    const c = rentCtx_(s.leaseId);
    if (!c.cfg.receipt || !c.cfg.leaseEnabled) return { receipt: false, reason: "DISABLED" };
    const r = rentSendReceipt_(c, s, "AUTO", actorEmail);
    return { receipt: r.ok, to: r.to || "", status: r.status, error: r.error || "" };
  } catch (e) { console.error("Quittance automatique : " + e.message); return { receipt: false, reason: "ERROR", error: String(e.message).slice(0, 200) }; }
}

/** Tâche (toutes les 15 min, de 8 h à 20 h) : appels de loyer, relances et nouvelles tentatives des envois en échec. */
function rentAutomationJob_(opts) {
  opts = opts || {};
  const hour = Number(Utilities.formatDate(new Date(), tz_(), "H"));
  if (!opts.force && (hour < RENT_MAIL_HOURS_[0] || hour >= RENT_MAIL_HOURS_[1])) return { skipped: "hors heures d'envoi (8 h – 20 h)" };
  const today = todayStr_(), out = { calls: 0, reminders: 0, retries: 0, failed: 0, skipped: 0 };
  let budget = opts.batch || RENT_MAIL_BATCH_;
  const quotaOk = function () {
    if (budget <= 0) return false;
    try { const q = TEST_HOOKS_.mailQuota !== null ? TEST_HOOKS_.mailQuota : MailApp.getRemainingDailyQuota(); return q >= 5; } catch (e) { return true; }
  };
  const count = function (r, k) { budget--; if (r.ok) out[k]++; else if (r.status === "SKIPPED") out.skipped++; else out.failed++; };
  const leases = dbAll_("Leases").filter(function (l) { return ["ACTIVE", "NOTICE"].indexOf(l.status) >= 0; });
  for (let i = 0; i < leases.length && quotaOk(); i++) {
    const l = leases[i], cfg = rentAutoCfg_(l);
    if (!cfg.leaseEnabled || !(cfg.call || cfg.reminders)) continue;
    let c = null; const ctx = function () { return c || (c = rentCtx_(l)); };
    if (!String((dbGet_("Tenants", l.tenantId) || {}).email || "").trim()) {
      // Sans e-mail du locataire : rien n'est envoyé ; les gestionnaires sont prévenus une seule fois.
      const prop = dbGet_("Properties", l.propertyId);
      if (prop) notify_({ eventKey: "rent-noemail:" + l.leaseId, userIds: propertyManagers_(prop, "canManageOperations"), type: "RENT_MAIL_FAILED", organizationId: l.organizationId, email: false,
        title: "Envois automatiques impossibles : " + prop.name, body: "Le locataire n'a pas d'adresse e-mail : ajoutez-la dans « Locataires » pour qu'il reçoive ses appels de loyer, relances et quittances.", link: "#lease/" + l.leaseId });
      out.skipped++; continue;
    }
    if (cfg.call) {
      const due = rentOpenSchedules_(l.leaseId, today).filter(function (s) {
        return s.remaining > 0 && today >= addDaysStr_(s.dueDate, -cfg.callDaysBefore) && today <= addDaysStr_(s.dueDate, Number(getSetting_("rent.graceDays", l.organizationId)) || 0);
      });
      for (let j = 0; j < due.length && quotaOk(); j++) {
        if (dbAll_("RentMailings").some(function (m) { return m.uniqueKey === "CALL:" + due[j].scheduleId && (m.status === "SENT" || num_(m.attempts) >= RENT_MAIL_MAX_ATTEMPTS_); })) continue;
        count(rentSendCall_(ctx(), dbGet_("RentSchedules", due[j].scheduleId), "AUTO"), "calls");
      }
    }
    if (cfg.reminders && quotaOk()) {
      const unpaid = rentUnpaidDue_(l.leaseId, today);
      if (unpaid.length) {
        const level = Math.min(3, rentReminderLevel_(cfg, unpaid[0].dueDate, today));
        const already = dbAll_("RentMailings").some(function (m) { return m.kind === "REMINDER" && String(m.leaseId) === String(l.leaseId) && String(m.scheduleId) === String(unpaid[0].scheduleId) &&
          num_(m.level) >= level && (m.status === "SENT" || num_(m.attempts) >= RENT_MAIL_MAX_ATTEMPTS_); });
        if (level >= 1 && !already) {
          const r = rentSendReminder_(ctx(), unpaid, level, "AUTO");
          count(r, "reminders");
          if (r.ok && level >= 2 && ctx().prop.propertyId) notify_({ eventKey: "rent-reminder:" + l.leaseId + ":" + unpaid[0].scheduleId + ":" + level, userIds: propertyManagers_(ctx().prop, "canManageOperations"),
            type: "RENT_LATE", organizationId: l.organizationId, email: false, title: RENT_REMINDER_TITLES_[level - 1] + " envoyée : " + (ctx().prop.name || ""),
            body: (ctx().t.fullName || "") + " — reste dû " + fmtAmount_(sumBy_(unpaid, function (x) { return x.remaining; })) + ".", link: "#lease/" + l.leaseId });
        }
      }
    }
  }
  // Nouvelles tentatives : quittances automatiques en échec (quota, panne momentanée).
  const retry = dbAll_("RentMailings").filter(function (m) { return m.kind === "RECEIPT" && m.trigger === "AUTO" && m.status === "FAILED" && num_(m.attempts) < RENT_MAIL_MAX_ATTEMPTS_; });
  for (let k = 0; k < retry.length && quotaOk(); k++) {
    const s = dbGet_("RentSchedules", retry[k].scheduleId); if (!s || rentStatus_(s).status !== "PAID") continue;
    const r = rentSendReceipt_(rentCtx_(s.leaseId), s, "AUTO"); budget--; if (r.ok) out.retries++; else out.failed++;
  }
  return out;
}

/* ------------------------------ Routes ------------------------------ */
function rentSchedLoad_(p, scheduleId) {
  const s = dbGet_("RentSchedules", safeText_(scheduleId, 120)); if (!s) notFound_("Échéance");
  leaseLoad_(p, s.leaseId, "lease.manage");
  return { s: s, c: rentCtx_(s.leaseId) };
}
function rentDeliverResult_(r) {
  if (!r.ok) throw new AppError(r.status === "SKIPPED" ? "VALIDATION" : "EMAIL", r.error || "Envoi impossible.");
  return { ok: true, sentTo: r.to, documentId: r.documentId, mailingId: r.mailingId };
}
/** Envoi manuel de l'appel de loyer d'une échéance. */
function rentSendCallRoute_(p, a) {
  const x = rentSchedLoad_(p, a.scheduleId);
  assert_(x.s.status === "OPEN" && rentStatus_(x.s).remaining > 0, "Cette échéance est déjà réglée.");
  rateLimit_("rentmail:" + p.userId, 60, 3600);
  return rentDeliverResult_(rentSendCall_(x.c, x.s, "MANUAL", p.email));
}
/** Relance manuelle : toutes les échéances impayées échues du bail ; niveau choisi ou calculé. */
function rentSendReminderRoute_(p, a) {
  const x = leaseLoad_(p, a.leaseId, "lease.manage"), c = rentCtx_(x.l), unpaid = rentUnpaidDue_(x.l.leaseId, todayStr_());
  assert_(unpaid.length, "Aucune échéance impayée échue sur ce bail.");
  const level = a.level ? Math.max(1, Math.min(3, parseInt(a.level, 10) || 1)) : Math.max(1, Math.min(3, rentReminderLevel_(c.cfg, unpaid[0].dueDate, todayStr_())));
  rateLimit_("rentmail:" + p.userId, 60, 3600);
  const out = rentDeliverResult_(rentSendReminder_(c, unpaid, level, "MANUAL", p.email)); out.level = level; return out;
}
/** Envoi (ou renvoi) manuel de la quittance d'une échéance réglée. */
function rentSendReceiptRoute_(p, a) {
  const x = rentSchedLoad_(p, a.scheduleId);
  assert_(rentStatus_(x.s).status === "PAID", "Quittance possible uniquement pour une échéance entièrement réglée.");
  rateLimit_("rentmail:" + p.userId, 60, 3600);
  return rentDeliverResult_(rentSendReceipt_(x.c, x.s, "MANUAL", p.email));
}
/** Aperçu PDF (rien n'est envoyé ni enregistré) : CALL (scheduleId), REMINDER (leaseId), RECEIPT (scheduleId). */
function rentPreview_(p, a) {
  const kind = oneOf_(String(a.kind || ""), ["CALL", "REMINDER", "RECEIPT"], "Type");
  let blob;
  if (kind === "REMINDER") {
    const x = leaseLoad_(p, a.leaseId, "lease.manage"), c = rentCtx_(x.l), unpaid = rentUnpaidDue_(x.l.leaseId, todayStr_());
    assert_(unpaid.length, "Aucune échéance impayée échue sur ce bail.");
    blob = rentReminderPdf_(c, unpaid, a.level ? Math.max(1, Math.min(3, parseInt(a.level, 10) || 1)) : Math.max(1, Math.min(3, rentReminderLevel_(c.cfg, unpaid[0].dueDate, todayStr_()))));
  } else {
    const y = rentSchedLoad_(p, a.scheduleId);
    if (kind === "RECEIPT") assert_(rentStatus_(y.s).status === "PAID", "Échéance non réglée.");
    blob = kind === "CALL" ? rentCallPdf_(y.c, y.s) : rentReceiptPdf_(y.c, y.s);
  }
  return { fileName: blob.getName(), mimeType: "application/pdf", base64: Utilities.base64Encode(blob.getBytes()) };
}
/** Réglages propres à un bail : exclusion des envois automatiques, délai d'appel, jours de relance. */
function leaseAutomationSet_(p, a) {
  const x = leaseLoad_(p, a.leaseId, "lease.manage"), own = {};
  own.enabled = a.enabled === undefined ? true : bool_(a.enabled);
  if (a.callDaysBefore !== undefined && a.callDaysBefore !== "" && a.callDaysBefore !== null) { const n = parseInt(a.callDaysBefore, 10); assert_(n >= 0 && n <= 31, "Délai de 0 à 31 jours avant l'échéance."); own.callDaysBefore = n; }
  const days = Array.isArray(a.reminderDays) ? a.reminderDays : String(a.reminderDays || "").split(",").map(function (v) { return v.trim(); }).filter(Boolean);
  if (days.length) own.reminderDays = rentReminderDays_(days);
  dbUpdate_("Leases", x.l.leaseId, { automationJson: own, updatedAt: nowIso_(), updatedBy: p.email });
  audit_("LEASE_AUTOMATION_UPDATED", "Lease", x.l.leaseId, x.l.organizationId, own);
  return { ok: true, automation: rentAutomationView_(dbGet_("Leases", x.l.leaseId)) };
}
/** Résumé affiché sur la fiche du bail : réglages effectifs et prochains envois prévus. */
function rentAutomationView_(l, t) {
  const cfg = rentAutoCfg_(l), today = todayStr_();
  t = t || dbGet_("Tenants", l.tenantId) || {};
  const open = rentOpenSchedules_(l.leaseId, today).filter(function (s) { return s.remaining > 0; });
  const nextCall = cfg.call && cfg.leaseEnabled ? open.filter(function (s) { return s.dueDate >= today && !dbAll_("RentMailings").some(function (m) { return m.uniqueKey === "CALL:" + s.scheduleId && m.status === "SENT"; }); })
    .map(function (s) { const d = addDaysStr_(s.dueDate, -cfg.callDaysBefore); return d < today ? today : d; })[0] || "" : "";
  let nextReminder = "";
  const unpaid = open.filter(function (s) { return s.dueDate < today; });
  if (cfg.reminders && cfg.leaseEnabled && unpaid.length) {
    const lvl = rentReminderLevel_(cfg, unpaid[0].dueDate, today);
    if (lvl < cfg.reminderDays.length && lvl < 3) nextReminder = addDaysStr_(unpaid[0].dueDate, cfg.reminderDays[lvl]);
  }
  return { orgCall: cfg.call, orgReminders: cfg.reminders, orgReceipt: cfg.receipt, enabled: cfg.leaseEnabled, callDaysBefore: cfg.callDaysBefore, reminderDays: cfg.reminderDays,
    custom: cfg.custom, tenantEmail: t.email || "", nextCall: nextCall, nextReminder: nextReminder, hasPaymentInstructions: !!cfg.paymentInstructions };
}
function rentMailingsOf_(leaseId) {
  return dbAll_("RentMailings").filter(function (m) { return String(m.leaseId) === String(leaseId); })
    .sort(function (a, b) { return String(b.sentAt || b.createdAt).localeCompare(String(a.sentAt || a.createdAt)); }).slice(0, 100)
    .map(function (m) { return { mailingId: m.mailingId, kind: m.kind, level: num_(m.level), scheduleId: m.scheduleId, recipient: m.recipient, status: m.status, trigger: m.trigger, documentId: m.documentId,
      subject: m.subject, at: m.sentAt || m.createdAt, error: m.error, attempts: num_(m.attempts) }; });
}
