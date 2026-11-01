/**
 * Prélèvement automatique des abonnements par carte, via SumUp (paiements récurrents avec authentification forte).
 *
 * Parcours : le super administrateur attribue un forfait (sub.assign) → le propriétaire enregistre sa carte UNE fois dans le
 * formulaire sécurisé SumUp (widget, 3D Secure ; aucune donnée de carte ne passe par ImmoPilot) → à chaque échéance (fin d'essai,
 * fin de période, ou tout de suite si un règlement est attendu) le serveur débite la carte enregistrée et prolonge l'abonnement
 * (subApplyPayment_). Échec : nouvel essai chaque jour (SUMUP_MAX_ATTEMPTS_ au plus par échéance), notifications, puis la règle
 * habituelle (lecture seule après le délai de grâce) s'applique.
 *
 * Configuration (propriétés du script ; jamais dans le code ni dans GitHub) :
 *   SUMUP_API_KEY        clé secrète SumUp (sup_sk_…)
 *   SUMUP_MERCHANT_CODE  code marchand SumUp
 *   SUMUP_CURRENCY       devise du compte SumUp (EUR par défaut)
 *   SUMUP_RATE           obligatoire si la devise de l'édition (MAD) diffère de SUMUP_CURRENCY : montant en SUMUP_CURRENCY
 *                        pour 1 unité de la devise de l'édition (ex. 0.092). Sans lui, aucun débit n'est tenté.
 * Tant que la clé et le code marchand ne sont pas renseignés, rien ne change : paiement manuel comme avant.
 */
var SUMUP_API_ = "https://api.sumup.com/v0.1";
var SUMUP_MAX_ATTEMPTS_ = 4;
var SUMUP_SETUP_AMOUNT_ = 1; // autorisation de vérification de la carte, remboursée aussitôt par SumUp

function sumupConf_() {
  if (TEST_HOOKS_.sumupConfig) return TEST_HOOKS_.sumupConfig;
  const P = PropertiesService.getScriptProperties();
  return { key: P.getProperty("SUMUP_API_KEY") || "", merchant: P.getProperty("SUMUP_MERCHANT_CODE") || "", currency: (P.getProperty("SUMUP_CURRENCY") || "EUR").toUpperCase(),
    rate: Number(P.getProperty("SUMUP_RATE")) || 0 };
}
function sumupEnabled_() { const c = sumupConf_(); return !!(c.key && c.merchant); }

/** Montant à débiter dans la devise SumUp. Garde-fou : jamais un montant en MAD envoyé tel quel vers un compte en EUR. */
function sumupAmount_(localAmount) {
  const c = sumupConf_(), local = round2_(num_(localAmount));
  if (cur_() === c.currency) return { amount: local, currency: c.currency, rate: 1 };
  if (!(c.rate > 0)) throw new AppError("PAYMENT", "Taux de conversion " + cur_() + " → " + c.currency + " non défini (SUMUP_RATE) : aucun prélèvement possible.");
  return { amount: round2_(local * c.rate), currency: c.currency, rate: c.rate };
}

/** Appel à l'API SumUp. Renvoie { status, body } ; lève une erreur lisible au-delà de 299 sauf si allow contient le code. */
function sumupCall_(method, path, body, allow) {
  const c = sumupConf_();
  if (!c.key) throw new AppError("PAYMENT", "SumUp n'est pas configuré.");
  const params = { method: method, contentType: "application/json", muteHttpExceptions: true, headers: { Authorization: "Bearer " + c.key } };
  if (body) params.payload = JSON.stringify(body);
  const r = TEST_HOOKS_.sumupFetch ? TEST_HOOKS_.sumupFetch(SUMUP_API_ + path, params) : UrlFetchApp.fetch(SUMUP_API_ + path, params);
  const status = r.getResponseCode(), txt = r.getContentText();
  let j = {}; try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = { raw: String(txt).slice(0, 300) }; }
  if (status >= 300 && (allow || []).indexOf(status) < 0) {
    const msg = j.message || j.error_message || (j[0] && j[0].message) || j.error_code || ("HTTP " + status);
    throw new AppError("PAYMENT", "SumUp a refusé l'opération : " + String(msg).slice(0, 200));
  }
  return { status: status, body: j };
}

