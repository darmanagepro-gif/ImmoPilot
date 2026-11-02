/**
 * Signature électronique du contrat d'abonnement, exigée avant l'enregistrement de la carte (paiement).
 *
 * Procédé (signature électronique simple) : le client lit le contrat, coche son acceptation, reçoit un code à usage unique
 * par e-mail (adresse de son compte) ou par SMS (numéro de contact), puis le saisit. Sont conservés comme preuve :
 * identité du signataire, canal et destination (masquée), date et heure, adresse IP, navigateur, empreinte SHA-256 du
 * contrat signé et version des conditions générales. Le PDF signé (avec son certificat) est enregistré et envoyé au client.
 *
 * Le code n'est jamais stocké en clair (empreinte), expire après 10 minutes et accepte 5 essais au plus.
 */
var SIGN_OTP_MINUTES_ = 10, SIGN_OTP_MAX_TRIES_ = 5, SIGN_MAX_SENDS_PER_HOUR_ = 5;

/** Métadonnées de la requête HTTP (IP, navigateur), fournies par le serveur dédié. */
function requestMeta_() {
  const g = typeof globalThis !== "undefined" ? globalThis : this;
  const m = g.REQUEST_META_;
  return m && typeof m === "object" ? { ip: String(m.ip || "").slice(0, 64), userAgent: String(m.userAgent || "").slice(0, 300) } : { ip: "", userAgent: "" };
}

/* ------------------------------- SMS (Brevo) ------------------------------- */
function smsConf_() {
  if (TEST_HOOKS_.smsSink) return { key: "test", sender: "ImmoPilot" };
  const g = typeof globalThis !== "undefined" ? globalThis : this, env = g.IMMO_SECRETS_ || {};
  const P = PropertiesService.getScriptProperties(), key = String(env.brevoApiKey || P.getProperty("BREVO_API_KEY") || "").trim();
  if (!key) return null;
  const sender = String(P.getProperty("SMS_SENDER") || "ImmoPilot").replace(/[^A-Za-z0-9]/g, "").slice(0, 11) || "ImmoPilot";
  return { key: key, sender: sender };
}
/** Numéro au format international sans « + » (ex. 33612345678), ou "" si inutilisable. */
function intlPhone_(raw) {
  let d = String(raw || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.charAt(0) === "+") d = d.slice(1);
  else if (d.slice(0, 2) === "00") d = d.slice(2);
  else if (d.charAt(0) === "0") d = edition_().phoneCountry + d.slice(1);
  d = d.replace(/\D/g, "");
  return d.length >= 10 && d.length <= 15 ? d : "";
}
function maskPhone_(d) { return d ? "+" + d.slice(0, d.length - 9) + " " + "•".repeat(5) + " " + d.slice(-4) : ""; }
function maskEmailAddr_(e) { const s = String(e || ""), i = s.indexOf("@"); return i > 0 ? s.slice(0, Math.min(2, i)) + "•••" + s.slice(i) : s; }
function smsSend_(to, text) {
  if (TEST_HOOKS_.smsSink) { TEST_HOOKS_.smsSink.push({ to: to, text: text }); return; }
  const c = smsConf_();
  assert_(c, "Envoi de SMS non configuré.");
  const r = UrlFetchApp.fetch("https://api.brevo.com/v3/transactionalSMS/sms", { method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { "api-key": c.key, accept: "application/json" }, payload: JSON.stringify({ sender: c.sender, recipient: to, content: text, type: "transactional" }) });
  const code = r.getResponseCode();
  if (code >= 300) { console.error("SMS Brevo " + code + " : " + String(r.getContentText()).slice(0, 300)); throw new AppError("SMS", "Le SMS n'a pas pu être envoyé. Utilisez la réception du code par e-mail."); }
}

