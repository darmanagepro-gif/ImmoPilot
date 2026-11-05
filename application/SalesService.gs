/**
 * Espace commercial : commerciaux terrain (rôle SALES), rattachement des clients et commissions.
 *
 *  - Un commercial est un compte (rôle SALES dans l'organisation plateforme) lié à une fiche SalesReps (code de parrainage unique).
 *  - Rattachement d'un client : à l'inscription en ligne, champ facultatif « Votre commercial » (nom et prénom ou code,
 *    pré-rempli par le lien ?action=signup&ref=CODE) ; sinon le super administrateur rattache le client à la main.
 *  - Plan de commissionnement (PlatformSettings « sales.plan », modifiable par le super administrateur) :
 *      les 2 premiers mois sont offerts ; le client paie à la souscription son 1er mois payant (= le 3e mois) ;
 *      prime = bonusRate × prix mensuel HT du forfait (hors options), ACQUISE à ce 1er paiement, versée en une fois à la fin du mois ;
 *      commission récurrente = recurringRate × prix mensuel HT × recurringMonths (mois 3 à 14), CUMULÉE et versée en une fois,
 *        ACQUISE au 2e paiement (le client a payé son 4e mois), versée à la fin de ce mois ; aucune reprise sur ce versement ;
 *      reprise de la prime : client résilié ou suspendu dans les clawbackDays après la prime → prime annulée (ou déduite si déjà payée).
 *  - Le calcul est refait chaque jour (jobDaily) et à la demande ; il est idempotent (une prime et un versement cumulé par client).
 *  Les commerciaux ne voient que leurs clients, leurs commissions et leurs prospects.
 */

var SALES_DEFAULT_PLAN_ = { bonusRate: 1, recurringRate: 0.10, recurringMonths: 12, clawbackDays: 90 };
/** Marqueur du versement cumulé des commissions mensuelles (une seule ligne par client et par commercial). */
var SALES_CUMUL_PERIOD_ = "CUMUL";

/* ------------------------------ plan, commercial courant ------------------------------ */
function salesPlan_() {
  // Réglage de plateforme lu directement (pas dans DEFAULT_SETTINGS : il ne doit jamais apparaître dans les paramètres des clients).
  let v = {}; try { const row = dbGet_("PlatformSettings", "sales.plan"); v = row ? parseJson_(row.settingValue, {}) || {} : {}; } catch (e) { v = {}; }
  const out = Object.assign({}, SALES_DEFAULT_PLAN_);
  Object.keys(SALES_DEFAULT_PLAN_).forEach(function (k) { if (v[k] !== undefined && v[k] !== "" && isFinite(Number(v[k]))) out[k] = Number(v[k]); });
  return out;
}
/** Taux effectifs d'un commercial (ses taux particuliers remplacent ceux du plan). */
function salesRates_(rep) {
  const pl = salesPlan_(), o = Object.assign({}, pl);
  ["bonusRate", "recurringRate", "recurringMonths"].forEach(function (k) { if (rep && rep[k] !== undefined && rep[k] !== "" && rep[k] !== null && isFinite(Number(rep[k]))) o[k] = Number(rep[k]); });
  return o;
}
function salesRepOfUser_(p) {
  if (!p || !p.userId) return null;
  // Le compte est créé à l'acceptation de l'invitation : la fiche est retrouvée par l'utilisateur, sinon par l'e-mail.
  const reps = dbAll_("SalesReps"), em = normalizeEmail_(p.email || "");
  return reps.find(function (r) { return r.userId && String(r.userId) === String(p.userId); }) || reps.find(function (r) { return !r.userId && em && normalizeEmail_(r.email) === em; }) || null;
}
/** Commercial connecté (rôle SALES actif + fiche active) ou refus. */
function requireRep_(p) {
  const ok = (p.roles || []).some(function (r) { return r.role === "SALES"; }), rep = ok ? salesRepOfUser_(p) : null;
  if (!rep || rep.status !== "ACTIVE") forbid_("Réservé aux commerciaux DarPilot.");
  return rep;
}
/** Bloc « me » : présent seulement pour un commercial. */
function salesMe_(p) {
  try {
    if (!(p.roles || []).some(function (r) { return r.role === "SALES"; })) return null;
    const rep = salesRepOfUser_(p); if (!rep) return null;
    return { repId: rep.repId, code: rep.code, name: rep.displayName, status: rep.status };
  } catch (e) { return null; }
}
function salesNorm_(s) { return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
function salesNewCode_(name) {
  const base = salesNorm_(name).split(" ").filter(function (w) { return /^[a-z]/.test(w); }).map(function (w) { return w.charAt(0); }).join("").toUpperCase().slice(0, 3) || "DP";
  const used = {}; dbAll_("SalesReps").forEach(function (r) { used[String(r.code).toUpperCase()] = true; });
  for (let i = 0; i < 50; i++) { const c = base + "-" + randomToken_().replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 4); if (!used[c]) return c; }
  return base + "-" + Date.now().toString(36).toUpperCase();
}
/** Commercial désigné par un code ou par « prénom nom » (dans un sens ou dans l'autre) ; null si inconnu ou ambigu. */
function salesFindRep_(ref) {
  const raw = String(ref || "").trim(); if (!raw) return null;
  const reps = dbAll_("SalesReps").filter(function (r) { return r.status === "ACTIVE"; });
  const byCode = reps.find(function (r) { return String(r.code).toUpperCase() === raw.toUpperCase().replace(/\s+/g, ""); });
  if (byCode) return byCode;
  // « Prénom Nom » ou « Nom Prénom » : mêmes mots, dans n'importe quel ordre.
  const key = function (v) { return salesNorm_(v).split(" ").filter(Boolean).sort().join(" "); }, n = key(raw);
  const m = n ? reps.filter(function (r) { return key(r.displayName) === n; }) : [];
  return m.length === 1 ? m[0] : null;
}
/** Rattache un client à un commercial (inscription ou super administrateur). Retourne le commercial ou null. */
function salesLinkOrg_(orgId, rep, declared, actor) {
  const org = dbGet_("Organizations", orgId); if (!org) return null;
  const patch = { salesRepDeclared: safeText_(declared || "", 120), updatedAt: nowIso_() };
  if (rep) Object.assign(patch, { salesRepId: rep.repId, salesLinkedAt: nowIso_(), salesLinkedBy: actor || "" });
  dbUpdate_("Organizations", orgId, patch);
  if (rep) salesComputeOrg_(dbGet_("Organizations", orgId));
  return rep;
}
/** Appelé par l'inscription en ligne (signupCreateClient_). */
function salesLinkAtSignup_(orgId, ref, email) {
  const r = String(ref || "").trim(); if (!r) return null;
  const rep = salesFindRep_(r);
  salesLinkOrg_(orgId, rep, r, "signup:" + email);
  if (!rep) notify_({ eventKey: "sales-unlinked:" + orgId, userIds: superAdminIds_(), type: "SIGNUP", organizationId: "", title: "Commercial à rattacher",
    body: "Inscription avec le commercial « " + r + " » non reconnu : rattachez-la dans Espace commercial › Inscriptions.", link: "#commercial" });
  return rep;
}

