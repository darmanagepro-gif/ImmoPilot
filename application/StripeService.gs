/**
 * Paiement des artisans « par la plateforme » avec Stripe Connect, en paiements DIRECTS : l'artisan encaisse lui-même sur SON
 * compte Stripe (tableau de bord Stripe complet), la plateforme ne prélève que sa commission (application_fee_amount).
 * L'artisan est le vendeur : il apparaît sur le reçu et gère remboursements et litiges ; Stripe gère le risque et assume les pertes.
 * ECO SYNERGY ne détient jamais les fonds et n'est pas partie à la vente (cohérent avec ses conditions générales).
 * Disponible pour l'édition France (Stripe ne propose pas Connect pour les comptes au Maroc).
 *
 * Configuration (propriétés du script, jamais dans le code) :
 *   STRIPE_SECRET_KEY       clé secrète de la plateforme (sk_live_… ou sk_test_…)
 *   STRIPE_WEBHOOK_SECRET   secret de signature du webhook (whsec_…) — à déclarer chez Stripe pour les événements des COMPTES
 *                           CONNECTÉS (checkout.session.completed, account.updated) à l'adresse <adresse>/hooks/stripe
 * Tant que la clé n'est pas renseignée, le mode plateforme est simplement masqué : rien ne change.
 */
var STRIPE_API_ = "https://api.stripe.com/v1";

function stripeConf_() {
  if (TEST_HOOKS_.stripeConfig) return TEST_HOOKS_.stripeConfig;
  const P = PropertiesService.getScriptProperties();
  return { key: String(P.getProperty("STRIPE_SECRET_KEY") || "").trim() };
}
function stripeEnabled_() { return edition_().code === "FR" && !!stripeConf_().key; }

/** Encodage application/x-www-form-urlencoded avec clés imbriquées (a[b][0][c]=…), format attendu par l'API Stripe. */
function stripeForm_(obj, prefix, out) {
  out = out || [];
  Object.keys(obj || {}).forEach(function (k) {
    const v = obj[k], key = prefix ? prefix + "[" + k + "]" : k;
    if (v === undefined || v === null) return;
    if (typeof v === "object") stripeForm_(v, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  });
  return out.join("&");
}
function stripeCall_(method, path, body, idemKey, account) {
  const c = stripeConf_();
  if (!c.key) throw new AppError("PAYMENT", "Stripe n'est pas configuré.");
  const params = { method: method, muteHttpExceptions: true, headers: { Authorization: "Bearer " + c.key } };
  if (idemKey) params.headers["Idempotency-Key"] = idemKey;
  if (account) params.headers["Stripe-Account"] = account; // opération réalisée SUR le compte de l'artisan (paiement direct)
  if (body) { params.contentType = "application/x-www-form-urlencoded"; params.payload = stripeForm_(body); }
  const r = TEST_HOOKS_.stripeFetch ? TEST_HOOKS_.stripeFetch(STRIPE_API_ + path, params) : UrlFetchApp.fetch(STRIPE_API_ + path, params);
  let j = {}; try { j = JSON.parse(r.getContentText() || "{}"); } catch (e) { j = {}; }
  if (r.getResponseCode() >= 300) throw new AppError("PAYMENT", "Stripe a refusé l'opération : " + String((j.error && j.error.message) || ("HTTP " + r.getResponseCode())).slice(0, 200));
  return j;
}
function cents_(amount) { return Math.round(round2_(amount) * 100); }

/* ------------------------------ Artisan : compte de paiement ------------------------------ */
function stripeArtisanOf_(p) {
  const c = myProviderRow_(p);
  assert_(c, "Aucune fiche de référencement liée à votre compte.");
  return c;
}
/** Statut du compte Stripe de l'artisan (relu chez Stripe). */
function providerPayoutInfo_(p) {
  if (!stripeEnabled_()) return { enabled: false };
  const c = stripeArtisanOf_(p);
  if (!c.stripeAccountId) return { enabled: true, connected: false, ready: false };
  const acc = stripeCall_("get", "/accounts/" + encodeURIComponent(c.stripeAccountId));
  const ready = !!(acc.charges_enabled && acc.payouts_enabled);
  if (ready !== bool_(c.stripeReady)) dbUpdate_("Artisans", c.artisanId, { stripeReady: ready, updatedAt: nowIso_() });
  return { enabled: true, connected: true, ready: ready, pending: (acc.requirements && acc.requirements.currently_due || []).length };
}
/** Ouvre (ou reprend) l'inscription de l'artisan chez Stripe : renvoie l'adresse de la page Stripe sécurisée. */
function providerPayoutSetup_(p) {
  assert_(stripeEnabled_(), "Le paiement par la plateforme n'est pas encore disponible.");
  const c = stripeArtisanOf_(p);
  assert_(c.status === "ACTIVE", "Disponible une fois votre référencement validé.");
  let acct = c.stripeAccountId;
  if (!acct) {
    const L = parseJson_(c.legalJson, {}) || {};
    const a = stripeCall_("post", "/accounts", { country: "FR", email: c.email,
      controller: { stripe_dashboard: { type: "full" }, fees: { payer: "account" }, losses: { payments: "stripe" }, requirement_collection: "stripe" },
      business_profile: { name: L.legalName || c.name, product_description: "Travaux et services aux propriétaires (ImmoPilot)" }, metadata: { artisanId: c.artisanId } }, "acct-" + c.artisanId);
    acct = a.id;
    dbUpdate_("Artisans", c.artisanId, { stripeAccountId: acct, stripeReady: false, updatedAt: nowIso_() });
    audit_("STRIPE_ACCOUNT_CREATED", "Artisan", c.artisanId, c.organizationId, {});
  }
  const base = safeAppUrl_() || "";
  const link = stripeCall_("post", "/account_links", { account: acct, type: "account_onboarding", refresh_url: base + "#referencing", return_url: base + "#referencing" });
  return { url: link.url };
}

/* ------------------------------ Commanditaire : payer une facture en ligne ------------------------------ */
function invPlatformInfo_(v, art) {
  if (!stripeEnabled_() || !art || !isPlatformContractor_(art)) return null;
  return { available: !!(art.stripeAccountId && bool_(art.stripeReady)), reason: art.stripeAccountId ? (bool_(art.stripeReady) ? "" : "Le compte de paiement de l'artisan n'est pas encore validé par Stripe.") : "L'artisan n'a pas encore activé le paiement par la plateforme." };
}
function invPayOnline_(p, a) {
  assert_(stripeEnabled_(), "Le paiement par la plateforme n'est pas disponible.");
  const x = invLoad_(p, a.invoiceId);
  assert_(x.manage, "Paiement non autorisé.", "FORBIDDEN");
  const v = x.v, art = dbGet_("Artisans", v.artisanId);
  assert_(["APPROVED", "PARTIAL"].indexOf(v.status) >= 0, "La facture doit être approuvée.");
  assert_(art && isPlatformContractor_(art) && art.stripeAccountId && bool_(art.stripeReady), "Paiement par la plateforme indisponible pour cet artisan.");
  const due = round2_(num_(v.netToContractor || v.amountTTC) - num_(v.paidAmount));
  assert_(due > 0, "Rien à régler.");
  const fee = round2_((num_(v.commissionAmount) + num_(v.commissionVatAmount)) * due / Math.max(0.01, num_(v.amountTTC)));
  const base = safeAppUrl_() || "";
  // Paiement direct sur le compte de l'artisan : il encaisse, la plateforme ne perçoit que sa commission.
  const s = stripeCall_("post", "/checkout/sessions", { mode: "payment", customer_email: p.email,
    line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: cents_(due), product_data: { name: "Facture " + (v.invoiceNumber || "") + " — " + (art.name || "artisan") } } }],
    payment_intent_data: { application_fee_amount: cents_(fee), description: "Facture " + (v.invoiceNumber || v.invoiceId) + " (via ImmoPilot)", metadata: { invoiceId: v.invoiceId } },
    metadata: { invoiceId: v.invoiceId, kind: "INVOICE" }, success_url: base + "#invoice/" + v.invoiceId, cancel_url: base + "#invoice/" + v.invoiceId }, "inv-" + v.invoiceId + "-" + cents_(due) + "-" + todayStr_(), art.stripeAccountId);
  audit_("INVOICE_ONLINE_PAYMENT_STARTED", "Invoice", v.invoiceId, v.organizationId, { amount: due, fee: fee });
  return { url: s.url };
}