/* ------------------------------ Cartes enregistrées ------------------------------ */
function sumupCardOf_(orgId) {
  return dbAll_("BillingCards").filter(function (c) { return String(c.organizationId) === String(orgId) && c.status === "ACTIVE" && c.token; })
    .sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); })[0] || null;
}
function sumupCustomerId_(orgId) { return "immo-" + edition_().code.toLowerCase() + "-" + String(orgId).replace(/[^A-Za-z0-9_-]/g, "").slice(-48); }

/** Organisation qui règle l'abonnement : propriétaire (option agences) ou organisation cliente elle-même. */
function sumupPayerSub_(p, orgId) {
  const org = dbGet_("Organizations", orgId);
  assert_(org && org.type !== "PLATFORM", "Organisation introuvable.");
  if (agencyBillingParent_(org)) throw new AppError("VALIDATION", "Cette agence est incluse dans l'abonnement de son propriétaire : c'est lui qui enregistre la carte.");
  const e = entitlement_(orgId), s = e.subscription;
  assert_(s && ["CANCELLED", "EXPIRED"].indexOf(s.status) < 0, "Aucun abonnement en cours : l'administrateur ImmoPilot doit d'abord attribuer un forfait.");
  return s;
}

/** Infos de paiement par carte pour l'écran « Abonnements » (aucun secret, aucun jeton). */
function sumupCardInfo_(orgId, s) {
  if (!sumupEnabled_()) return { enabled: false };
  const card = sumupCardOf_(orgId), out = { enabled: true, active: !!card, label: card ? card.label : "", savedAt: card ? card.createdAt : "", lastError: card ? card.lastChargeError || "" : "" };
  if (s) { try { const total = subAgencyOption_(s).totalPrice, a = sumupAmount_(total); out.amount = a.amount; out.currency = a.currency; out.converted = a.rate !== 1; out.rate = a.rate; }
    catch (e) { out.amountError = e.message; } }
  return out;
}

/** 1. Le propriétaire demande à enregistrer sa carte : client SumUp + paiement de vérification (tokenisation). */
function subCardSetup_(p, a) {
  const orgId = safeText_(a.organizationId, 120);
  assertOrgCap_(p, orgId, "settings.manage");
  assert_(sumupEnabled_(), "Le paiement par carte n'est pas encore activé sur cette plateforme.");
  const s = sumupPayerSub_(p, orgId);
  sumupAmount_(subAgencyOption_(s).totalPrice); // refuse dès maintenant si la conversion n'est pas configurée
  const c = sumupConf_(), org = dbGet_("Organizations", orgId), customerId = sumupCustomerId_(orgId);
  sumupCall_("post", "/customers", { customer_id: customerId, personal_details: { email: safeText_(p.email, 200), first_name: safeText_(org.name, 100) } }, [409]);
  const co = sumupCall_("post", "/checkouts", { checkout_reference: "CARD-" + orgId.slice(-20) + "-" + Date.now(), amount: SUMUP_SETUP_AMOUNT_, currency: c.currency, merchant_code: c.merchant,
    description: "ImmoPilot : enregistrement de la carte (montant remboursé)", customer_id: customerId, purpose: "SETUP_RECURRING_PAYMENT" }).body;
  assert_(co && co.id, "SumUp n'a pas créé le paiement de vérification.");
  dbInsert_("BillingCards", { organizationId: orgId, status: "PENDING", customerId: customerId, token: "", label: "", setupCheckoutId: co.id, createdAt: nowIso_(), createdBy: p.email });
  audit_("CARD_SETUP_STARTED", "Organization", orgId, orgId, {});
  return { checkoutId: co.id, setupAmount: SUMUP_SETUP_AMOUNT_, currency: c.currency, info: sumupCardInfo_(orgId, s) };
}

