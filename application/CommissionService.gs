/**
 * Commissions de mise en relation (artisans référencés par la plateforme ECO SYNERGY).
 *
 * Taux (réglables par le super administrateur, Paramètres de la plateforme) :
 *  - commission.contractorRate : commission à la charge de l'ARTISAN, en % du HT de sa facture (15 % par défaut) ;
 *  - commission.clientRate     : commission à la charge du COMMANDITAIRE (propriétaire ou agence), en % du HT (6 % par défaut) ;
 *  - commission.vatRate        : TVA appliquée aux commissions.
 * Les deux commissions rémunèrent le service de mise en relation et reviennent entièrement à la plateforme.
 *
 * Deux façons de régler l'artisan :
 *  1. Paiement par la plateforme (Stripe Connect, France) : le client paie en ligne ; Stripe verse directement l'artisan et
 *     retient la commission artisan pour la plateforme (Stripe est l'établissement de paiement agréé : ECO SYNERGY ne détient pas les fonds).
 *  2. Paiement direct (virement, chèque) ou en espèces : l'artisan reçoit la totalité ; dès que le commanditaire marque la facture
 *     « réglée », la commission artisan devient due et un lien de paiement SumUp lui est envoyé (relances à 7, 14 et 21 jours).
 * Dans les deux cas, la commission du commanditaire s'ajoute à son récapitulatif MENSUEL, envoyé le 1er du mois (PDF) et prélevé sur
 * la carte enregistrée pour son abonnement (à défaut : lien de paiement SumUp).
 */
var COMMISSION_REMINDER_DAYS_ = 7, COMMISSION_MAX_REMINDERS_ = 3;

function commissionRates_() {
  const n = function (k, d) { const v = Number(getSetting_(k)); return isFinite(v) && v >= 0 ? v : d; };
  return { artisan: n("commission.contractorRate", 15), client: n("commission.clientRate", 6), vat: n("commission.vatRate", 20) };
}
function feeOut_(f) {
  const art = dbGet_("Artisans", f.artisanId) || {}, org = dbGet_("Organizations", f.organizationId) || {}, inv = dbGet_("Invoices", f.invoiceId) || {}, prop = dbGet_("Properties", f.propertyId) || {};
  return { feeId: f.feeId, kind: f.kind, status: f.status, payMode: f.payMode, artisanId: f.artisanId, artisanName: art.name || "", organizationId: f.organizationId, organizationName: org.name || "",
    invoiceId: f.invoiceId, invoiceNumber: inv.invoiceNumber || "", propertyName: prop.name || "", baseHT: f.baseHT, rate: f.rate, amount: f.amount, vatAmount: f.vatAmount, total: f.total,
    currency: f.currency || cur_(), payUrl: f.status === "LINK_SENT" ? f.payUrl || "" : "", createdAt: f.createdAt, paidAt: f.paidAt || "", period: f.period || "", statementId: f.statementId || "", reminders: Number(f.reminders) || 0 };
}
function statementOut_(s) {
  return { statementId: s.statementId, organizationId: s.organizationId, organizationName: ((dbGet_("Organizations", s.organizationId) || {}).name) || "", period: s.period, count: s.count,
    totalHT: s.totalHT, vatAmount: s.vatAmount, total: s.total, currency: s.currency || cur_(), status: s.status, payUrl: s.status === "LINK_SENT" ? s.payUrl || "" : "", paidAt: s.paidAt || "",
    lastError: s.lastError || "", createdAt: s.createdAt };
}