/* ------------------------------ moteur de commissions ------------------------------ */
function salesSubOf_(orgId) {
  const subs = dbAll_("Subscriptions").filter(function (s) { return String(s.organizationId) === String(orgId); });
  subs.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  return subs.find(function (s) { return ["CANCELLED", "EXPIRED"].indexOf(s.status) < 0; }) || subs[0] || null;
}
function salesPaymentsOf_(orgId) {
  const subIds = {}; dbAll_("Subscriptions").forEach(function (s) { if (String(s.organizationId) === String(orgId)) subIds[String(s.subscriptionId)] = true; });
  return dbAll_("Payments").filter(function (x) { return x.refType === "SUBSCRIPTION" && subIds[String(x.refId)] && x.direction !== "OUT"; })
    .sort(function (a, b) { return String(a.paidAt || a.createdAt).localeCompare(String(b.paidAt || b.createdAt)); });
}
/** (Re)calcule les commissions d'un client rattaché. Idempotent. */
function salesComputeOrg_(org) {
  if (!org || !org.salesRepId) return { changed: 0 };
  const rep = dbGet_("SalesReps", org.salesRepId); if (!rep) return { changed: 0 };
  const rates = salesRates_(rep), pl = salesPlan_(), s = salesSubOf_(org.organizationId);
  const mine = dbAll_("SalesCommissions").filter(function (c) { return String(c.organizationId) === String(org.organizationId) && String(c.repId) === String(rep.repId); });
  const now = nowIso_();
  let changed = 0;
  if (!s) return { changed: 0 };
  const price = num_(s.price), cur = s.currency || cur_(), pays = salesPaymentsOf_(org.organizationId);
  const live = pays.filter(function (x) { return x.status === "RECORDED"; });
  const ended = ["CANCELLED", "EXPIRED", "SUSPENDED"].indexOf(s.status) >= 0;
  // Prime du 3e mois (1er paiement) : une seule par client et par commercial.
  let bonus = mine.find(function (c) { return c.kind === "SIGNUP"; });
  if (!bonus) {
    bonus = dbInsert_("SalesCommissions", { repId: rep.repId, organizationId: org.organizationId, subscriptionId: s.subscriptionId, planCode: s.planCode, kind: "SIGNUP",
      baseAmount: price, rate: rates.bonusRate, amount: round2_(price * rates.bonusRate), currency: cur, status: "PENDING", createdAt: now, updatedAt: now,
      note: "Acquise au 1er paiement du client (son 3e mois), versée à la fin du mois" });
    changed++;
  }
  if (bonus.status === "PENDING") {
    if (ended && !live.length) { dbUpdate_("SalesCommissions", bonus.commissionId, { status: "CANCELLED", note: "Client résilié ou suspendu avant tout paiement", updatedAt: now }); changed++; }
    else if (live.length && ["ACTIVE", "PAST_DUE", "TRIAL"].indexOf(s.status) >= 0) {
      dbUpdate_("SalesCommissions", bonus.commissionId, { status: "EARNED", earnedAt: now, subscriptionId: s.subscriptionId, planCode: s.planCode, baseAmount: price, amount: round2_(price * num_(bonus.rate)),
        currency: cur, paymentId: live[0].paymentId, note: "Prime acquise au 1er paiement du client (3e mois) — à verser fin " + salesMonthLabel_(live[0].paidAt || now), updatedAt: now }); changed++;
    } else if (num_(bonus.baseAmount) !== price || bonus.planCode !== s.planCode) { dbUpdate_("SalesCommissions", bonus.commissionId, { baseAmount: price, planCode: s.planCode, subscriptionId: s.subscriptionId, amount: round2_(price * num_(bonus.rate)), updatedAt: now }); changed++; }
  }
  // Reprise : résiliation ou suspension dans le délai après l'acquisition de la prime.
  const fresh = dbGet_("SalesCommissions", bonus.commissionId);
  if (ended && (fresh.status === "EARNED" || fresh.status === "PAID") && fresh.earnedAt) {
    const endAt = String(s.canceledAt || s.suspendedAt || s.updatedAt || now);
    const within = (parseTs_(endAt) || new Date()).getTime() - (parseTs_(fresh.earnedAt) || new Date()).getTime() <= pl.clawbackDays * 86400000;
    if (within && fresh.status === "EARNED") { dbUpdate_("SalesCommissions", fresh.commissionId, { status: "CANCELLED", note: "Reprise : client parti dans les " + pl.clawbackDays + " jours", updatedAt: now }); changed++; }
    if (within && fresh.status === "PAID" && !mine.some(function (c) { return c.kind === "CLAWBACK"; })) {
      dbInsert_("SalesCommissions", { repId: rep.repId, organizationId: org.organizationId, subscriptionId: s.subscriptionId, planCode: s.planCode, kind: "CLAWBACK", baseAmount: num_(fresh.amount), rate: -1,
        amount: -round2_(num_(fresh.amount)), currency: fresh.currency, status: "EARNED", earnedAt: now, createdAt: now, updatedAt: now, note: "Reprise de la prime : client parti dans les " + pl.clawbackDays + " jours" }); changed++;
    }
  }
  // Commission mensuelle CUMULÉE : recurringRate × prix × recurringMonths (mois 3 à 14), versée en une fois quand le client
  // a payé son 4e mois (2e paiement après l'essai). Aucune reprise ensuite. Les anciennes commissions mois par mois non payées
  // (ancien plan) sont remplacées ; celles déjà payées sont déduites du versement cumulé.
  const cumul = mine.find(function (c) { return c.kind === "RECURRING" && c.period === SALES_CUMUL_PERIOD_; });
  mine.filter(function (c) { return c.kind === "RECURRING" && c.period !== SALES_CUMUL_PERIOD_ && c.status === "EARNED"; }).forEach(function (c) {
    dbUpdate_("SalesCommissions", c.commissionId, { status: "CANCELLED", note: "Remplacée par le versement cumulé des 10 % (nouveau plan)", updatedAt: now }); changed++;
  });
  if (cumul && cumul.status === "EARNED" && live.length < 2) {
    dbUpdate_("SalesCommissions", cumul.commissionId, { status: "CANCELLED", note: "Paiement du 4e mois annulé", updatedAt: now }); changed++;
  } else if (!cumul && live.length >= 2 && rates.recurringRate > 0 && rates.recurringMonths > 0) {
    const alreadyPaid = round2_(mine.filter(function (c) { return c.kind === "RECURRING" && c.status === "PAID"; }).reduce(function (t, c) { return t + num_(c.amount); }, 0));
    const total = round2_(price * rates.recurringRate * rates.recurringMonths);
    dbInsert_("SalesCommissions", { repId: rep.repId, organizationId: org.organizationId, subscriptionId: s.subscriptionId, planCode: s.planCode, kind: "RECURRING", period: SALES_CUMUL_PERIOD_,
      baseAmount: price, rate: rates.recurringRate, amount: Math.max(0, round2_(total - alreadyPaid)), currency: cur, status: "EARNED", earnedAt: now, paymentId: live[1].paymentId,
      createdAt: now, updatedAt: now, note: Math.round(rates.recurringRate * 1000) / 10 + " % × " + rates.recurringMonths + " mois (du 3e au " + (rates.recurringMonths + 2) + "e mois), cumulés, acquis au paiement du 4e mois — à verser fin " + salesMonthLabel_(live[1].paidAt || now) +
        (alreadyPaid ? " (déjà versé : " + alreadyPaid + " " + cur + ")" : "") });
    changed++;
  }
  return { changed: changed };
}
const SALES_MONTHS_FR_ = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
/** « avril 2027 » à partir d'une date ISO (mois de versement au commercial). */
function salesMonthLabel_(iso) { const m = /^(\d{4})-(\d{2})/.exec(String(iso || "")); return m ? SALES_MONTHS_FR_[Number(m[2]) - 1] + " " + m[1] : ""; }
function salesComputeAll_() {
  let orgs = 0, changed = 0;
  dbAll_("Organizations").forEach(function (o) { if (!o.salesRepId) return; orgs++; changed += salesComputeOrg_(o).changed; });
  return { clients: orgs, changed: changed };
}
/** Tâche quotidienne (jobDaily). */
function salesDailyJob_() { return salesComputeAll_(); }

