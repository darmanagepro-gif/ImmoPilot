/**
 * Abonnements et forfaits (Essentiel / Pro / Business, entièrement configurables par le super administrateur).
 * AUCUN paiement en ligne n'est simulé : les règlements d'abonnement sont enregistrés MANUELLEMENT (virement, espèces…)
 * avec référence/justificatif. L'adaptateur PAYMENT_PROVIDERS_ permet de brancher plus tard un prestataire (CMI, Stripe, PayPal…).
 *
 * Cycle : TRIAL → (fin d'essai) PAST_DUE → (paiement) ACTIVE → (échéance non payée) PAST_DUE → (+15 j) SUSPENDED (lecture seule)
 *         ACTIVE + annulation en fin de période → EXPIRED ; CANCELLED (remplacé ou annulé immédiatement).
 */
var SUB_GRACE_DAYS_ = 15;
var PERIOD_MONTHS_ = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

/**
 * Adaptateur de prestataire de paiement. Pour ajouter un prestataire :
 *  1. créer une entrée { name, createCheckout(subscription, plan) → {url}, verifyNotification(e) → {subscriptionId, amount, reference} } ;
 *  2. stocker ses secrets dans les Propriétés du script (jamais dans le code client) ;
 *  3. exposer un doPost(e) qui appelle verifyNotification puis subApplyPayment_() — non fourni tant qu'aucun prestataire réel n'est choisi.
 */
var PAYMENT_PROVIDERS_ = {
  MANUAL: {
    name: "Paiement manuel (virement, espèces, chèque)",
    createCheckout: function () { throw new AppError("PAYMENT", "Aucun prestataire de paiement en ligne n'est configuré. Réglez par virement puis transmettez le justificatif à l'administrateur."); },
    verifyNotification: function () { throw new AppError("PAYMENT", "Aucune notification de paiement automatique n'est prise en charge."); }
  }
};

function planOut_(pl) {
  return { planCode: pl.planCode, name: pl.name, price: pl.price, currency: pl.currency || "MAD", periodicity: pl.periodicity, maxProperties: pl.maxProperties, maxUsers: pl.maxUsers, storageMb: pl.storageMb,
    features: parseJson_(pl.featuresJson, []), quotas: parseJson_(pl.quotasJson, {}), trialDays: pl.trialDays, status: pl.status, sortOrder: pl.sortOrder, agencyOptionPrice: num_(pl.agencyOptionPrice) };
}
function subOut_(s, orgs) {
  const today = todayStr_();
  return { subscriptionId: s.subscriptionId, organizationId: s.organizationId, organizationName: ((orgs || {})[String(s.organizationId)] || {}).name || "", planCode: s.planCode, status: s.status,
    startDate: s.startDate, trialEnd: s.trialEnd, periodEnd: s.periodEnd, nextDueDate: s.nextDueDate, paidThrough: s.paidThrough, price: s.price, currency: s.currency || "MAD", periodicity: s.periodicity,
    cancelAtPeriodEnd: bool_(s.cancelAtPeriodEnd), daysOverdue: s.status === "PAST_DUE" || s.status === "SUSPENDED" ? Math.max(0, diffDays_(s.nextDueDate || today, today)) : 0, createdAt: s.createdAt,
    agencyOption: subAgencyOption_(s) };
}
/** Option agences : agences créées par le propriétaire, facturées sur SON abonnement (prix par agence et par période). */
function subAgencyOption_(s) {
  const agencies = managedAgencies_(s.organizationId), unit = num_(s.agencyOptionPrice);
  return { count: agencies.length, unitPrice: unit, amount: round2_(unit * agencies.length), agencies: agencies.map(function (o) { return o.name; }),
    totalPrice: round2_(num_(s.price) + unit * agencies.length) };
}
function subUsage_(orgId) {
  return { properties: dbAll_("Properties").filter(function (x) { return String(x.organizationId) === String(orgId) && ["ARCHIVED", "DELETED"].indexOf(x.status) < 0; }).length,
    users: dbAll_("UserRoles").filter(function (r) { return String(r.organizationId) === String(orgId) && r.status === "ACTIVE"; }).length,
    storageMb: round2_(sumBy_(dbAll_("Documents").filter(function (d) { return String(d.organizationId) === String(orgId) && d.status === "ACTIVE"; }), function (d) { return d.sizeBytes; }) / 1048576) };
}