/** Facture d'un artisan de la plateforme soldée : création des deux commissions (une seule fois par facture). */
function commissionOnInvoicePaid_(invoiceId) {
  const v = dbGet_("Invoices", invoiceId); if (!v || v.status !== "PAID") return null;
  const art = dbGet_("Artisans", v.artisanId); if (!art || !isPlatformContractor_(art)) return null;
  if (dbAll_("PlatformFees").some(function (f) { return String(f.invoiceId) === String(invoiceId) && f.status !== "CANCELLED"; })) return null;
  const pays = dbAll_("Payments").filter(function (z) { return z.refType === "INVOICE" && String(z.refId) === String(invoiceId) && z.status === "RECORDED"; });
  const mode = pays.some(function (z) { return z.method === "STRIPE"; }) ? "PLATFORM" : pays.some(function (z) { return z.method === "CASH"; }) ? "CASH" : "DIRECT";
  const R = commissionRates_(), w = dbGet_("WorkOrders", v.workOrderId) || { createdBy: "" }, prop = dbGet_("Properties", v.propertyId) || {};
  const client = commissionBeneficiary_(w, prop), ht = round2_(num_(v.amountHT)), period = todayStr_().slice(0, 7);
  const base = { invoiceId: v.invoiceId, workOrderId: v.workOrderId, artisanId: v.artisanId, propertyId: v.propertyId, organizationId: client, baseHT: ht, currency: v.currency || cur_(), payMode: mode, createdAt: nowIso_(), period: period };
  const aAmt = round2_(num_(v.commissionAmount)), aVat = round2_(num_(v.commissionVatAmount));
  const fa = dbInsert_("PlatformFees", Object.assign({}, base, { kind: "ARTISAN", rate: num_(v.commissionRate), amount: aAmt, vatAmount: aVat, total: round2_(aAmt + aVat),
    status: mode === "PLATFORM" ? "DEDUCTED" : "DUE", paidAt: mode === "PLATFORM" ? nowIso_() : "", reminders: 0 }));
  const cAmt = round2_(ht * R.client / 100), cVat = round2_(cAmt * R.vat / 100);
  if (cAmt > 0) dbInsert_("PlatformFees", Object.assign({}, base, { kind: "CLIENT", rate: R.client, amount: cAmt, vatAmount: cVat, total: round2_(cAmt + cVat), status: "PENDING", reminders: 0 }));
  audit_("COMMISSION_CREATED", "Invoice", v.invoiceId, v.organizationId, { mode: mode, artisan: fa.total, client: round2_(cAmt + cVat) });
  if (fa.status === "DUE") { try { commissionSendArtisanLink_(fa, false); } catch (e) { console.error("Lien de commission : " + e.message); } }
  return { mode: mode };
}

/** Lien de paiement SumUp (page de paiement hébergée par SumUp). Renvoie { id, url } ou lève une erreur lisible. */
function sumupPayLink_(ref, localAmount, description) {
  assert_(sumupEnabled_(), "SumUp n'est pas configuré : lien de paiement impossible.", "PAYMENT");
  const c = sumupConf_(), amt = sumupAmount_(localAmount);
  const co = sumupCall_("post", "/checkouts", { checkout_reference: ref, amount: amt.amount, currency: amt.currency, merchant_code: c.merchant, description: String(description).slice(0, 120),
    hosted_checkout: { enabled: true }, redirect_url: safeAppUrl_() || undefined }).body;
  const url = co.hosted_checkout_url || (co.hosted_checkout && co.hosted_checkout.url) || "";
  assert_(co.id && url, "SumUp n'a pas renvoyé de lien de paiement (option « Hosted Checkout » à activer sur le compte SumUp).", "PAYMENT");
  return { id: co.id, url: url, amount: amt.amount, currency: amt.currency };
}

/** Envoie (ou renvoie) à l'artisan le lien de paiement de sa commission. */
function commissionSendArtisanLink_(f, reminder) {
  const art = dbGet_("Artisans", f.artisanId) || {}, inv = dbGet_("Invoices", f.invoiceId) || {};
  let link = null, err = "";
  try { link = sumupPayLink_("COM-" + String(f.feeId).slice(-20) + "-" + ((Number(f.reminders) || 0) + 1), f.total, "Commission ImmoPilot - facture " + (inv.invoiceNumber || "")); }
  catch (e) { err = e.message; }
  dbUpdate_("PlatformFees", f.feeId, link ? { status: "LINK_SENT", checkoutId: link.id, payUrl: link.url, linkSentAt: nowIso_(), reminders: reminder ? (Number(f.reminders) || 0) + 1 : Number(f.reminders) || 0, note: "", updatedAt: nowIso_() }
    : { note: err.slice(0, 300), updatedAt: nowIso_() });
  if (!art.email) return { ok: !!link };
  const body = "Bonjour,\n\n" + (reminder ? "Rappel : " : "") + "votre client a réglé la facture n° " + (inv.invoiceNumber || "") + " (" + round2_(num_(inv.amountTTC)) + " " + f.currency + " TTC) en dehors de la plateforme." +
    "\n\nCommission ImmoPilot de mise en relation (" + f.rate + " % du HT de " + f.baseHT + " " + f.currency + ") : " + f.amount + " " + f.currency + " HT + TVA " + f.vatAmount + " = " + f.total + " " + f.currency + "." +
    (link ? "\n\nRéglez-la en ligne, par carte (paiement sécurisé SumUp) :\n" + link.url : "\n\nLe lien de paiement vous sera envoyé très prochainement.") +
    "\n\nMerci de la régler sous " + COMMISSION_REMINDER_DAYS_ + " jours. Au-delà de trois rappels sans règlement, votre référencement peut être suspendu (conditions de référencement).\n\nImmoPilot";
  sendMailSafe_(art.email, (reminder ? "Rappel — " : "") + "Commission ImmoPilot à régler : " + f.total + " " + f.currency, body, "commission:" + f.feeId + ":" + ((Number(f.reminders) || 0) + (reminder ? 1 : 0)));
  if (art.userId) notify_({ eventKey: "commission-due:" + f.feeId + ":" + (Number(f.reminders) || 0), userIds: [art.userId], type: "COMMISSION_DUE", organizationId: "", email: false,
    title: "Commission à régler : " + f.total + " " + f.currency, body: "Facture " + (inv.invoiceNumber || "") + (link ? " — lien de paiement envoyé par e-mail." : ""), link: "#referencing" });
  return { ok: !!link, error: err };
}