/* ------------------------------- Signature ------------------------------- */
/** Téléphone de contact du signataire : son profil, sinon celui de l'organisation. */
function signPhoneOf_(p, orgId) {
  const u = dbGet_("Users", p.userId) || {}, org = dbGet_("Organizations", orgId) || {};
  return intlPhone_(u.phone) || intlPhone_(org.phone);
}
/** Empreinte du contrat présenté au signataire (contenu, forfait, prix, version des conditions générales). */
function subContractHash_(d) {
  return sha256Hex_([d.html, d.cur.subscriptionId, d.cur.planCode, subAgencyOption_(d.cur).totalPrice, d.cur.currency || cur_(), d.legalVersion].join("\u0001"));
}
/** Signature valide pour l'abonnement en cours (même abonnement, même forfait, même montant), ou null. */
function subSignatureOf_(orgId, s) {
  if (!s) return null;
  const total = round2_(subAgencyOption_(s).totalPrice);
  return dbAll_("ContractSignatures").filter(function (x) {
    return String(x.organizationId) === String(orgId) && x.status === "SIGNED" && x.subscriptionId === s.subscriptionId && x.planCode === s.planCode && round2_(x.totalPrice) === total;
  }).sort(function (a, b) { return String(b.signedAt).localeCompare(String(a.signedAt)); })[0] || null;
}
/** État affiché au client (encadré « Prélèvement automatique par carte »). */
function subSignInfo_(p, orgId, s) {
  const sig = subSignatureOf_(orgId, s), phone = p ? signPhoneOf_(p, orgId) : "";
  return { signed: !!sig, signedAt: sig ? sig.signedAt : "", channel: sig ? sig.channel : "", email: p ? maskEmailAddr_(p.email) : "",
    smsAvailable: !!(smsConf_() && phone), phone: maskPhone_(phone) };
}

/** 1. Le client accepte le contrat et demande son code (e-mail ou SMS). */
function subSignStart_(p, a) {
  const orgId = safeText_(a.organizationId, 120);
  assertOrgCap_(p, orgId, "settings.manage");
  assert_(a.accept === true, "Cochez la case d'acceptation du contrat et des conditions générales.");
  const channel = oneOf_(a.channel || "EMAIL", ["EMAIL", "SMS"], "Mode de réception du code");
  const s = sumupPayerSub_(p, orgId);
  const recent = dbAll_("ContractSignatures").filter(function (x) { return String(x.organizationId) === orgId && x.createdAt > new Date(Date.now() - 3600000).toISOString(); });
  assert_(recent.length < SIGN_MAX_SENDS_PER_HOUR_, "Trop de codes demandés. Réessayez dans une heure.");
  const d = subContractData_(orgId), u = dbGet_("Users", p.userId) || {};
  let dest = "", masked = "";
  if (channel === "SMS") { dest = signPhoneOf_(p, orgId); assert_(smsConf_() && dest, "Réception par SMS indisponible : renseignez votre numéro de téléphone dans votre profil, ou choisissez l'e-mail."); masked = maskPhone_(dest); }
  else { dest = validateEmail_(p.email); masked = maskEmailAddr_(dest); }
  const digits = (parseInt(randomToken_().slice(0, 12), 16) % 1000000 + 1000000).toString().slice(1);
  const row = dbInsert_("ContractSignatures", { organizationId: orgId, subscriptionId: s.subscriptionId, planCode: s.planCode, totalPrice: round2_(subAgencyOption_(s).totalPrice),
    currency: s.currency || cur_(), contractHash: subContractHash_(d), legalVersion: d.legalVersion, signerUserId: p.userId, signerEmail: p.email, signerName: safeText_(u.displayName || p.email, 120),
    channel: channel, destination: masked, otpHash: "", otpExpires: new Date(Date.now() + SIGN_OTP_MINUTES_ * 60000).toISOString(), otpAttempts: 0, status: "PENDING", createdAt: nowIso_() });
  dbUpdate_("ContractSignatures", row.signatureId, { otpHash: sha256Hex_(row.signatureId + ":" + digits) });
  const text = "ImmoPilot : votre code de signature du contrat d'abonnement est " + digits + ". Il expire dans " + SIGN_OTP_MINUTES_ + " minutes. Ne le communiquez à personne.";
  if (channel === "SMS") smsSend_(dest, text);
  else {
    const r = sendMailSafe_(dest, "Code de signature de votre contrat ImmoPilot : " + digits, "Bonjour,\n\n" + text + "\n\nContrat : abonnement " + d.cur.planCode + " pour " + d.org.name +
      ".\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.", "sign-otp:" + row.signatureId, orgId, { plain: true });
    if (!r.ok) throw new AppError("MAIL", "L'e-mail contenant le code n'a pas pu être envoyé. Réessayez dans un instant.");
  }
  audit_("CONTRACT_SIGN_CODE_SENT", "Subscription", s.subscriptionId, orgId, { channel: channel, destination: masked });
  return { signatureId: row.signatureId, channel: channel, destination: masked, expiresInMinutes: SIGN_OTP_MINUTES_ };
}