/* ------------------------------ Forfaits ------------------------------ */
function planList_(p, a) {
  return dbAll_("SubscriptionPlans").filter(function (pl) { return p.isSuper || pl.status === "ACTIVE"; }).sort(function (x, y) { return num_(x.sortOrder) - num_(y.sortOrder); }).map(planOut_);
}
var PLAN_FEATURES_ = ["properties", "reservations", "checkin", "cleaning", "incidents", "finance_basic", "finance_advanced", "leases", "contractors", "pareto", "reports", "automations", "guest_portal", "multi_agency", "exports_unlimited"];
function planSave_(p, a) {
  requireSuper_(p);
  const code = safeText_(a.planCode, 30).toUpperCase().replace(/[^A-Z0-9_]/g, "");
  assert_(code.length >= 2, "Code de forfait invalide.");
  const data = { name: reqText_(a.name, "Nom", 2, 60), price: money_(a.price, "Prix"), currency: "MAD", periodicity: oneOf_(a.periodicity || "MONTHLY", Object.keys(PERIOD_MONTHS_), "Périodicité"),
    maxProperties: Math.max(0, parseInt(a.maxProperties, 10) || 0), maxUsers: Math.max(0, parseInt(a.maxUsers, 10) || 0), storageMb: Math.max(0, parseInt(a.storageMb, 10) || 0),
    featuresJson: (Array.isArray(a.features) ? a.features : []).filter(function (f) { return PLAN_FEATURES_.indexOf(f) >= 0; }), quotasJson: { exportRows: Math.min(Math.max(parseInt((a.quotas || {}).exportRows, 10) || 1000, 100), IMMO_CONFIG.MAX_EXPORT_ROWS) },
    trialDays: Math.max(0, parseInt(a.trialDays, 10) || 0), agencyOptionPrice: a.agencyOptionPrice === "" || a.agencyOptionPrice == null ? 0 : money_(a.agencyOptionPrice, "Option agences"), status: oneOf_(a.status || "ACTIVE", ["ACTIVE", "RETIRED"], "Statut"), sortOrder: parseInt(a.sortOrder, 10) || 9, updatedAt: nowIso_(), updatedBy: p.email };
  if (dbGet_("SubscriptionPlans", code)) dbUpdate_("SubscriptionPlans", code, data); else dbInsert_("SubscriptionPlans", Object.assign({ planCode: code }, data));
  audit_("PLAN_SAVED", "SubscriptionPlan", code, "", { price: data.price, features: data.featuresJson.length });
  return { ok: true, planCode: code };
}