/** Paiements en ligne : relit chez SumUp les liens en attente (commissions artisans et récapitulatifs mensuels). */
function commissionCheckPayments_() {
  if (!sumupEnabled_()) return { skipped: "SumUp non configuré" };
  let paid = 0;
  const check = function (id) { try { const co = sumupCall_("get", "/checkouts/" + encodeURIComponent(id), null, [404]).body; return String(co.status) === "PAID" ? co : null; } catch (e) { return null; } };
  dbAll_("PlatformFees").filter(function (f) { return f.status === "LINK_SENT" && f.checkoutId; }).forEach(function (f) {
    const co = check(f.checkoutId); if (!co) return;
    dbUpdate_("PlatformFees", f.feeId, { status: "PAID", paidAt: nowIso_(), paidRef: "SumUp " + (co.transaction_code || co.id), updatedAt: nowIso_() }); paid++;
    audit_("COMMISSION_PAID", "PlatformFee", f.feeId, "", { total: f.total, via: "SUMUP_LINK" });
  });
  dbAll_("CommissionStatements").filter(function (s) { return s.status === "LINK_SENT" && s.checkoutId; }).forEach(function (s) {
    const co = check(s.checkoutId); if (!co) return;
    commissionStatementPaid_(s, "SumUp " + (co.transaction_code || co.id)); paid++;
  });
  return { paid: paid };
}
function commissionStatementPaid_(s, ref) {
  dbUpdate_("CommissionStatements", s.statementId, { status: "PAID", paidAt: nowIso_(), paidRef: ref, lastError: "", updatedAt: nowIso_() });
  dbAll_("PlatformFees").filter(function (f) { return String(f.statementId) === String(s.statementId); }).forEach(function (f) { dbUpdate_("PlatformFees", f.feeId, { status: "PAID", paidAt: nowIso_(), paidRef: ref, updatedAt: nowIso_() }); });
  audit_("COMMISSION_STATEMENT_PAID", "CommissionStatement", s.statementId, s.organizationId, { total: s.total, ref: ref });
}

/** Chaque jour : relances des commissions d'artisans impayées, et récapitulatifs mensuels des commanditaires (à partir du 1er). */
function commissionDailyJob_() {
  const out = { reminded: 0, statements: 0 }, now = Date.now();
  dbAll_("PlatformFees").filter(function (f) { return f.kind === "ARTISAN" && (f.status === "LINK_SENT" || f.status === "DUE"); }).forEach(function (f) {
    const last = parseTs_(f.linkSentAt || f.createdAt);
    if (!last || now - last.getTime() < COMMISSION_REMINDER_DAYS_ * 86400000) return;
    if ((Number(f.reminders) || 0) >= COMMISSION_MAX_REMINDERS_) {
      try { notify_({ eventKey: "commission-overdue:" + f.feeId, userIds: superAdminIds_(), type: "COMMISSION_DUE", organizationId: "", title: "Commission impayée après 3 rappels",
        body: ((dbGet_("Artisans", f.artisanId) || {}).name || "") + " · " + f.total + " " + (f.currency || cur_()), link: "#commissions" }); } catch (e) { /* sans gravité */ }
      return;
    }
    try { commissionSendArtisanLink_(f, true); out.reminded++; } catch (e) { console.error(e.message); }
  });
  try { out.statements = commissionMonthly_(false).created; } catch (e) { console.error("Récapitulatifs : " + e.message); }
  return out;
}
function prevPeriod_(today) { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); }