/** 2. Après le widget : on relit le paiement chez SumUp (jamais le navigateur), on garde le jeton, et on débite si une échéance est due. */
function subCardConfirm_(p, a) {
  const orgId = safeText_(a.organizationId, 120), checkoutId = safeText_(a.checkoutId, 120);
  assertOrgCap_(p, orgId, "settings.manage");
  const row = dbAll_("BillingCards").find(function (c) { return String(c.organizationId) === orgId && c.setupCheckoutId === checkoutId && c.status === "PENDING"; });
  assert_(row, "Enregistrement de carte introuvable ou déjà traité.");
  const co = sumupCall_("get", "/checkouts/" + encodeURIComponent(checkoutId)).body;
  assert_(String(co.customer_id || row.customerId) === row.customerId, "Paiement de vérification incohérent.");
  let token = co.payment_instrument && co.payment_instrument.token, label = "";
  if (!token || ["PAID", "SUCCESSFUL"].indexOf(String(co.status)) < 0) {
    const list = sumupCall_("get", "/customers/" + encodeURIComponent(row.customerId) + "/payment-instruments", null, [404]).body;
    const inst = (Array.isArray(list) ? list : []).filter(function (x) { return x.active !== false && x.token; }).sort(function (x, y) { return String(y.created_at || "").localeCompare(String(x.created_at || "")); })[0];
    if (["PAID", "SUCCESSFUL"].indexOf(String(co.status)) < 0 || !inst) {
      dbUpdate_("BillingCards", row.cardId, { status: "FAILED", lastChargeError: "Carte non validée (" + (co.status || "inconnu") + ")", updatedAt: nowIso_() });
      throw new AppError("PAYMENT", "La carte n'a pas été validée par SumUp. Réessayez ou utilisez une autre carte.");
    }
    token = inst.token; label = sumupCardLabel_(inst.card);
  }
  if (!label) label = sumupCardLabel_((co.payment_instrument || {}).card || co.card);
  return withLock_(function () {
    dbAll_("BillingCards").filter(function (c) { return String(c.organizationId) === orgId && c.status === "ACTIVE" && c.cardId !== row.cardId; }).forEach(function (old) {
      try { if (old.token && old.token !== token) sumupCall_("delete", "/customers/" + encodeURIComponent(old.customerId) + "/payment-instruments/" + encodeURIComponent(old.token), null, [404]); } catch (e) { /* sans gravité */ }
      dbUpdate_("BillingCards", old.cardId, { status: "REPLACED", token: "", updatedAt: nowIso_() });
    });
    dbUpdate_("BillingCards", row.cardId, { status: "ACTIVE", token: token, label: label || "Carte enregistrée", updatedAt: nowIso_(), chargeAttempts: 0, lastChargeError: "" });
    audit_("CARD_SAVED", "Organization", orgId, orgId, { label: label });
    const s = sumupPayerSub_(p, orgId), res = { ok: true, label: label || "Carte enregistrée", charged: null };
    if (sumupDue_(s, todayStr_())) res.charged = sumupChargeSub_(s, p.email);
    return res;
  });
}
function sumupCardLabel_(card) {
  card = card || {};
  const last4 = card.last_4_digits || card.last4 || "", type = card.type || card.brand || "";
  return last4 ? (type ? String(type).toUpperCase() + " " : "") + "•••• " + String(last4).slice(-4) : "";
}

/** Retrait de la carte : plus aucun prélèvement automatique (l'abonnement continue, règlement manuel possible). */
function subCardRemove_(p, a) {
  const orgId = safeText_(a.organizationId, 120);
  if (!p.isSuper) assertOrgCap_(p, orgId, "settings.manage");
  const card = sumupCardOf_(orgId);
  assert_(card, "Aucune carte enregistrée.");
  try { sumupCall_("delete", "/customers/" + encodeURIComponent(card.customerId) + "/payment-instruments/" + encodeURIComponent(card.token), null, [404]); } catch (e) { /* le jeton est oublié de notre côté dans tous les cas */ }
  dbUpdate_("BillingCards", card.cardId, { status: "REMOVED", token: "", updatedAt: nowIso_() });
  audit_("CARD_REMOVED", "Organization", orgId, orgId, {});
  return { ok: true };
}

/* ------------------------------ Prélèvements ------------------------------ */
/** Une échéance est-elle due aujourd'hui (ou dépassée) ? */
function sumupDue_(s, today) {
  if (!s || ["CANCELLED", "EXPIRED"].indexOf(s.status) >= 0) return false;
  if (s.status === "TRIAL") return !!s.trialEnd && s.trialEnd <= today;
  if (s.status === "ACTIVE") return !bool_(s.cancelAtPeriodEnd) && !!s.periodEnd && s.periodEnd <= today;
  return ["PAST_DUE", "SUSPENDED"].indexOf(s.status) >= 0; // règlement attendu
}
function sumupDueKey_(s) { return String(s.status === "TRIAL" ? s.trialEnd : s.status === "ACTIVE" ? s.periodEnd : s.nextDueDate || s.periodEnd || s.startDate).replace(/-/g, ""); }
function sumupRef_(s, seq) { return "SUB-" + String(s.subscriptionId).slice(-24) + "-" + sumupDueKey_(s) + "-" + seq; }