/* ------------------------------ Abonnements ------------------------------ */
function subAssign_(p, a) {
  requireSuper_(p);
  const orgId = safeText_(a.organizationId, 120), org = dbGet_("Organizations", orgId);
  assert_(org && org.type !== "PLATFORM", "Organisation cliente introuvable.");
  const parent = agencyBillingParent_(org);
  if (parent) throw new AppError("VALIDATION", "Cette agence a été créée par un propriétaire : elle n'a pas d'abonnement propre, elle est facturée en option sur l'abonnement de « " + ((dbGet_("Organizations", parent) || {}).name || parent) + " ».");
  const plan = dbGet_("SubscriptionPlans", safeText_(a.planCode, 30));
  assert_(plan && plan.status === "ACTIVE", "Forfait introuvable ou retiré.");
  const start = a.startDate ? dateOnly_(a.startDate, "Date de début") : todayStr_();
  const trial = a.trial === true && Number(plan.trialDays) > 0;
  return withLock_(function () {
    dbAll_("Subscriptions").filter(function (s) { return String(s.organizationId) === orgId && ["CANCELLED", "EXPIRED"].indexOf(s.status) < 0; })
      .forEach(function (s) { dbUpdate_("Subscriptions", s.subscriptionId, { status: "CANCELLED", canceledAt: nowIso_(), updatedAt: nowIso_(), updatedBy: p.email }); });
    const trialEnd = trial ? addDaysStr_(start, Number(plan.trialDays)) : "";
    const s = dbInsert_("Subscriptions", { organizationId: orgId, planCode: plan.planCode, status: trial ? "TRIAL" : "PAST_DUE", startDate: start, nextDueDate: trial ? trialEnd : start, periodEnd: trial ? trialEnd : start,
      trialEnd: trialEnd, price: plan.price, agencyOptionPrice: num_(plan.agencyOptionPrice), currency: plan.currency || "MAD", periodicity: plan.periodicity, cancelAtPeriodEnd: false, createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_(), updatedBy: p.email });
    dbUpdate_("Organizations", orgId, { planCode: plan.planCode, updatedAt: nowIso_() });
    audit_("SUBSCRIPTION_ASSIGNED", "Subscription", s.subscriptionId, orgId, { planCode: plan.planCode, trial: trial });
    return { ok: true, subscriptionId: s.subscriptionId, status: s.status, note: trial ? "" : "En attente du premier paiement (enregistrez-le pour activer)." };
  });
}
/** Applique un paiement d'abonnement (manuel aujourd'hui, prestataire demain) et prolonge la période. */
function subApplyPayment_(s, amount, paidAt, method, reference, proofDocId, periods, actorEmail) {
  const months = (PERIOD_MONTHS_[s.periodicity] || 1) * periods;
  const today = todayStr_();
  const base = s.status === "ACTIVE" && s.periodEnd && s.periodEnd >= today ? s.periodEnd : today;
  const newEnd = addMonthsStr_(base, months);
  const pay = dbInsert_("Payments", { organizationId: s.organizationId, propertyId: "", kind: "SUBSCRIPTION", refType: "SUBSCRIPTION", refId: s.subscriptionId, direction: "IN", amount: amount, currency: s.currency || "MAD",
    method: method, paidAt: paidAt, reference: reference, proofDocId: proofDocId, status: "RECORDED", reconciled: false, note: periods + " période(s)", recordedBy: actorEmail, createdAt: nowIso_() });
  dbUpdate_("Subscriptions", s.subscriptionId, { status: "ACTIVE", periodEnd: newEnd, nextDueDate: newEnd, paidThrough: newEnd, suspendedAt: "", updatedAt: nowIso_(), updatedBy: actorEmail });
  return { paymentId: pay.paymentId, periodEnd: newEnd };
}
function subRecordPayment_(p, a) {
  requireSuper_(p);
  const s = dbGet_("Subscriptions", safeText_(a.subscriptionId, 120));
  assert_(s && ["CANCELLED", "EXPIRED"].indexOf(s.status) < 0, "Abonnement introuvable ou clos.");
  const periods = Math.min(Math.max(parseInt(a.periods, 10) || 1, 1), 24);
  const amount = money_(a.amount, "Montant", { min: 0.01 });
  const paidAt = a.paidAt ? dateOnly_(a.paidAt, "Date") : todayStr_();
  const reference = reqText_(a.reference, "Référence du paiement (virement, reçu…)", 2, 120);
  return withLock_(function () {
    return idemRun_(a.requestKey, "SUBSCRIPTION_PAYMENT", s.organizationId, function () {
      const r = subApplyPayment_(dbGet_("Subscriptions", s.subscriptionId), amount, paidAt, oneOf_(a.method || "TRANSFER", PAY_METHODS_, "Mode"), reference, safeText_(a.proofDocId || "", 120), periods, p.email);
      audit_("SUBSCRIPTION_PAYMENT_RECORDED", "Subscription", s.subscriptionId, s.organizationId, { amount: amount, periods: periods, periodEnd: r.periodEnd, expected: round2_(num_(s.price) * periods) });
      return { ok: true, paymentId: r.paymentId, id: r.paymentId, periodEnd: r.periodEnd, warning: amount + 0.005 < num_(s.price) * periods ? "Montant inférieur au tarif attendu (" + round2_(num_(s.price) * periods) + ")." : "" };
    });
  });
}
function subSetStatus_(p, a) {
  const s = dbGet_("Subscriptions", safeText_(a.subscriptionId, 120));
  if (!s) notFound_("Abonnement");
  const action = oneOf_(a.action, ["SUSPEND", "REACTIVATE", "CANCEL_NOW", "CANCEL_AT_END", "UNDO_CANCEL"], "Action");
  if (action === "CANCEL_AT_END" || action === "UNDO_CANCEL") { if (!p.isSuper) assertOrgCap_(p, s.organizationId, "settings.manage"); }
  else requireSuper_(p);
  const patch = { updatedAt: nowIso_(), updatedBy: p.email };
  if (action === "SUSPEND") { assert_(["ACTIVE", "PAST_DUE", "TRIAL"].indexOf(s.status) >= 0, "Statut incompatible."); patch.status = "SUSPENDED"; patch.suspendedAt = nowIso_(); }
  if (action === "REACTIVATE") { assert_(s.status === "SUSPENDED", "Abonnement non suspendu."); patch.status = s.periodEnd && s.periodEnd >= todayStr_() ? "ACTIVE" : "PAST_DUE"; patch.suspendedAt = ""; }
  if (action === "CANCEL_NOW") { patch.status = "CANCELLED"; patch.canceledAt = nowIso_(); }
  if (action === "CANCEL_AT_END") { assert_(["ACTIVE", "TRIAL"].indexOf(s.status) >= 0, "Statut incompatible."); patch.cancelAtPeriodEnd = true; }
  if (action === "UNDO_CANCEL") patch.cancelAtPeriodEnd = false;
  dbUpdate_("Subscriptions", s.subscriptionId, patch);
  audit_("SUBSCRIPTION_" + action, "Subscription", s.subscriptionId, s.organizationId, {});
  return { ok: true };
}
function subList_(p, a) {
  requireSuper_(p);
  a = a || {};
  const orgs = indexBy_(dbAll_("Organizations"), "organizationId"), demo = a.includeDemo ? {} : demoOrgIdSet_();
  const rows = dbAll_("Subscriptions").filter(function (s) { return !demo[String(s.organizationId)]; }).filter(function (s) { return (!a.status || s.status === a.status) && (!a.organizationId || String(s.organizationId) === String(a.organizationId)) && (a.includeClosed || ["CANCELLED"].indexOf(s.status) < 0); })
    .map(function (s) { const o = subOut_(s, orgs); o.usage = subUsage_(s.organizationId); return o; })
    .filter(function (s) { return matchesQuery_(a.q, [s.organizationName, s.planCode]); })
    .sort(function (x, y) { return String(x.nextDueDate || "").localeCompare(String(y.nextDueDate || "")); });
  const page = pageOf_(rows, a);
  page.billing = dbAll_("Payments").filter(function (x) { return x.kind === "SUBSCRIPTION" && x.status === "RECORDED" && !demo[String(x.organizationId)]; }).sort(function (x, y) { return String(y.paidAt).localeCompare(String(x.paidAt)); }).slice(0, 100)
    .map(function (x) { return { paymentId: x.paymentId, organizationName: (orgs[String(x.organizationId)] || {}).name, subscriptionId: x.refId, amount: x.amount, paidAt: x.paidAt, method: x.method, reference: x.reference }; });
  return page;
}
function subMine_(p) {
  const orgs = indexBy_(dbAll_("Organizations"), "organizationId");
  return memberOrgIds_(p).filter(function (o) { return hasOrgCap_(p, o, "subscription.view"); }).map(function (orgId) {
    const e = entitlement_(orgId);
    // Agence créée par un propriétaire : incluse dans l'abonnement de ce propriétaire (ses montants restent privés).
    if (e.inheritedFrom) return { organizationId: orgId, organizationName: (orgs[orgId] || {}).name, includedIn: (orgs[e.inheritedFrom] || {}).name || "", subscription: null,
      plan: e.plan ? planOut_(e.plan) : null, usage: subUsage_(orgId), readOnly: e.readOnly, billing: [], paymentProvider: "" };
    return { organizationId: orgId, organizationName: (orgs[orgId] || {}).name, subscription: e.subscription ? subOut_(e.subscription, orgs) : null, plan: e.plan ? planOut_(e.plan) : null, usage: subUsage_(orgId),
      readOnly: e.readOnly, billing: dbAll_("Payments").filter(function (x) { return x.kind === "SUBSCRIPTION" && String(x.organizationId) === orgId && x.status === "RECORDED"; })
        .map(function (x) { return { amount: x.amount, paidAt: x.paidAt, method: x.method, reference: x.reference }; }), paymentProvider: PAYMENT_PROVIDERS_.MANUAL.name };
  });
}
function subRequestChange_(p, a) {
  const orgId = safeText_(a.organizationId, 120);
  assertOrgCap_(p, orgId, "subscription.view");
  const plan = dbGet_("SubscriptionPlans", safeText_(a.planCode, 30));
  assert_(plan && plan.status === "ACTIVE", "Forfait inconnu.");
  notify_({ eventKey: "sub-change:" + orgId + ":" + plan.planCode + ":" + todayStr_(), userIds: superAdminIds_(), type: "SUBSCRIPTION_REQUEST", organizationId: "",
    title: "Demande de changement de forfait", body: ((dbGet_("Organizations", orgId) || {}).name || orgId) + " souhaite le forfait " + plan.name + ". " + safeText_(a.message, 500), link: "#subscriptions" });
  audit_("SUBSCRIPTION_CHANGE_REQUESTED", "Organization", orgId, orgId, { planCode: plan.planCode });
  return { ok: true };
}