/** Récapitulatifs du mois précédent (ou de toutes les commissions en attente si force) : un par commanditaire, PDF, prélèvement. */
function commissionMonthly_(force) {
  const period = prevPeriod_(todayStr_());
  const pending = dbAll_("PlatformFees").filter(function (f) { return f.kind === "CLIENT" && f.status === "PENDING" && (force || String(f.period) <= period); });
  const byOrg = {};
  pending.forEach(function (f) { (byOrg[String(f.organizationId)] = byOrg[String(f.organizationId)] || []).push(f); });
  let created = 0;
  Object.keys(byOrg).forEach(function (orgId) {
    const fees = byOrg[orgId];
    const s = withLock_(function () {
      const fresh = fees.filter(function (f) { const x = dbGet_("PlatformFees", f.feeId); return x && x.status === "PENDING"; });
      if (!fresh.length) return null;
      const totalHT = round2_(sumBy_(fresh, function (f) { return f.amount; })), vat = round2_(sumBy_(fresh, function (f) { return f.vatAmount; }));
      const st = dbInsert_("CommissionStatements", { organizationId: orgId, period: force ? todayStr_().slice(0, 7) : period, count: fresh.length, totalHT: totalHT, vatAmount: vat, total: round2_(totalHT + vat),
        currency: fresh[0].currency || cur_(), status: "DUE", createdAt: nowIso_(), attempts: 0 });
      fresh.forEach(function (f) { dbUpdate_("PlatformFees", f.feeId, { status: "BILLED", statementId: st.statementId, updatedAt: nowIso_() }); });
      return st;
    });
    if (!s) return;
    created++;
    try { commissionCollectStatement_(s, true); } catch (e) { console.error("Récapitulatif " + s.statementId + " : " + e.message); }
  });
  return { created: created, period: period };
}

/** Récapitulatif PDF : missions de la période, base HT, taux, commission. */
function commissionStatementHtml_(s) {
  const org = dbGet_("Organizations", s.organizationId) || {}, v = legalValues_();
  const fees = dbAll_("PlatformFees").filter(function (f) { return String(f.statementId) === String(s.statementId); });
  const rows = fees.map(function (f) {
    const inv = dbGet_("Invoices", f.invoiceId) || {}, wo = dbGet_("WorkOrders", f.workOrderId) || {}, prop = dbGet_("Properties", f.propertyId) || {}, art = dbGet_("Artisans", f.artisanId) || {};
    return [pdfDate_(inv.paidAt || f.createdAt), prop.name || "", wo.title || "", art.name || "", inv.invoiceNumber || "", f.baseHT + " " + f.currency, f.rate + " %", f.amount + " " + f.currency];
  });
  const inner = "<table class='head'><tr><td><b>" + escapeHtml_(v.publisherName || "ECO SYNERGY") + "</b><br><span class='muted'>" + escapeHtml_(v.address || "") + "<br>" + escapeHtml_(v.registration || "") + (v.vatNumber ? "<br>TVA " + escapeHtml_(v.vatNumber) : "") + "</span></td>" +
    "<td class='right'><b>" + escapeHtml_(org.name || "") + "</b><br><span class='muted'>" + escapeHtml_(org.address || "") + "<br>" + escapeHtml_(org.billingEmail || "") + "</span></td></tr></table>" +
    "<h2>Missions de la période " + escapeHtml_(s.period) + "</h2>" + htmlTable_(["Réglée le", "Bien", "Mission", "Artisan", "Facture", "Base HT", "Taux", "Commission HT"], rows) +
    "<table style='width:45%;margin:12px 0 0 auto'><tr><th>Total HT</th><td class='right'>" + s.totalHT + " " + s.currency + "</td></tr><tr><th>TVA</th><td class='right'>" + s.vatAmount + " " + s.currency + "</td></tr>" +
    "<tr><th>Total TTC</th><td class='right'><b>" + s.total + " " + s.currency + "</b></td></tr></table>" +
    "<div class='box'>Commission de mise en relation due par le commanditaire sur les missions réalisées par les artisans référencés sur ImmoPilot et réglées au cours de la période " +
    "(conditions générales, article « Mise en relation »). Règlement : prélèvement sur la carte enregistrée pour l'abonnement, ou lien de paiement en ligne.</div>";
  return pdfShell_("Récapitulatif mensuel des commissions", inner, { subtitle: org.name + " — " + s.period, ref: "COM-" + String(s.period).replace("-", "") + "-" + String(s.statementId).slice(-6).toUpperCase() });
}
function commissionStatementBlob_(s) { return htmlToPdf_(commissionStatementHtml_(s), "Commissions_" + s.period + "_" + String((dbGet_("Organizations", s.organizationId) || {}).name || "client").replace(/[^\wÀ-ÿ]+/g, "_")); }