/* ------------------------------ état d'un client (vue commerciale) ------------------------------ */
function salesClientRow_(o, opts) {
  opts = opts || {};
  const s = salesSubOf_(o.organizationId), plan = s ? dbGet_("SubscriptionPlans", s.planCode) : null;
  const signed = s ? dbAll_("ContractSignatures").filter(function (x) { return String(x.subscriptionId) === String(s.subscriptionId) || String(x.organizationId) === String(o.organizationId); })
    .sort(function (a, b) { return String(b.signedAt || b.createdAt || "").localeCompare(String(a.signedAt || a.createdAt || "")); })[0] : null;
  const card = dbAll_("BillingCards").find(function (c) { return String(c.organizationId) === String(o.organizationId) && c.status === "ACTIVE"; });
  const pays = salesPaymentsOf_(o.organizationId).filter(function (x) { return x.status === "RECORDED"; });
  const coms = dbAll_("SalesCommissions").filter(function (c) { return String(c.organizationId) === String(o.organizationId) && (!opts.repId || String(c.repId) === String(opts.repId)); });
  const sum = function (st) { return round2_(coms.filter(function (c) { return st.indexOf(c.status) >= 0; }).reduce(function (t, c) { return t + num_(c.amount); }, 0)); };
  let stage = "INSCRIT";
  if (s && ["CANCELLED", "EXPIRED"].indexOf(s.status) >= 0) stage = "RESILIE";
  else if (s && s.status === "SUSPENDED") stage = "SUSPENDU";
  else if (signed && signed.signedAt && card && pays.length) stage = s && s.status === "TRIAL" ? "ESSAI_PAYE" : "ACTIF";
  else if (signed && signed.signedAt) stage = "SIGNE";
  const out = { organizationId: o.organizationId, name: o.name, city: o.city || "", type: o.type, createdAt: o.createdAt, contactName: o.contactName || "", phone: o.phone || "", email: o.billingEmail || "",
    planCode: s ? s.planCode : "", planName: plan ? plan.name : (s ? s.planCode : ""), price: s ? num_(s.price) : 0, currency: s ? (s.currency || cur_()) : cur_(), subStatus: s ? s.status : "",
    trialEnd: s ? s.trialEnd || "" : "", signed: !!(signed && signed.signedAt), signedAt: signed ? signed.signedAt || "" : "", card: !!card, payments: pays.length, firstPaymentAt: pays.length ? pays[0].paidAt : "",
    stage: stage, commissionPending: sum(["PENDING"]), commissionEarned: sum(["EARNED"]), commissionPaid: sum(["PAID"]) };
  if (opts.admin) { out.salesRepId = o.salesRepId || ""; out.salesRepDeclared = o.salesRepDeclared || ""; out.signupSource = o.signupSource || ""; }
  return out;
}
function salesCommissionOut_(c, orgs, reps) {
  return { commissionId: c.commissionId, repId: c.repId, repName: reps && reps[c.repId] ? reps[c.repId].displayName : "", organizationId: c.organizationId, clientName: orgs[c.organizationId] ? orgs[c.organizationId].name : "",
    kind: c.kind, planCode: c.planCode, period: c.period || "", baseAmount: num_(c.baseAmount), rate: num_(c.rate), amount: num_(c.amount), currency: c.currency, status: c.status,
    earnedAt: c.earnedAt || "", paidAt: c.paidAt || "", paidRef: c.paidRef || "", note: c.note || "", createdAt: c.createdAt };
}
function salesTotals_(coms) {
  const t = {}; coms.forEach(function (c) { const k = c.currency || ""; t[k] = t[k] || { PENDING: 0, EARNED: 0, PAID: 0 }; if (t[k][c.status] !== undefined) t[k][c.status] = round2_(t[k][c.status] + num_(c.amount)); });
  return Object.keys(t).map(function (k) { return Object.assign({ currency: k }, t[k]); });
}
/** Simulation du plan pour chaque forfait (affichée au commercial et au super administrateur). */
function salesSimulation_(rates) {
  return dbAll_("SubscriptionPlans").filter(function (pl) { return pl.status === "ACTIVE"; }).sort(function (a, b) { return num_(a.sortOrder) - num_(b.sortOrder); }).map(function (pl) {
    const pr = num_(pl.price), bonus = round2_(pr * rates.bonusRate), rec = round2_(pr * rates.recurringRate);
    const cumul = round2_(rec * rates.recurringMonths);
    return { planCode: pl.planCode, name: pl.name, price: pr, currency: pl.currency || cur_(), bonus: bonus, recurring: rec, months: rates.recurringMonths, cumul: cumul, firstYear: round2_(bonus + cumul) };
  });
}
/** Indicateurs de l'espace commercial : gains, clients, chiffre apporté, évolution sur 6 mois. */
function salesIndicators_(clients, coms) {
  const now = new Date(), year = String(now.getFullYear());
  const live = coms.filter(function (c) { return c.status !== "CANCELLED"; });
  const sumSt = function (st) { return round2_(live.filter(function (c) { return c.status === st; }).reduce(function (t, c) { return t + num_(c.amount); }, 0)); };
  const gainDate = function (c) { return String(c.earnedAt || c.createdAt || ""); };
  const won = live.filter(function (c) { return c.status === "EARNED" || c.status === "PAID"; });
  const paying = clients.filter(function (c) { return c.payments > 0 && c.stage !== "RESILIE" && c.stage !== "SUSPENDU"; });
  const lost = clients.filter(function (c) { return c.stage === "RESILIE" || c.stage === "SUSPENDU"; });
  const trial = clients.filter(function (c) { return c.subStatus === "TRIAL" && !c.payments; });
  const decided = clients.filter(function (c) { return c.payments > 0 || c.subStatus !== "TRIAL"; });
  const converted = decided.filter(function (c) { return c.payments > 0; });
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2)); }
  return {
    currency: (clients[0] && clients[0].currency) || (coms[0] && coms[0].currency) || cur_(),
    gains: { pending: sumSt("PENDING"), earned: sumSt("EARNED"), paid: sumSt("PAID"),
      year: round2_(won.filter(function (c) { return gainDate(c).slice(0, 4) === year; }).reduce(function (t, c) { return t + num_(c.amount); }, 0)) },
    clients: { signedUp: clients.length, trial: trial.length, paying: paying.length, lost: lost.length,
      conversion: decided.length ? Math.round(converted.length / decided.length * 1000) / 10 : null },
    mrr: round2_(paying.reduce(function (t, c) { return t + num_(c.price); }, 0)),
    evolution: months.map(function (m) {
      return { month: m, signups: clients.filter(function (c) { return String(c.createdAt || "").slice(0, 7) === m; }).length,
        gains: round2_(won.filter(function (c) { return gainDate(c).slice(0, 7) === m; }).reduce(function (t, c) { return t + num_(c.amount); }, 0)) };
    })
  };
}

