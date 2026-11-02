/**
 * Notifications centralisées : in-app (feuille Notifications), e-mail (MailApp/Gmail), liens WhatsApp wa.me.
 * Anti-doublon : chaque envoi porte une clé d'événement ; NotificationLogs garde (eventKey, canal, destinataire).
 * WhatsApp : ImmoPilot génère un lien qui OUVRE une conversation pré-remplie. Aucun message n'est envoyé automatiquement.
 */
/**
 * opts (facultatif) : { attachments: [Blob] (PDF joints), bcc: "copie@…", replyTo: "…", senderName: "…", footer: [coordonnées de l'expéditeur],
 * plain: true (pas de bouton « Ouvrir ImmoPilot » pour les liens : e-mails adressés à un locataire sans compte) }.
 * Tous les e-mails passent par le gabarit commun (mailLayout_) ; ref = clé d'événement, renvoyée par Brevo pour le suivi de livraison.
 */
function sendMailSafe_(to, subject, body, eventKey, orgId, opts) {
  opts = opts || {};
  to = validateEmail_(to);
  const key = String(eventKey || "") ;
  if (key && dbAll_("NotificationLogs").some(function (l) { return l.eventKey === key && l.channel === "EMAIL" && l.recipient === to && l.status === "SENT"; })) return { ok: true, duplicate: true };
  let status = "SENT", error = "";
  try {
    const quota = TEST_HOOKS_.mailQuota !== null ? TEST_HOOKS_.mailQuota : MailApp.getRemainingDailyQuota();
    if (quota < 1) throw new Error("Quota quotidien MailApp épuisé.");
    const text = String(body || "").slice(0, 20000), lay = { senderName: opts.senderName, footer: opts.footer }, html = opts.plain ? mailHtmlPlain_(text, lay) : mailHtml_(text, lay);
    const msg = { to: to, subject: safeText_(subject, 200), body: text, htmlBody: html, name: safeText_(opts.senderName || IMMO_CONFIG.APP_NAME, 80), ref: key };
    if (opts.attachments && opts.attachments.length) msg.attachments = opts.attachments;
    if (opts.bcc) msg.bcc = validateEmail_(opts.bcc);
    if (opts.replyTo) msg.replyTo = validateEmail_(opts.replyTo);
    if (TEST_HOOKS_.mailSink) TEST_HOOKS_.mailSink.push({ to: to, subject: subject, body: text, htmlBody: html, bcc: msg.bcc || "", replyTo: msg.replyTo || "", name: msg.name,
      attachments: (msg.attachments || []).map(function (b) { return { name: b.getName(), mimeType: b.getContentType(), size: b.getBytes().length }; }) });
    else MailApp.sendEmail(msg);
  } catch (e) { status = "FAILED"; error = String(e.message || e).slice(0, 300); }
  try { dbInsert_("NotificationLogs", { eventKey: key || newId_("evt"), channel: "EMAIL", recipient: to, type: "", status: status, sentAt: nowIso_(), error: error, organizationId: orgId || "" }); } catch (e2) { console.error(e2.message); }
  return status === "SENT" ? { ok: true } : { ok: false, error: error };
}

/**
 * Version HTML d'un e-mail texte : texte échappé, sauts de ligne conservés, et chaque adresse https:// transformée
 * en lien cliquable (bouton pour les liens de l'application). Certaines messageries ne rendent pas cliquables les liens
 * d'un e-mail en texte brut ; la version texte reste jointe pour les autres.
 */