/** Webhook Stripe (signature vérifiée par le serveur avant l'appel) : paiement de facture confirmé, compte d'artisan mis à jour. */
function stripeWebhook(event) {
  ctxReset_(); dbReset_(); LOCK_DEPTH_ = 0; dbcBegin_("request");
  try { return stripeWebhookApply_(event); } finally { dbcCommit_(); }
}
function stripeWebhookApply_(ev) {
  const o = (ev && ev.data && ev.data.object) || {};
  if (ev.type === "account.updated" && o.id) {
    const art = dbAll_("Artisans").find(function (a) { return a.stripeAccountId === o.id; });
    if (art) dbUpdate_("Artisans", art.artisanId, { stripeReady: !!(o.charges_enabled && o.payouts_enabled), updatedAt: nowIso_() });
    return { ok: true };
  }
  if (ev.type !== "checkout.session.completed" || o.payment_status !== "paid" || !(o.metadata && o.metadata.invoiceId)) return { ok: true, ignored: true };
  const v = dbGet_("Invoices", String(o.metadata.invoiceId)); if (!v) return { ok: false };
  const artv = dbGet_("Artisans", v.artisanId);
  if (ev.account && artv && artv.stripeAccountId && ev.account !== artv.stripeAccountId) return { ok: false, reason: "compte inattendu" };
  return withLock_(function () {
    if (dbAll_("Payments").some(function (z) { return z.refType === "INVOICE" && z.reference === "Stripe " + o.id; })) return { ok: true, duplicate: true };
    const amount = round2_(Number(o.amount_total || 0) / 100);
    const pay = dbInsert_("Payments", { organizationId: v.organizationId, propertyId: v.propertyId, kind: "INVOICE", refType: "INVOICE", refId: v.invoiceId, direction: "OUT", amount: amount, currency: v.currency || cur_(),
      method: "STRIPE", paidAt: todayStr_(), reference: "Stripe " + o.id, proofDocId: "", status: "RECORDED", reconciled: true, note: "Paiement en ligne par la plateforme (Stripe Connect)", recordedBy: "stripe", createdAt: nowIso_() });
    paymentRefresh_(pay);
    auditAs_("stripe", "", "INVOICE_PAID_ONLINE", "Invoice", v.invoiceId, v.organizationId, { amount: amount, session: o.id });
    const art = dbGet_("Artisans", v.artisanId);
    if (art && art.userId) notify_({ eventKey: "invoice-paid-online:" + v.invoiceId, userIds: [art.userId], type: "INVOICE_PAID", organizationId: v.organizationId, title: "Facture payée en ligne : " + v.invoiceNumber,
      body: amount + " " + (v.currency || cur_()) + " réglés par le client ; Stripe vous verse le montant, commission ImmoPilot déduite.", link: "#invoices" });
    return { ok: true, paymentId: pay.paymentId };
  });
}