/**
 * Contrat d'abonnement et historique (PDF) : parties, forfait, tarif, période, limites, fonctionnalités, conditions,
 * historique des abonnements et des règlements. Super administrateur, ou membre de l'organisation ayant subscription.view.
 */
function subContractPdf_(p, a) {
  const orgId = safeText_(a.organizationId, 120), org = dbGet_("Organizations", orgId);
  assert_(org && org.type !== "PLATFORM", "Organisation introuvable.");
  if (!p.isSuper && !hasOrgCap_(p, orgId, "subscription.view")) forbid_("Accès refusé.");
  const subs = dbAll_("Subscriptions").filter(function (s) { return String(s.organizationId) === orgId; }).sort(function (x, y) { return String(x.createdAt).localeCompare(String(y.createdAt)); });
  assert_(subs.length, "Aucun abonnement enregistré pour cette organisation.");
  const cur = entitlement_(orgId).subscription || subs[subs.length - 1], plan = dbGet_("SubscriptionPlans", cur.planCode) || {};
  const opt = subAgencyOption_(cur);
  const platform = dbAll_("Organizations").find(function (o) { return o.type === "PLATFORM"; }) || { name: IMMO_CONFIG.APP_NAME };
  const fmt = function (v) { return (Math.round(num_(v) * 100) / 100).toLocaleString("fr-FR") + " " + (cur.currency || "MAD"); };
  const per = { MONTHLY: "mois", QUARTERLY: "trimestre", YEARLY: "an" }[cur.periodicity] || "période";
  const feats = parseJson_(plan.featuresJson, []);
  const FEAT = { properties: "Biens", reservations: "Réservations", checkin: "Arrivées et départs", cleaning: "Ménage", incidents: "Incidents", finance_basic: "Finances (base)",
    finance_advanced: "Finances avancées", leases: "Location longue durée", contractors: "Prestataires", pareto: "Analyses de Pareto", reports: "Rapports", automations: "Automatisations",
    guest_portal: "Portail voyageur", multi_agency: "Multi-agences", exports_unlimited: "Exports illimités" };
  const pays = dbAll_("Payments").filter(function (x) { return x.kind === "SUBSCRIPTION" && String(x.organizationId) === orgId && x.status === "RECORDED"; }).sort(function (x, y) { return String(x.paidAt).localeCompare(String(y.paidAt)); });
  const ST = { TRIAL: "Essai", ACTIVE: "Actif", PAST_DUE: "Échéance dépassée", SUSPENDED: "Suspendu (lecture seule)", CANCELLED: "Remplacé / annulé", EXPIRED: "Expiré" };
  let html = "<h2>Parties</h2>" + htmlTable_(["", "Organisation", "Contact"], [["Prestataire", platform.name, ""], ["Client", org.name, org.billingEmail || ""]]);
  html += "<h2>Abonnement en cours</h2>" + htmlTable_(["Champ", "Valeur"], [["Référence", cur.subscriptionId], ["Forfait", (plan.name || cur.planCode) + " (" + cur.planCode + ")"],
    ["Tarif", fmt(cur.price) + " par " + per], ["Option agences", opt.count ? opt.count + " agence(s) × " + fmt(opt.unitPrice) + " = " + fmt(opt.amount) + " par " + per + " (" + opt.agencies.join(", ") + ")" : "Aucune agence créée par le client"],
    ["Total par " + per, fmt(opt.totalPrice)], ["Statut", ST[cur.status] || cur.status], ["Début", pdfDate_(cur.startDate)], ["Fin d'essai", pdfDate_(cur.trialEnd)],
    ["Payé jusqu'au", pdfDate_(cur.paidThrough)], ["Prochaine échéance", pdfDate_(cur.nextDueDate)], ["Résiliation en fin de période", bool_(cur.cancelAtPeriodEnd) ? "Oui" : "Non"],
    ["Limites", (plan.maxProperties || "—") + " biens, " + (plan.maxUsers || "—") + " utilisateurs, " + (plan.storageMb || "—") + " Mo de stockage"],
    ["Fonctionnalités", feats.map(function (f) { return FEAT[f] || f; }).join(", ") || "—"]]);
  html += "<h2>Conditions principales</h2><div class='box'><ol style='margin:0;padding-left:16px'>" + [
    "L'abonnement donne accès à l'application ImmoPilot pour l'organisation cliente, dans les limites du forfait.",
    "Le tarif est payable d'avance pour chaque " + per + ", par virement, espèces ou chèque ; aucun paiement en ligne n'est effectué par l'application.",
    "En cas d'échéance non réglée, un délai de grâce de " + SUB_GRACE_DAYS_ + " jours s'applique ; au-delà, le compte passe en lecture seule jusqu'au règlement.",
    "Les agences créées par le client dans ImmoPilot n'ont pas d'abonnement propre : elles sont facturées en option sur cet abonnement, au prix par agence indiqué ci-dessus, et suivent son statut.",
    "La résiliation peut être demandée à tout moment ; elle prend effet à la fin de la période payée. Les données restent conservées et exportables.",
    "Chaque organisation n'accède qu'à ses propres données ; l'équipe ImmoPilot n'y accède qu'avec un accès d'assistance accordé par le client, limité dans le temps et journalisé.",
    "Le client reste responsable des données qu'il saisit (voyageurs, locataires) et de ses obligations déclaratives, notamment au titre de la loi 09-08."
  ].map(function (x) { return "<li>" + escapeHtml_(x) + "</li>"; }).join("") + "</ol></div>";
  html += "<h2>Historique des abonnements</h2>" + htmlTable_(["Référence", "Forfait", "Statut", "Début", "Payé jusqu'au", "Tarif"], subs.map(function (s) { return [s.subscriptionId, s.planCode, ST[s.status] || s.status, pdfDate_(s.startDate), pdfDate_(s.paidThrough), fmt(s.price)]; }));
  html += "<h2>Historique des règlements</h2>" + (pays.length ? htmlTable_(["Date", "Montant", "Mode", "Référence", "Détail"], pays.map(function (x) { return [pdfDate_(x.paidAt), fmt(x.amount), PDF_PAY_METHODS_[x.method] || x.method || "", x.reference || "", x.note || ""]; })) +
    "<p class='right'><b>Total réglé : " + escapeHtml_(fmt(sumBy_(pays, function (x) { return x.amount; }))) + "</b></p>" : "<p class='muted'>Aucun règlement enregistré.</p>");
  html += "<h2>Signatures</h2><table class='sign'><tr><td>Pour " + escapeHtml_(platform.name) + "</td><td>Pour " + escapeHtml_(org.name) + "</td></tr></table>";
  html += "<p class='muted'>Modèle indicatif : conditions à faire valider par un professionnel du droit avant usage contractuel.</p>";
  audit_("SUBSCRIPTION_CONTRACT_PDF", "Subscription", cur.subscriptionId, orgId, {});
  return storeGeneratedPdf_(p, htmlToPdf_(pdfShell_("Contrat d'abonnement et historique", html, { subtitle: org.name }), "Abonnement_" + org.name.replace(/[^\wÀ-ÿ]+/g, "_")),
    { propertyId: "", organizationId: orgId }, "SUBSCRIPTION", cur.subscriptionId, "CONTRACT");
}