function mailHtml_(text, opts) {
  const parts = String(text || "").split(/(https:\/\/[^\s<>"]+)/);
  const inner = parts.map(function (part, i) {
    if (i % 2 === 0) return escapeHtml_(part).replace(/\n/g, "<br>");
    const url = escapeHtml_(part);
    return "<br><a href=\"" + url + "\" style=\"display:inline-block;background:#2f4fd8;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold\">Ouvrir ImmoPilot</a>" +
      "<br><span style=\"font-size:12px;color:#64748b\">Si le bouton ne fonctionne pas, copiez ce lien en entier dans la barre d'adresse de votre navigateur :<br><a href=\"" + url + "\" style=\"color:#2f4fd8;word-break:break-all\">" + url + "</a></span><br>";
  }).join("");
  return mailLayout_(inner, opts);
}

/** Version HTML simple (liens cliquables tels quels) pour les e-mails adressés à des personnes sans compte (locataires, voyageurs). */
function mailHtmlPlain_(text, opts) {
  const parts = String(text || "").split(/(https:\/\/[^\s<>"]+)/);
  return mailLayout_(parts.map(function (part, i) {
    if (i % 2 === 0) return escapeHtml_(part).replace(/\n/g, "<br>");
    const url = escapeHtml_(part); return "<a href=\"" + url + "\" style=\"color:#2f4fd8;word-break:break-all\">" + url + "</a>";
  }).join(""), opts);
}

/** Adresse publique du logo de l'édition (servi par le serveur ImmoPilot). */
function mailLogoUrl_() {
  try { const m = /^(https:\/\/[^\/?#]+)/.exec(appUrl_()); return m ? m[1] + "/icons/icon-192.png" : ""; } catch (e) { return ""; }
}
/**
 * Gabarit commun de tous les e-mails ImmoPilot : en-tête avec logo, contenu, pied de page de l'expéditeur.
 * Tableaux et styles en ligne (compatibles Gmail, Outlook, Apple Mail), largeur fluide jusqu'à 600 px (téléphone).
 * opts : { senderName, footer: [lignes de coordonnées de l'expéditeur] }
 */
function mailLayout_(innerHtml, opts) {
  opts = opts || {};
  const logo = mailLogoUrl_(), from = opts.senderName && opts.senderName !== IMMO_CONFIG.APP_NAME ? String(opts.senderName) : "";
  const foot = (opts.footer || []).filter(function (x) { return String(x || "").trim(); }).map(escapeHtml_).join("<br>");
  return "<!DOCTYPE html><html lang=\"fr\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"color-scheme\" content=\"light\"></head>" +
    "<body style=\"margin:0;padding:0;background:#eef2f7\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#eef2f7\"><tr><td align=\"center\" style=\"padding:20px 10px\">" +
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dbe3ee\">" +
    "<tr><td style=\"background:#13233d;padding:16px 22px\"><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr>" +
      (logo ? "<td style=\"padding-right:12px\"><img src=\"" + escapeHtml_(logo) + "\" width=\"44\" height=\"44\" alt=\"ImmoPilot\" style=\"display:block;border-radius:9px;background:#ffffff\"></td>" : "") +
      "<td style=\"font-family:Arial,Helvetica,sans-serif;color:#ffffff\"><div style=\"font-size:19px;font-weight:bold\">Immo<span style=\"color:#e9b341\">Pilot</span></div>" +
      (from ? "<div style=\"font-size:12px;color:#c7d2e3\">pour le compte de " + escapeHtml_(from) + "</div>" : "<div style=\"font-size:12px;color:#c7d2e3\">Gestion immobilière</div>") + "</td></tr></table></td></tr>" +
    "<tr><td style=\"padding:24px 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1d2b3a\">" + innerHtml + "</td></tr>" +
    (foot ? "<tr><td style=\"padding:14px 22px;background:#f6f8fb;border-top:1px solid #e3e9f1;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#475569\"><b>" + escapeHtml_(from || IMMO_CONFIG.APP_NAME) + "</b><br>" + foot + "</td></tr>" : "") +
    "<tr><td style=\"padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#94a3b8;text-align:center\">Message envoyé via ImmoPilot, logiciel de gestion immobilière édité par ECO SYNERGY. " +
      "Les pièces jointes éventuelles sont également disponibles dans votre espace ImmoPilot.</td></tr>" +
    "</table></td></tr></table></body></html>";
}

/* ------------------------- Suivi de livraison (Brevo) ------------------------- */
var MAIL_DELIVERY_RANK_ = { QUEUED: 0, SENT: 1, DEFERRED: 2, DELIVERED: 3, OPENED: 4, CLICKED: 5, SOFT_BOUNCE: 6, BOUNCED: 7, BLOCKED: 7, SPAM: 7, ERROR: 7 };
var MAIL_DELIVERY_EVENTS_ = { request: "SENT", deferred: "DEFERRED", delivered: "DELIVERED", opened: "OPENED", unique_opened: "OPENED", proxy_open: "OPENED", click: "CLICKED",
  soft_bounce: "SOFT_BOUNCE", hard_bounce: "BOUNCED", invalid_email: "BOUNCED", blocked: "BLOCKED", spam: "SPAM", complaint: "SPAM", error: "ERROR" };
var MAIL_DELIVERY_LABELS_ = { SENT: "Envoyé", DEFERRED: "Différé", DELIVERED: "Délivré", OPENED: "Ouvert", CLICKED: "Ouvert (lien cliqué)", SOFT_BOUNCE: "Boîte pleine ou indisponible",
  BOUNCED: "Adresse invalide (rejeté)", BLOCKED: "Bloqué", SPAM: "Signalé comme indésirable", ERROR: "Erreur d'envoi" };
/**
 * Appelée par le serveur à la réception d'un événement Brevo (webhook) : met à jour l'historique d'envoi
 * (NotificationLogs et, pour les loyers, RentMailings) et prévient le gestionnaire si l'e-mail n'a pas pu être délivré.
 */
function mailDeliveryUpdate(ref, email, event, at, reason, providerId) {
  ctxReset_(); dbReset_(); LOCK_DEPTH_ = 0; dbcBegin_("request");
  try { return mailDeliveryApply_(ref, email, event, at, reason, providerId); } finally { dbcCommit_(); }
}
function mailDeliveryApply_(ref, email, event, at, reason, providerId) {
  const st = MAIL_DELIVERY_EVENTS_[String(event || "")]; ref = String(ref || ""); email = String(email || "").toLowerCase();
  if (!st || !ref) return { ok: false };
  const when = /^\d{4}-\d{2}-\d{2}T/.test(String(at || "")) ? String(at) : nowIso_(), why = safeText_(reason || "", 300);
  const better = function (cur) { return !cur || (MAIL_DELIVERY_RANK_[st] || 0) >= (MAIL_DELIVERY_RANK_[cur] || 0); };
  let n = 0;
  dbAll_("NotificationLogs").filter(function (l) { return l.eventKey === ref && l.channel === "EMAIL" && String(l.recipient).toLowerCase() === email; }).forEach(function (l) {
    if (better(l.delivery)) { dbUpdate_("NotificationLogs", l.logId, { delivery: st, deliveryAt: when, deliveryReason: why, providerId: safeText_(providerId || l.providerId || "", 200) }); n++; }
  });
  const m = /^rentmail:(.+):\d+$/.exec(ref);
  if (m) {
    const row = dbAll_("RentMailings").filter(function (r) { return r.uniqueKey === m[1]; })[0];
    if (row && better(row.delivery)) {
      dbUpdate_("RentMailings", row.mailingId, { delivery: st, deliveryAt: when, deliveryReason: why }); n++;
      if (["BOUNCED", "BLOCKED", "SPAM"].indexOf(st) >= 0) {
        const prop = dbGet_("Properties", row.propertyId);
        if (prop) notify_({ eventKey: "rentmail-undelivered:" + row.mailingId + ":" + st, userIds: propertyManagers_(prop, "canManageRent"), type: "RENT_MAIL_FAILED", organizationId: row.organizationId,
          title: "E-mail non délivré au locataire : " + (prop.name || ""), body: (row.subject || "") + " — " + MAIL_DELIVERY_LABELS_[st] + (why ? " (" + why + ")" : "") + ". Vérifiez l'adresse e-mail du locataire.", link: "#lease/" + row.leaseId });
      }
    }
  }
  return { ok: true, updated: n, status: st };
}

/**
 * Notifie une liste d'utilisateurs : in-app toujours (sauf type désactivé), e-mail selon préférences utilisateur et organisation.
 * opts : { eventKey, userIds, type, title, body, link, organizationId, email (bool, défaut true) }
 */
function notify_(opts) {
  const ids = (opts.userIds || []).filter(function (v, i, arr) { return v && arr.indexOf(v) === i; });
  if (!ids.length) return { sent: 0 };
  const users = indexBy_(dbAll_("Users"), "userId");
  const orgEmail = opts.organizationId ? getSetting_("notify.emailEnabled", opts.organizationId) !== false : true;
  let sent = 0;
  ids.forEach(function (uid) {
    const u = users[String(uid)];
    if (!u || u.status !== "ACTIVE") return;
    const prefs = parseJson_(u.notifPrefsJson, { email: true, mutedTypes: [] }) || {};
    const muted = Array.isArray(prefs.mutedTypes) && prefs.mutedTypes.indexOf(opts.type) >= 0;
    if (muted) return;
    const inAppKey = opts.eventKey + "|" + uid;
    if (!dbAll_("Notifications").some(function (n) { return n.eventKey === inAppKey; })) {
      dbInsert_("Notifications", { organizationId: opts.organizationId || "", userId: uid, type: opts.type || "INFO", title: safeText_(opts.title, 200),
        body: safeText_(opts.body || "", 1000), link: safeText_(opts.link || "", 200), createdAt: nowIso_(), readAt: "", eventKey: inAppKey });
      sent++;
    }
    if (opts.email !== false && orgEmail && prefs.email !== false) {
      sendMailSafe_(u.email, "[ImmoPilot] " + opts.title, (opts.body || "") + "\n\nOuvrir ImmoPilot : " + safeAppUrl_() + (opts.link || ""), opts.eventKey, opts.organizationId);
    }
  });
  return { sent: sent };
}
function safeAppUrl_() { try { return appUrl_(); } catch (e) { return ""; } }
function superAdminIds_() { return dbAll_("UserRoles").filter(function (r) { return r.role === "SUPER_ADMIN" && r.status === "ACTIVE"; }).map(function (r) { return r.userId; }); }

/** Normalise un numéro (format national de l'édition : 06/07 → 2126/2127 au Maroc, 06/07 → 336/337 en France) et construit un lien wa.me encodé. */
function waLink_(phone, text) {
  let d = String(phone || "").replace(/[^\d+]/g, "");
  if (d.indexOf("+") === 0) d = d.slice(1);
  if (d.indexOf("00") === 0) d = d.slice(2);
  if (new RegExp(edition_().localMobileRe).test(d)) d = edition_().phoneCountry + d.slice(1);
  assert_(/^\d{8,15}$/.test(d), "Numéro WhatsApp invalide (format international attendu).");
  return "https://wa.me/" + d + "?text=" + encodeURIComponent(String(text || "").slice(0, 1500));
}

/* -------------------- Routes -------------------- */
function notifList_(p, a) {
  a = a || {};
  const rows = dbAll_("Notifications").filter(function (n) { return String(n.userId) === p.userId && (!a.unread || !n.readAt); })
    .sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); })
    .map(function (n) { return { notificationId: n.notificationId, type: n.type, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt, readAt: n.readAt }; });
  return pageOf_(rows, a);
}
function notifRead_(p, a) {
  const ids = a.all ? dbAll_("Notifications").filter(function (n) { return String(n.userId) === p.userId && !n.readAt; }).map(function (n) { return n.notificationId; }) : [safeText_(a.notificationId, 120)];
  let n = 0;
  ids.slice(0, 500).forEach(function (id) {
    const row = dbGet_("Notifications", id);
    if (row && String(row.userId) === p.userId && !row.readAt) { dbUpdate_("Notifications", id, { readAt: nowIso_() }); n++; }
  });
  return { ok: true, updated: n };
}
/** Lien WhatsApp vers le voyageur d'une réservation ou vers un numéro libre lié à un bien géré. */
function notifWhatsApp_(p, a) {
  let phone = a.phone, text = safeText_(a.message, 1500);
  if (a.reservationId) {
    const r = assertResv_(p, a.reservationId, "reservation.view");
    phone = phone || r.guestPhone;
    if (!text) { const prop = dbGet_("Properties", r.propertyId); text = "Bonjour " + r.guestName + ", votre séjour à " + prop.name + " du " + r.checkIn + " au " + r.checkOut + " est confirmé. Arrivée à partir de " + (prop.checkInTime || getSetting_("reservation.defaultCheckIn")) + "."; }
  } else assertPropAny_(p, a.propertyId, ["reservation.view", "cleaning.manage", "incident.manage", "lease.view"]);
  assert_(phone, "Aucun numéro de téléphone disponible.");
  const url = waLink_(phone, text);
  audit_("WHATSAPP_LINK_CREATED", "Notification", a.reservationId || a.propertyId, "", {});
  return { ok: true, url: url, sent: false, note: "Le lien ouvre WhatsApp avec le message pré-rempli ; l'envoi reste manuel." };
}
function notifSendEmail_(p, a) {
  const prop = assertPropAny_(p, a.propertyId, ["reservation.edit", "cleaning.manage", "incident.manage", "lease.manage"]);
  rateLimit_("mail:" + p.userId, 30, 3600);
  const r = sendMailSafe_(a.to, "[ImmoPilot] " + reqText_(a.subject, "Objet", 2, 150), reqText_(a.body, "Message", 2, 5000), "manual:" + newId_("m"), prop.organizationId);
  audit_("EMAIL_SENT", "Notification", prop.propertyId, prop.organizationId, { ok: r.ok });
  if (!r.ok) throw new AppError("EMAIL", "Envoi impossible : " + r.error);
  return { ok: true };
}