/**
 * Débite UNE échéance d'un abonnement avec la carte enregistrée. Anti-double débit : chaque tentative a une référence unique
 * (SumUp refuse les doublons) et les tentatives précédentes de la même échéance sont relues avant d'en lancer une nouvelle.
 */
function sumupChargeSub_(s, actor) {
  const card = sumupCardOf_(s.organizationId);
  if (!card) return { ok: false, reason: "NO_CARD" };
  const c = sumupConf_(), total = subAgencyOption_(s).totalPrice, amt = sumupAmount_(total), dueKey = sumupDueKey_(s);
  // chargeSeq ne revient jamais en arrière : chaque tentative a une référence unique, même si une date d'échéance se répète.
  const sameDue = String(card.lastChargeKey || "") === dueKey, attempts = sameDue ? Number(card.chargeAttempts) || 0 : 0, seq = Number(card.chargeSeq) || 0;
  // Une tentative précédente de CETTE échéance a-t-elle abouti sans être enregistrée (coupure réseau…) ?
  for (let k = seq - attempts + 1; k <= seq; k++) {
    const found = sumupCall_("get", "/checkouts?checkout_reference=" + encodeURIComponent(sumupRef_(s, k)), null, [404]).body;
    const paid = (Array.isArray(found) ? found : []).find(function (x) { return String(x.status) === "PAID"; });
    if (paid) return sumupRecordPaid_(s, card, paid, total, amt, actor);
  }
  if (attempts >= SUMUP_MAX_ATTEMPTS_) return { ok: false, reason: "MAX_ATTEMPTS" };
  if (sameDue && card.lastChargeAt && String(card.lastChargeAt).slice(0, 10) === todayStr_() && actor === "system") return { ok: false, reason: "ALREADY_TRIED_TODAY" };
  const ref = sumupRef_(s, seq + 1);
  dbUpdate_("BillingCards", card.cardId, { lastChargeKey: dueKey, chargeAttempts: attempts + 1, chargeSeq: seq + 1, lastChargeAt: nowIso_(), updatedAt: nowIso_() });
  let res;
  try {
    const plan = dbGet_("SubscriptionPlans", s.planCode) || {};
    const co = sumupCall_("post", "/checkouts", { checkout_reference: ref, amount: amt.amount, currency: amt.currency, merchant_code: c.merchant, customer_id: card.customerId,
      description: ("ImmoPilot : abonnement " + (plan.name || s.planCode)).slice(0, 120) }).body;
    res = sumupCall_("put", "/checkouts/" + encodeURIComponent(co.id), { payment_type: "card", token: card.token, customer_id: card.customerId }).body;
  } catch (e) { res = { status: "FAILED", message: e.message }; }
  if (String(res.status) === "PAID") return sumupRecordPaid_(s, card, res, total, amt, actor);
  const why = String(res.message || res.status || "refusé").slice(0, 200);
  dbUpdate_("BillingCards", card.cardId, { lastChargeError: why, updatedAt: nowIso_() });
  auditAs_(actor || "system", "", "SUBSCRIPTION_CARD_CHARGE_FAILED", "Subscription", s.subscriptionId, s.organizationId, { attempt: attempts + 1, reason: why });
  sumupNotify_(s, "sub-card-fail:" + s.subscriptionId + ":" + dueKey + ":" + (attempts + 1), "Prélèvement de l'abonnement refusé",
    "Le prélèvement de " + amt.amount + " " + amt.currency + " sur " + card.label + " a échoué (" + why + "). " + (attempts + 1 < SUMUP_MAX_ATTEMPTS_ ? "Nouvel essai demain. " : "") + "Vous pouvez enregistrer une autre carte dans Abonnements.", true);
  return { ok: false, reason: "DECLINED", message: why, attempt: attempts + 1 };
}
function sumupRecordPaid_(s, card, co, total, amt, actor) {
  const tx = ((co.transactions || [])[0] || {}).transaction_code || co.transaction_code || co.id || "";
  const r = subApplyPayment_(dbGet_("Subscriptions", s.subscriptionId), total, todayStr_(), "CARD", "SumUp " + tx, "", 1, actor || "system");
  if (amt.rate !== 1) dbUpdate_("Payments", r.paymentId, { note: "1 période — débité " + amt.amount + " " + amt.currency + " (taux " + amt.rate + ")" });
  dbUpdate_("BillingCards", card.cardId, { lastChargeKey: sumupDueKey_(s) + ":OK", chargeAttempts: 0, lastChargeError: "", updatedAt: nowIso_() });
  auditAs_(actor || "system", "", "SUBSCRIPTION_CARD_CHARGED", "Subscription", s.subscriptionId, s.organizationId, { amount: amt.amount, currency: amt.currency, periodEnd: r.periodEnd });
  sumupNotify_(s, "sub-card-ok:" + s.subscriptionId + ":" + r.periodEnd, "Abonnement réglé par carte", amt.amount + " " + amt.currency + " prélevés sur " + card.label + ". Abonnement payé jusqu'au " + r.periodEnd + ".", false);
  return { ok: true, paymentId: r.paymentId, periodEnd: r.periodEnd, amount: amt.amount, currency: amt.currency };
}
function sumupNotify_(s, key, title, body, alsoSuper) {
  const admins = dbAll_("UserRoles").filter(function (r) { return r.status === "ACTIVE" && String(r.organizationId) === String(s.organizationId) && (r.role === "OWNER" || r.role === "AGENCY_ADMIN"); }).map(function (r) { return r.userId; });
  try { notify_({ eventKey: key, userIds: admins, type: "SUBSCRIPTION", organizationId: s.organizationId, title: title, body: body, link: "#subscriptions" });
    if (alsoSuper) notify_({ eventKey: key + ":super", userIds: superAdminIds_(), type: "SUBSCRIPTION", organizationId: "", title: title + " — " + ((dbGet_("Organizations", s.organizationId) || {}).name || ""), body: body, link: "#subscriptions" });
  } catch (e) { /* une notification manquée ne doit jamais bloquer un paiement */ }
}