/* ------------------------------ routes : commercial ------------------------------ */
function salesMine_(p, a) {
  const rep = requireRep_(p), rates = salesRates_(rep);
  const clients = dbAll_("Organizations").filter(function (o) { return String(o.salesRepId) === String(rep.repId); }).map(function (o) { return salesClientRow_(o, { repId: rep.repId }); })
    .sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); });
  const orgs = indexBy_(dbAll_("Organizations"), "organizationId");
  const coms = dbAll_("SalesCommissions").filter(function (c) { return String(c.repId) === String(rep.repId); }).sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); });
  let url = ""; try { url = appUrl_(); } catch (e) { url = ""; }
  const pros = dbAll_("Prospects").filter(function (x) { return String(x.ownerRepId) === String(rep.repId); });
  return { rep: { repId: rep.repId, name: rep.displayName, code: rep.code, territory: rep.territory || "", country: rep.country || "" },
    signupLink: url ? url + "?action=signup&ref=" + encodeURIComponent(rep.code) : "", rates: rates, simulation: salesSimulation_(rates),
    kpis: { clients: clients.length, trial: clients.filter(function (c) { return c.subStatus === "TRIAL"; }).length, active: clients.filter(function (c) { return c.stage === "ACTIF" || c.stage === "ESSAI_PAYE"; }).length,
      notSigned: clients.filter(function (c) { return !c.signed && c.stage !== "RESILIE"; }).length, lost: clients.filter(function (c) { return c.stage === "RESILIE" || c.stage === "SUSPENDU"; }).length,
      prospects: pros.length, prospectsTalking: pros.filter(function (x) { return ["en_discussion", "rdv_pris", "demo_faite", "devis_envoye"].indexOf(x.status) >= 0; }).length },
    totals: salesTotals_(coms), indicators: salesIndicators_(clients, coms), clients: clients, commissions: coms.slice(0, 500).map(function (c) { return salesCommissionOut_(c, orgs, null); }) };
}