/** 2. Saisie du code : la signature est enregistrée avec ses preuves, le PDF signé est conservé et envoyé. */
function subSignConfirm_(p, a) {
  const orgId = safeText_(a.organizationId, 120), id = safeText_(a.signatureId, 80), code = String(a.code || "").replace(/\D/g, "");
  assertOrgCap_(p, orgId, "settings.manage");
  return withLock_(function () {
    const row = dbGet_("ContractSignatures", id);
    assert_(row && String(row.organizationId) === orgId && row.signerUserId === p.userId && row.status === "PENDING", "Demande de signature introuvable : redemandez un code.");
    if (row.otpExpires < nowIso_()) { dbUpdate_("ContractSignatures", id, { status: "EXPIRED" }); throw new AppError("VALIDATION", "Code expiré : redemandez un nouveau code."); }
    if (sha256Hex_(id + ":" + code) !== row.otpHash) {
      const n = num_(row.otpAttempts) + 1;
      dbUpdate_("ContractSignatures", id, n >= SIGN_OTP_MAX_TRIES_ ? { otpAttempts: n, status: "EXPIRED" } : { otpAttempts: n });
      throw new AppError("VALIDATION", n >= SIGN_OTP_MAX_TRIES_ ? "Code incorrect, trop d'essais : redemandez un nouveau code." : "Code incorrect (" + (SIGN_OTP_MAX_TRIES_ - n) + " essai(s) restant(s)).");
    }
    const s = sumupPayerSub_(p, orgId), d = subContractData_(orgId);
    assert_(s.subscriptionId === row.subscriptionId && subContractHash_(d) === row.contractHash, "Le contrat a changé depuis l'envoi du code : relisez-le et redemandez un code.");
    const meta = requestMeta_();
    dbUpdate_("ContractSignatures", id, { status: "SIGNED", signedAt: nowIso_(), ip: meta.ip, userAgent: meta.userAgent, otpHash: "" });
    const sig = dbGet_("ContractSignatures", id);
    const blob = subContractBlob_(d, sig);
    const doc = storeFile_({ propertyId: "", organizationId: orgId }, "SUBSCRIPTION", s.subscriptionId, "CONTRACT",
      { mimeType: "application/pdf", fileName: blob.getName(), base64: Utilities.base64Encode(blob.getBytes()) }, p.email);
    dbUpdate_("ContractSignatures", id, { documentId: doc.documentId });
    audit_("CONTRACT_SIGNED", "Subscription", s.subscriptionId, orgId, { signatureId: id, channel: row.channel, hash: row.contractHash });
    sendMailSafe_(p.email, "Votre contrat d'abonnement ImmoPilot signé", "Bonjour,\n\nVotre contrat d'abonnement ImmoPilot (" + d.org.name + ", forfait " + s.planCode + ") a été signé électroniquement le " +
      Utilities.formatDate(new Date(), tz_(), "dd/MM/yyyy à HH:mm") + ".\nVous le trouverez en pièce jointe ; il reste disponible dans ImmoPilot, menu Abonnement.\n\nMerci de votre confiance.", "sign-done:" + id, orgId,
      { attachments: [blob], plain: true });
    return { ok: true, signedAt: sig.signedAt, documentId: doc.documentId };
  });
}

/** Certificat de signature, ajouté à la fin du contrat signé. */
function subSignCertificateHtml_(sig) {
  const law = edition_().code === "FR" ? "règlement (UE) n° 910/2014 (eIDAS) et articles 1366 et 1367 du Code civil" : "loi n° 53-05 relative à l'échange électronique de données juridiques";
  const when = sig.signedAt ? Utilities.formatDate(new Date(sig.signedAt), tz_(), "dd/MM/yyyy à HH:mm:ss") + " (" + tz_() + ") — " + sig.signedAt : "—";
  return "<h2>Signature électronique</h2><div class='box'><p style='margin:0 0 6px'><b>Contrat signé électroniquement par le client.</b></p>" +
    htmlTable_(["Élément de preuve", "Valeur"], [["Signataire", sig.signerName + " (" + sig.signerEmail + ")"], ["Date et heure", when],
      ["Procédé", "Acceptation du contrat puis code à usage unique envoyé " + (sig.channel === "SMS" ? "par SMS au " : "par e-mail à ") + sig.destination],
      ["Adresse IP", sig.ip || "—"], ["Navigateur", sig.userAgent || "—"], ["Conditions générales", "version du " + pdfDate_(sig.legalVersion)],
      ["Empreinte SHA-256 du contrat", sig.contractHash], ["Référence de la signature", sig.signatureId]]) +
    "<p class='muted' style='margin:6px 0 0'>Signature électronique simple au sens du " + escapeHtml_(law) + ". Le prestataire accepte le contrat par sa mise à disposition dans l'application.</p></div>";
}