/** Prélève le récapitulatif sur la carte de l'abonnement ; sinon envoie un lien de paiement. Envoie le PDF par e-mail. */
function commissionCollectStatement_(s, sendMail) {
  s = dbGet_("CommissionStatements", s.statementId);
  if (!s || s.status === "PAID") return { ok: true, already: true };
  const org = dbGet_("Organizations", s.organizationId) || {}, card = sumupEnabled_() ? sumupCardOf_(s.organizationId) : null;
  let charged = false, link = null, err = "";
  const ref = "CST-" + String(s.statementId).slice(-20) + "-" + ((Number(s.attempts) || 0) + 1);
  if (card) {
    try {
      const c = sumupConf_(), amt = sumupAmount_(s.total);
      const co = sumupCall_("post", "/checkouts", { checkout_reference: ref, amount: amt.amount, currency: amt.currency, merchant_code: c.merchant, customer_id: card.customerId, description: ("ImmoPilot : commissions " + s.period).slice(0, 120) }).body;
      const res = sumupCall_("put", "/checkouts/" + encodeURIComponent(co.id), { payment_type: "card", token: card.token, customer_id: card.customerId }).body;
      if (String(res.status) === "PAID") charged = true; else err = String(res.message || res.status || "refusé");
      if (charged) commissionStatementPaid_(s, "SumUp " + (((res.transactions || [])[0] || {}).transaction_code || co.id));
    } catch (e) { err = e.message; }
  }
  if (!charged) {
    try { link = sumupPayLink_(ref + "L", s.total, "ImmoPilot : commissions " + s.period); } catch (e) { err = err || e.message; }
    dbUpdate_("CommissionStatements", s.statementId, { status: link ? "LINK_SENT" : "DUE", checkoutId: link ? link.id : "", payUrl: link ? link.url : "", attempts: (Number(s.attempts) || 0) + 1, lastError: String(err || "").slice(0, 300), updatedAt: nowIso_() });
  }
  if (sendMail && org.billingEmail) {
    const body = "Bonjour,\n\nVeuillez trouver ci-joint votre récapitulatif des commissions de mise en relation ImmoPilot pour " + s.period + " : " + s.count + " mission(s), " + s.total + " " + s.currency + " TTC." +
      (charged ? "\n\nLe montant a été prélevé sur votre carte " + card.label + "." : link ? "\n\nRéglez-le en ligne (paiement sécurisé SumUp) :\n" + link.url : "\n\nLes modalités de règlement vous seront communiquées.") + "\n\nImmoPilot";
    let blob = null; try { blob = commissionStatementBlob_(dbGet_("CommissionStatements", s.statementId)); } catch (e) { console.error(e.message); }
    sendMailSafe_(org.billingEmail, "Récapitulatif des commissions ImmoPilot — " + s.period, body, "statement:" + s.statementId + ":" + (Number(s.attempts) || 0), s.organizationId, blob ? { attachments: [blob] } : {});
  }
  return { ok: charged || !!link, charged: charged, link: link ? link.url : "", error: err };
}