/* ------------------------------ routes : super administrateur ------------------------------ */
function salesOverview_(p, a) {
  requireSuper_(p);
  const reps = dbAll_("SalesReps"), coms = dbAll_("SalesCommissions"), orgs = dbAll_("Organizations").filter(function (o) { return o.type !== "PLATFORM"; });
  const linked = orgs.filter(function (o) { return o.salesRepId; });
  return { reps: reps.length, activeReps: reps.filter(function (r) { return r.status === "ACTIVE"; }).length, linkedClients: linked.length,
    toLink: orgs.filter(function (o) { return !o.salesRepId && o.salesRepDeclared; }).length,
    selfSignups: orgs.filter(function (o) { return o.signupSource === "SELF"; }).length, totals: salesTotals_(coms), plan: salesPlan_() };
}
function salesRepList_(p, a) {
  requireSuper_(p);
  const users = indexBy_(dbAll_("Users"), "userId"), orgs = dbAll_("Organizations"), coms = dbAll_("SalesCommissions"), pros = dbAll_("Prospects");
  return dbAll_("SalesReps").sort(function (x, y) { return String(x.displayName).localeCompare(String(y.displayName)); }).map(function (r) {
    const mine = orgs.filter(function (o) { return String(o.salesRepId) === String(r.repId); }).map(function (o) { return salesClientRow_(o, { repId: r.repId }); });
    const rc = coms.filter(function (c) { return String(c.repId) === String(r.repId); }), u = users[r.userId] || {};
    return { repId: r.repId, name: r.displayName, email: r.email, phone: r.phone || "", code: r.code, country: r.country || "", territory: r.territory || "", status: r.status,
      accountActive: !!u.passwordHash && u.status === "ACTIVE", bonusRate: r.bonusRate === "" ? null : r.bonusRate, recurringRate: r.recurringRate === "" ? null : r.recurringRate, recurringMonths: r.recurringMonths === "" ? null : r.recurringMonths,
      clients: mine.length, active: mine.filter(function (c) { return c.stage === "ACTIF" || c.stage === "ESSAI_PAYE"; }).length, notSigned: mine.filter(function (c) { return !c.signed && c.stage !== "RESILIE"; }).length,
      mrr: round2_(mine.filter(function (c) { return c.stage === "ACTIF" || c.stage === "ESSAI_PAYE"; }).reduce(function (t, c) { return t + c.price; }, 0)),
      prospects: pros.filter(function (x) { return String(x.ownerRepId) === String(r.repId); }).length, totals: salesTotals_(rc) };
  });
}
function salesRepGet_(p, a) {
  requireSuper_(p);
  const rep = dbGet_("SalesReps", safeText_(a.repId, 80)); if (!rep) notFound_("Commercial");
  const orgs = indexBy_(dbAll_("Organizations"), "organizationId"), rates = salesRates_(rep);
  return { repId: rep.repId, name: rep.displayName, email: rep.email, phone: rep.phone || "", code: rep.code, country: rep.country || "", territory: rep.territory || "", status: rep.status, rates: rates,
    simulation: salesSimulation_(rates),
    clients: dbAll_("Organizations").filter(function (o) { return String(o.salesRepId) === String(rep.repId); }).map(function (o) { return salesClientRow_(o, { repId: rep.repId }); }),
    commissions: dbAll_("SalesCommissions").filter(function (c) { return String(c.repId) === String(rep.repId); }).sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); }).map(function (c) { return salesCommissionOut_(c, orgs, null); }),
    totals: salesTotals_(dbAll_("SalesCommissions").filter(function (c) { return String(c.repId) === String(rep.repId); })) };
}
function salesRateInput_(v, label, max) {
  if (v === undefined || v === null || String(v).trim() === "") return "";
  const n = Number(String(v).replace(",", ".")); assert_(isFinite(n) && n >= 0 && n <= max, label + " invalide."); return n;
}
/** Crée un commercial : fiche + invitation (rôle SALES dans l'organisation plateforme). */
function salesRepCreate_(p, a) {
  requireSuper_(p);
  const email = validateEmail_(a.email), name = reqText_(a.name, "Nom et prénom", 3, 100);
  assert_(!dbAll_("SalesReps").some(function (r) { return normalizeEmail_(r.email) === email; }), "Un commercial existe déjà avec cet e-mail.");
  const pf = platformOrgId_(), org = dbGet_("Organizations", pf);
  assert_(org, "Organisation plateforme introuvable.", "CONFIG");
  return withLock_(function () {
    const user = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === email; });
    const rep = dbInsert_("SalesReps", { displayName: name, email: email, userId: user ? user.userId : "", code: salesNewCode_(name), phone: safeText_(a.phone || "", 30), country: oneOf_(String(a.country || edition_().code), ["FR", "MA"], "Pays"),
      territory: safeText_(a.territory || "", 120), status: "ACTIVE", bonusRate: salesRateInput_(a.bonusRate, "Prime", 5), recurringRate: salesRateInput_(a.recurringRate, "Taux récurrent", 1),
      recurringMonths: salesRateInput_(a.recurringMonths, "Durée", 60), createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_() });
    let invite = null;
    if (!(user && dbAll_("UserRoles").some(function (r) { return String(r.userId) === String(user.userId) && r.role === "SALES" && r.status === "ACTIVE"; })))
      invite = invitationInsertAndSend_(p, { email: email, displayName: name, organizationId: pf, role: "SALES" }, org);
    audit_("SALES_REP_CREATED", "SalesRep", rep.repId, "", { email: email, code: rep.code });
    return { ok: true, repId: rep.repId, code: rep.code, invited: !!invite };
  });
}
function salesRepUpdate_(p, a) {
  requireSuper_(p);
  const rep = dbGet_("SalesReps", safeText_(a.repId, 80)); if (!rep) notFound_("Commercial");
  const patch = { updatedAt: nowIso_() };
  if (a.name !== undefined) patch.displayName = reqText_(a.name, "Nom et prénom", 3, 100);
  if (a.phone !== undefined) patch.phone = safeText_(a.phone, 30);
  if (a.territory !== undefined) patch.territory = safeText_(a.territory, 120);
  if (a.country !== undefined && a.country !== "") patch.country = oneOf_(String(a.country), ["FR", "MA"], "Pays");
  if (a.status !== undefined) patch.status = oneOf_(String(a.status), ["ACTIVE", "SUSPENDED"], "Statut");
  ["bonusRate", "recurringRate", "recurringMonths"].forEach(function (k, i) { if (a[k] !== undefined) patch[k] = salesRateInput_(a[k], ["Prime", "Taux récurrent", "Durée"][i], [5, 1, 60][i]); });
  dbUpdate_("SalesReps", rep.repId, patch);
  if (patch.status) {
    const u = rep.userId || (dbAll_("Users").find(function (x) { return normalizeEmail_(x.email) === normalizeEmail_(rep.email); }) || {}).userId;
    if (u) dbAll_("UserRoles").filter(function (r) { return String(r.userId) === String(u) && r.role === "SALES"; }).forEach(function (r) { dbUpdate_("UserRoles", r.userRoleId, { status: patch.status === "ACTIVE" ? "ACTIVE" : "SUSPENDED" }); });
  }
  audit_("SALES_REP_UPDATED", "SalesRep", rep.repId, "", { status: patch.status || "" });
  return { ok: true };
}
/** Inscriptions et clients (avec leur commercial) : pour rattacher ou contrôler. */
function salesClients_(p, a) {
  requireSuper_(p);
  const reps = indexBy_(dbAll_("SalesReps"), "repId");
  let rows = dbAll_("Organizations").filter(function (o) { return (o.type === "OWNER_ORG" || o.type === "AGENCY") && !o.managedByOrgId && !bool_(o.isDemo); });
  if (a.filter === "LINKED") rows = rows.filter(function (o) { return o.salesRepId; });
  if (a.filter === "TO_LINK") rows = rows.filter(function (o) { return !o.salesRepId && o.salesRepDeclared; });
  if (a.filter === "NONE") rows = rows.filter(function (o) { return !o.salesRepId; });
  if (a.repId) rows = rows.filter(function (o) { return String(o.salesRepId) === String(a.repId); });
  const q = salesNorm_(a.q || "");
  if (q) rows = rows.filter(function (o) { return salesNorm_([o.name, o.city, o.billingEmail, o.salesRepDeclared].join(" ")).indexOf(q) >= 0; });
  rows.sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); });
  return rows.slice(0, 500).map(function (o) { const r = salesClientRow_(o, { admin: true }); r.repName = o.salesRepId && reps[o.salesRepId] ? reps[o.salesRepId].displayName : ""; return r; });
}
function salesAssign_(p, a) {
  requireSuper_(p);
  const org = dbGet_("Organizations", safeText_(a.organizationId, 120));
  assert_(org && (org.type === "OWNER_ORG" || org.type === "AGENCY"), "Client introuvable.");
  if (!a.repId) {
    assert_(!dbAll_("SalesCommissions").some(function (c) { return String(c.organizationId) === String(org.organizationId) && c.status === "PAID"; }), "Des commissions ont déjà été payées pour ce client : le rattachement ne peut plus être retiré.");
    dbAll_("SalesCommissions").filter(function (c) { return String(c.organizationId) === String(org.organizationId) && (c.status === "PENDING" || c.status === "EARNED"); })
      .forEach(function (c) { dbUpdate_("SalesCommissions", c.commissionId, { status: "CANCELLED", note: "Rattachement retiré", updatedAt: nowIso_() }); });
    dbUpdate_("Organizations", org.organizationId, { salesRepId: "", salesLinkedAt: "", salesLinkedBy: p.email, updatedAt: nowIso_() });
    audit_("SALES_CLIENT_UNLINKED", "Organization", org.organizationId, org.organizationId, {});
    return { ok: true };
  }
  const rep = dbGet_("SalesReps", safeText_(a.repId, 80)); assert_(rep, "Commercial introuvable.");
  if (org.salesRepId && String(org.salesRepId) !== String(rep.repId)) {
    assert_(!dbAll_("SalesCommissions").some(function (c) { return String(c.organizationId) === String(org.organizationId) && c.status === "PAID"; }), "Des commissions ont déjà été payées à un autre commercial pour ce client.");
    dbAll_("SalesCommissions").filter(function (c) { return String(c.organizationId) === String(org.organizationId) && (c.status === "PENDING" || c.status === "EARNED"); })
      .forEach(function (c) { dbUpdate_("SalesCommissions", c.commissionId, { status: "CANCELLED", note: "Client rattaché à un autre commercial", updatedAt: nowIso_() }); });
  }
  salesLinkOrg_(org.organizationId, rep, org.salesRepDeclared || "", p.email);
  audit_("SALES_CLIENT_LINKED", "Organization", org.organizationId, org.organizationId, { repId: rep.repId });
  return { ok: true };
}
function salesCommissionList_(p, a) {
  requireSuper_(p);
  const orgs = indexBy_(dbAll_("Organizations"), "organizationId"), reps = indexBy_(dbAll_("SalesReps"), "repId");
  let rows = dbAll_("SalesCommissions");
  if (a.status) rows = rows.filter(function (c) { return c.status === a.status; });
  if (a.repId) rows = rows.filter(function (c) { return String(c.repId) === String(a.repId); });
  rows.sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); });
  return { items: rows.slice(0, 1000).map(function (c) { return salesCommissionOut_(c, orgs, reps); }), totals: salesTotals_(rows) };
}
/** Marque payées les commissions acquises (toutes celles d'un commercial, ou une liste). */
function salesMarkPaid_(p, a) {
  requireSuper_(p);
  const ref = safeText_(a.reference || "", 120), ids = Array.isArray(a.commissionIds) ? a.commissionIds.map(String) : null;
  assert_(ids || a.repId, "Choisissez un commercial ou des commissions.");
  let n = 0, total = 0;
  withLock_(function () {
    dbAll_("SalesCommissions").filter(function (c) { return c.status === "EARNED" && (ids ? ids.indexOf(String(c.commissionId)) >= 0 : String(c.repId) === String(a.repId)); }).forEach(function (c) {
      dbUpdate_("SalesCommissions", c.commissionId, { status: "PAID", paidAt: nowIso_(), paidRef: ref, updatedAt: nowIso_() }); n++; total += num_(c.amount);
    });
  });
  audit_("SALES_COMMISSIONS_PAID", "SalesRep", a.repId || "", "", { count: n, total: round2_(total), reference: ref });
  return { ok: true, count: n, total: round2_(total) };
}
function salesCommissionExport_(p, a) {
  const list = salesCommissionList_(p, a).items;
  const cols = [["repName", "Commercial"], ["clientName", "Client"], ["kind", "Type"], ["planCode", "Forfait"], ["period", "Période"], ["baseAmount", "Base HT"], ["rate", "Taux"], ["amount", "Montant"], ["currency", "Devise"],
    ["status", "Statut"], ["earnedAt", "Acquise le"], ["paidAt", "Payée le"], ["paidRef", "Référence"], ["note", "Note"]];
  const esc = function (v) { let s = String(v == null ? "" : v); if (/^[=@\t\r]|^[+-][^\d\s]/.test(s)) s = "'" + s; return /[";\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return { fileName: "commissions-darpilot-" + todayStr_() + ".csv", mimeType: "text/csv", content: [cols.map(function (c) { return c[1]; }).join(";")].concat(list.map(function (r) { return cols.map(function (c) { return esc(r[c[0]]); }).join(";"); })).join("\n") };
}
function salesPlanGet_(p, a) { requireSuper_(p); const pl = salesPlan_(); return { plan: pl, simulation: salesSimulation_(pl) }; }
function salesPlanSave_(p, a) {
  requireSuper_(p);
  const pl = { bonusRate: salesRateInput_(a.bonusRate, "Prime du 3e mois", 5), recurringRate: salesRateInput_(a.recurringRate, "Commission récurrente", 1),
    recurringMonths: salesRateInput_(a.recurringMonths, "Durée", 60), clawbackDays: salesRateInput_(a.clawbackDays, "Délai de reprise", 365) };
  Object.keys(pl).forEach(function (k) { if (pl[k] === "") pl[k] = SALES_DEFAULT_PLAN_[k]; });
  pl.recurringMonths = Math.round(pl.recurringMonths); pl.clawbackDays = Math.round(pl.clawbackDays);
  if (dbGet_("PlatformSettings", "sales.plan")) dbUpdate_("PlatformSettings", "sales.plan", { settingValue: jsonSafe_(pl), updatedAt: nowIso_(), updatedBy: p.email });
  else dbInsert_("PlatformSettings", { settingKey: "sales.plan", settingValue: jsonSafe_(pl), updatedAt: nowIso_(), updatedBy: p.email });
  audit_("SALES_PLAN_SAVED", "Settings", "sales.plan", "", pl);
  return { ok: true, plan: salesPlan_(), simulation: salesSimulation_(salesPlan_()) };
}
function salesRecompute_(p, a) { requireSuper_(p); return withLock_(function () { return salesComputeAll_(); }); }