/** Tâche quotidienne : transitions de statut, relances et alertes de quotas. */
function subscriptionJob_() {
  const today = todayStr_(); let changed = 0, alerts = 0;
  const notifyOrg = function (orgId, key, title, body) {
    const admins = dbAll_("UserRoles").filter(function (r) { return r.status === "ACTIVE" && String(r.organizationId) === String(orgId) && (r.role === "OWNER" || r.role === "AGENCY_ADMIN"); }).map(function (r) { return r.userId; });
    notify_({ eventKey: key, userIds: admins, type: "SUBSCRIPTION", organizationId: orgId, title: title, body: body, link: "#subscriptions" }); alerts++;
  };
  dbAll_("Subscriptions").filter(function (s) { return ["CANCELLED", "EXPIRED"].indexOf(s.status) < 0; }).forEach(function (s) {
    let patch = null;
    if (s.status === "TRIAL" && s.trialEnd && s.trialEnd < today) patch = { status: "PAST_DUE", nextDueDate: s.trialEnd };
    else if (s.status === "ACTIVE" && s.periodEnd && s.periodEnd < today) patch = bool_(s.cancelAtPeriodEnd) ? { status: "EXPIRED" } : { status: "PAST_DUE", nextDueDate: s.periodEnd };
    else if (s.status === "PAST_DUE" && s.nextDueDate && addDaysStr_(s.nextDueDate, SUB_GRACE_DAYS_) < today) patch = { status: "SUSPENDED", suspendedAt: nowIso_() };
    if (patch) { patch.updatedAt = nowIso_(); patch.updatedBy = "system"; dbUpdate_("Subscriptions", s.subscriptionId, patch); changed++;
      auditAs_("system", "", "SUBSCRIPTION_STATUS_" + patch.status, "Subscription", s.subscriptionId, s.organizationId, {});
      notifyOrg(s.organizationId, "sub-status:" + s.subscriptionId + ":" + patch.status + ":" + (patch.nextDueDate || today), "Abonnement : " + patch.status, patch.status === "SUSPENDED" ? "Compte en lecture seule jusqu'au règlement." : "Un règlement est attendu."); }
    const end = s.status === "TRIAL" ? s.trialEnd : s.periodEnd;
    if (end && ["ACTIVE", "TRIAL"].indexOf(s.status) >= 0 && end === addDaysStr_(today, 7)) notifyOrg(s.organizationId, "sub-expiring:" + s.subscriptionId + ":" + end, "Abonnement arrivant à échéance le " + end, "Pensez à régler le renouvellement.");
    const plan = dbGet_("SubscriptionPlans", s.planCode);
    if (plan) {
      const u = subUsage_(s.organizationId), th = Number(getSetting_("alerts.quotaPercent")) || 80;
      [["properties", plan.maxProperties], ["users", plan.maxUsers], ["storageMb", plan.storageMb]].forEach(function (q) {
        if (num_(q[1]) > 0 && u[q[0]] >= num_(q[1]) * th / 100) notifyOrg(s.organizationId, "quota:" + s.organizationId + ":" + q[0] + ":" + today.slice(0, 7), "Quota proche de la limite : " + q[0], u[q[0]] + " / " + q[1] + " (forfait " + plan.name + ").");
      });
    }
  });
  return { statusChanged: changed, alerts: alerts };
}