/* ------------------------------ Routes ------------------------------ */
/** Artisan : ses commissions. */
function commissionMine_(p) {
  const c = myProviderRow_(p) || dbAll_("Artisans").find(function (a) { return String(a.userId) === p.userId && isPlatformContractor_(a); });
  if (!c) return { fees: [], rates: commissionRates_() };
  return { fees: dbAll_("PlatformFees").filter(function (f) { return f.kind === "ARTISAN" && String(f.artisanId) === String(c.artisanId); })
    .sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); }).map(feeOut_), rates: commissionRates_() };
}
/** Commanditaire : ses récapitulatifs mensuels et les commissions du mois en cours. */
function commissionStatements_(p) {
  const orgIds = memberOrgIds_(p).filter(function (o) { return hasOrgCap_(p, o, "settings.manage") || hasOrgCap_(p, o, "finance.view"); });
  return { rates: commissionRates_(),
    statements: dbAll_("CommissionStatements").filter(function (s) { return orgIds.indexOf(String(s.organizationId)) >= 0; }).sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); }).map(statementOut_),
    pending: dbAll_("PlatformFees").filter(function (f) { return f.kind === "CLIENT" && f.status === "PENDING" && orgIds.indexOf(String(f.organizationId)) >= 0; }).map(feeOut_) };
}
function commissionStatementPdf_(p, a) {
  const s = dbGet_("CommissionStatements", safeText_(a.statementId, 120));
  assert_(s, "Récapitulatif introuvable.");
  if (!p.isSuper && !hasOrgCap_(p, s.organizationId, "settings.manage") && !hasOrgCap_(p, s.organizationId, "finance.view")) forbid_("Accès refusé.");
  const blob = commissionStatementBlob_(s);
  return { fileName: blob.getName(), mimeType: "application/pdf", base64: Utilities.base64Encode(blob.getBytes()) };
}
/** Super administrateur : toutes les commissions. */
function commissionAdminList_(p, a) {
  requireSuper_(p); a = a || {};
  const fees = dbAll_("PlatformFees").filter(function (f) { return (!a.kind || f.kind === a.kind) && (!a.status || String(a.status).split(",").indexOf(f.status) >= 0); })
    .sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); });
  const all = dbAll_("PlatformFees").filter(function (f) { return f.status !== "CANCELLED"; });
  const sum = function (fn) { return round2_(sumBy_(all.filter(fn), function (f) { return f.total; })); };
  return { fees: fees.slice(0, 500).map(feeOut_), statements: dbAll_("CommissionStatements").sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); }).slice(0, 300).map(statementOut_),
    totals: { earned: sum(function (f) { return ["PAID", "DEDUCTED"].indexOf(f.status) >= 0; }), artisanDue: sum(function (f) { return f.kind === "ARTISAN" && ["DUE", "LINK_SENT"].indexOf(f.status) >= 0; }),
      clientPending: sum(function (f) { return f.kind === "CLIENT" && ["PENDING", "BILLED"].indexOf(f.status) >= 0; }) }, rates: commissionRates_(), sumup: sumupEnabled_(), stripe: stripeEnabled_() };
}
function commissionResend_(p, a) {
  requireSuper_(p);
  if (a.statementId) { const s = dbGet_("CommissionStatements", safeText_(a.statementId, 120)); assert_(s && s.status !== "PAID", "Récapitulatif introuvable ou déjà réglé."); return commissionCollectStatement_(s, true); }
  const f = dbGet_("PlatformFees", safeText_(a.feeId, 120));
  assert_(f && f.kind === "ARTISAN" && ["DUE", "LINK_SENT"].indexOf(f.status) >= 0, "Commission introuvable ou déjà réglée.");
  return commissionSendArtisanLink_(f, true);
}
function commissionMarkPaid_(p, a) {
  requireSuper_(p);
  const ref = reqText_(a.reference, "Référence du règlement (virement, espèces…)", 2, 120);
  if (a.statementId) { const s = dbGet_("CommissionStatements", safeText_(a.statementId, 120)); assert_(s && s.status !== "PAID", "Récapitulatif introuvable ou déjà réglé."); commissionStatementPaid_(s, ref); return { ok: true }; }
  const f = dbGet_("PlatformFees", safeText_(a.feeId, 120));
  assert_(f && ["DUE", "LINK_SENT", "PENDING"].indexOf(f.status) >= 0, "Commission introuvable ou déjà réglée.");
  dbUpdate_("PlatformFees", f.feeId, { status: "PAID", paidAt: nowIso_(), paidRef: ref, updatedAt: nowIso_() });
  audit_("COMMISSION_PAID", "PlatformFee", f.feeId, "", { total: f.total, via: "MANUAL", ref: ref });
  return { ok: true };
}
function commissionCancel_(p, a) {
  requireSuper_(p);
  const f = dbGet_("PlatformFees", safeText_(a.feeId, 120));
  assert_(f && ["DUE", "LINK_SENT", "PENDING"].indexOf(f.status) >= 0, "Commission introuvable ou déjà réglée.");
  dbUpdate_("PlatformFees", f.feeId, { status: "CANCELLED", note: reqText_(a.reason, "Motif", 3, 300), updatedAt: nowIso_() });
  audit_("COMMISSION_CANCELLED", "PlatformFee", f.feeId, "", {});
  return { ok: true };
}
function commissionRunMonthly_(p) { requireSuper_(p); return commissionMonthly_(true); }
