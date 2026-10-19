/**
 * Notifications centralisées : in-app (feuille Notifications), e-mail (MailApp/Gmail), liens WhatsApp wa.me.
 * Anti-doublon : chaque envoi porte une clé d'événement ; NotificationLogs garde (eventKey, canal, destinataire).
 * WhatsApp : ImmoPilot génère un lien qui OUVRE une conversation pré-remplie. Aucun message n'est envoyé automatiquement.
 */
function sendMailSafe_(to, subject, body, eventKey, orgId) {
  to = validateEmail_(to);
  const key = String(eventKey || "") ;
  if (key && dbAll_("NotificationLogs").some(function (l) { return l.eventKey === key && l.channel === "EMAIL" && l.recipient === to && l.status === "SENT"; })) return { ok: true, duplicate: true };
  let status = "SENT", error = "";
  try {
    const quota = TEST_HOOKS_.mailQuota !== null ? TEST_HOOKS_.mailQuota : MailApp.getRemainingDailyQuota();
    if (quota < 1) throw new Error("Quota quotidien MailApp épuisé.");
    const text = String(body || "").slice(0, 20000), html = mailHtml_(text);
    if (TEST_HOOKS_.mailSink) TEST_HOOKS_.mailSink.push({ to: to, subject: subject, body: text, htmlBody: html });
    else MailApp.sendEmail({ to: to, subject: safeText_(subject, 200), body: text, htmlBody: html, name: IMMO_CONFIG.APP_NAME });
  } catch (e) { status = "FAILED"; error = String(e.message || e).slice(0, 300); }
  try { dbInsert_("NotificationLogs", { eventKey: key || newId_("evt"), channel: "EMAIL", recipient: to, type: "", status: status, sentAt: nowIso_(), error: error, organizationId: orgId || "" }); } catch (e2) { console.error(e2.message); }
  return status === "SENT" ? { ok: true } : { ok: false, error: error };
}

/**
 * Version HTML d'un e-mail texte : texte échappé, sauts de ligne conservés, et chaque adresse https:// transformée
 * en lien cliquable (bouton pour les liens de l'application). Certaines messageries ne rendent pas cliquables les liens
 * d'un e-mail en texte brut ; la version texte reste jointe pour les autres.
 */
function mailHtml_(text) {
  const parts = String(text || "").split(/(https:\/\/[^\s<>"]+)/);
  const inner = parts.map(function (part, i) {
    if (i % 2 === 0) return escapeHtml_(part).replace(/\n/g, "<br>");
    const url = escapeHtml_(part);
    return "<br><a href=\"" + url + "\" style=\"display:inline-block;background:#2f4fd8;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold\">Ouvrir ImmoPilot</a>" +
      "<br><span style=\"font-size:12px;color:#64748b\">Si le bouton ne fonctionne pas, copiez ce lien en entier dans la barre d'adresse de votre navigateur :<br><a href=\"" + url + "\" style=\"color:#2f4fd8;word-break:break-all\">" + url + "</a></span><br>";
  }).join("");
  return "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1d2b3a\">" + inner + "</div>";
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