/** Tâche quotidienne (avant subscriptionJob_) : débite toutes les échéances dues des abonnements ayant une carte. */
function sumupChargeJob_() {
  if (!sumupEnabled_()) return { skipped: "SumUp non configuré" };
  const today = todayStr_(), demo = demoOrgIdSet_(); let paid = 0, failed = 0;
  dbAll_("Subscriptions").filter(function (s) { return !demo[String(s.organizationId)] && sumupDue_(s, today) && sumupCardOf_(s.organizationId); }).forEach(function (s) {
    try { const r = withLock_(function () { const fresh = dbGet_("Subscriptions", s.subscriptionId); return sumupDue_(fresh, today) ? sumupChargeSub_(fresh, "system") : { ok: false, reason: "NOT_DUE" }; });
      if (r.ok) paid++; else if (r.reason === "DECLINED") failed++; }
    catch (e) { failed++; }
  });
  return { paid: paid, failed: failed };
}

/** Super administrateur : relancer tout de suite le prélèvement d'une échéance due. */
function subChargeNow_(p, a) {
  requireSuper_(p);
  const s = dbGet_("Subscriptions", safeText_(a.subscriptionId, 120));
  assert_(s, "Abonnement introuvable.");
  assert_(sumupEnabled_(), "SumUp n'est pas configuré.");
  assert_(sumupDue_(s, todayStr_()), "Aucune échéance due pour cet abonnement.");
  return withLock_(function () { return sumupChargeSub_(dbGet_("Subscriptions", s.subscriptionId), p.email); });
}

/**
 * Contrôle de la configuration (commande : immopilot run testerSumUp). Aucun paiement : lit seulement le profil du compte SumUp
 * et vérifie que le code marchand correspond. Ne renvoie jamais la clé.
 */
function testerSumUp() {
  const c = sumupConf_();
  if (!c.key || !c.merchant) return { ok: false, message: "SUMUP_API_KEY ou SUMUP_MERCHANT_CODE manquant." };
  const me = sumupCall_("get", "/me").body, prof = me.merchant_profile || {};
  const code = prof.merchant_code || me.merchant_code || "";
  const out = { ok: code === c.merchant, compteSumUp: code, codeConfigure: c.merchant, devise: c.currency, deviseEdition: cur_(), pays: prof.country || "" };
  if (cur_() !== c.currency) { out.taux = c.rate; if (!(c.rate > 0)) { out.ok = false; out.message = "SUMUP_RATE manquant (conversion " + cur_() + " → " + c.currency + ")."; } else out.exemple = "100 " + cur_() + " = " + round2_(100 * c.rate) + " " + c.currency; }
  if (code !== c.merchant) out.message = "Le code marchand configuré ne correspond pas à la clé.";
  return out;
}
