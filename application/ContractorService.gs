/**
 * Annuaire des prestataires (feuille historique « Artisans », conservée et enrichie).
 * ANNUAIRE DE LA PLATEFORME : les prestataires (entreprises de ménage, artisans…) sont intégrés par le SUPER ADMINISTRATEUR
 * (organizationId = organisation « Plateforme »), avec leurs types de prestation (spécialités). Les propriétaires et agences
 * les choisissent dans cette liste, filtrée par type de prestation ; ils ne peuvent pas en créer eux-mêmes
 * (paramètre plateforme contractors.platformOnly, activé par défaut). Les prestataires créés auparavant par une
 * organisation restent utilisables par elle.
 * Chaque prestataire reçoit une invitation : rôle CLEANER s'il fait du ménage, ARTISAN pour les autres prestations ;
 * son compte ne donne accès qu'à SES missions, demandes, devis, interventions et factures.
 */
function platformOrgId_() { const o = dbAll_("Organizations").find(function (x) { return x.type === "PLATFORM"; }); return o ? String(o.organizationId) : ""; }
function isPlatformContractor_(c) { const pid = platformOrgId_(); return !!pid && String(c.organizationId) === pid; }
/** Peut-on choisir des prestataires pour ce bien ? (gestion des interventions ou du ménage) */
function canPickProviders_(p, prop) { return canProp_(p, prop, "workorder.manage") || canProp_(p, prop, "contractor.manage") || canProp_(p, prop, "cleaning.manage"); }
function contractorUsableFor_(p, c, prop) {
  if (!c || c.status !== "ACTIVE" || !prop) return false;
  if (isPlatformContractor_(c)) return canPickProviders_(p, prop);
  if (String(c.organizationId) === String(prop.organizationId)) return canProp_(p, prop, "workorder.manage") || canProp_(p, prop, "contractor.manage");
  const acc = propertyAccess_(p, prop);
  return !!(acc && acc.agencyOrgIds.indexOf(String(c.organizationId)) >= 0 && acc.caps["workorder.manage"]);
}
/** Statistiques d'un prestataire. propOk (facultatif) limite le calcul aux biens visibles par le demandeur :
 *  un client ne voit jamais l'activité ni les montants réalisés chez les autres clients. */
function contractorStats_(artisanId, propOk) {
  const keep = function (x) { return !propOk || propOk(String(x.propertyId)); };
  const wos = dbAll_("WorkOrders").filter(function (w) { return String(w.artisanId) === String(artisanId) && w.status !== "CANCELLED" && keep(w); });
  const done = wos.filter(function (w) { return ["COMPLETED", "VERIFIED"].indexOf(w.status) >= 0; });
  const delays = done.map(function (w) { const s = parseTs_(w.createdAt), e = parseTs_(w.completedAt || w.updatedAt); return s && e ? (e.getTime() - s.getTime()) / 86400000 : null; }).filter(function (x) { return x !== null; });
  const inv = dbAll_("Invoices").filter(function (v) { return String(v.artisanId) === String(artisanId) && ["APPROVED", "PARTIAL", "PAID"].indexOf(v.status) >= 0 && keep(v); });
  const quotes = dbAll_("Quotes").filter(function (q) { return String(q.artisanId) === String(artisanId) && keep(q); });
  return { interventions: wos.length, completed: done.length, verified: wos.filter(function (w) { return w.status === "VERIFIED"; }).length,
    resolutionRate: pct_(wos.filter(function (w) { return w.status === "VERIFIED"; }).length, wos.filter(function (w) { return w.status !== "DECLINED"; }).length),
    avgDelayDays: delays.length ? round2_(delays.reduce(function (a, b) { return a + b; }, 0) / delays.length) : null,
    totalInvoicedTTC: sumBy_(inv, function (v) { return v.amountTTC; }), avgInvoiceTTC: inv.length ? round2_(sumBy_(inv, function (v) { return v.amountTTC; }) / inv.length) : null,
    commissionTotal: sumBy_(inv, function (v) { return v.commissionAmount; }), quotes: quotes.length,
    quoteApprovalRate: pct_(quotes.filter(function (q) { return q.status === "APPROVED"; }).length, quotes.filter(function (q) { return ["APPROVED", "REJECTED"].indexOf(q.status) >= 0; }).length) };
}
/** Filtre « biens visibles » pour les statistiques d'un prestataire de la plateforme consulté par un client. */
function visiblePropFilter_(p) {
  const memo = {};
  return function (pid) { if (memo[pid] === undefined) { const pr = dbGet_("Properties", pid); memo[pid] = !!pr && canPickProviders_(p, pr); } return memo[pid]; };
}
function contractorOut_(c, withStats, withBilling, propOk) {
  const o = { artisanId: c.artisanId, organizationId: c.organizationId, name: c.name, email: c.email, phone: c.phone, specialties: parseJson_(c.categoriesJson, []), zones: parseJson_(c.zonesJson, []),
    status: c.status, notes: c.notes, commissionRate: c.commissionRate, hasAccount: !!c.userId, createdAt: c.createdAt };
  if (withBilling) { o.legalName = c.legalName; o.taxId = c.taxId; o.billingInfo = c.billingInfo; }
  if (withStats) o.stats = contractorStats_(c.artisanId, propOk);
  return o;
}
function contractorInput_(a, orgId) {
  const o = {};
  if (a.name !== undefined) o.name = reqText_(a.name, "Nom", 2, 120);
  if (a.email !== undefined) o.email = validateEmail_(a.email);
  if (a.phone !== undefined) o.phone = safeText_(a.phone, 30);
  const list = function (v, allowed) { return (Array.isArray(v) ? v : String(v || "").split(",")).map(function (x) { return safeText_(String(x).trim(), 60); }).filter(Boolean).filter(function (x) { return !allowed || allowed.indexOf(x) >= 0; }).slice(0, 20); };
  if (a.specialties !== undefined) o.categoriesJson = list(a.specialties, getSetting_("list.specialties", orgId));
  if (a.zones !== undefined) o.zonesJson = list(a.zones);
  if (a.notes !== undefined) o.notes = safeText_(a.notes, 2000);
  if (a.legalName !== undefined) o.legalName = safeText_(a.legalName, 160);
  if (a.taxId !== undefined) o.taxId = safeText_(a.taxId, 40);
  if (a.billingInfo !== undefined) o.billingInfo = safeText_(a.billingInfo, 500);
  if (a.commissionRate !== undefined) o.commissionRate = a.commissionRate === "" ? "" : rate_(a.commissionRate, "Commission");
  if (a.status !== undefined) o.status = oneOf_(a.status, ["ACTIVE", "INACTIVE", "BLOCKED"], "Statut");
  return o;
}

/* ------------------------------ Routes ------------------------------ */
function ctrList_(p, a) {
  a = a || {};
  const orgIds = p.roles.filter(function (r) { return r.caps.indexOf("contractor.manage") >= 0; }).map(function (r) { return r.organizationId; });
  const mine = myArtisanIds_(p), platform = platformOrgId_();
  // L'annuaire de la plateforme est visible du super administrateur et de quiconque gère des interventions ou du ménage.
  const seesPlatform = p.isSuper || p.roles.some(function (r) { return ["contractor.manage", "workorder.manage", "cleaning.manage"].some(function (c) { return r.caps.indexOf(c) >= 0; }); });
  if (p.isSuper && platform) orgIds.push(platform);
  const rows = dbAll_("Artisans").filter(function (c) {
    const isPf = !!platform && String(c.organizationId) === platform;
    if (orgIds.indexOf(String(c.organizationId)) < 0 && mine.indexOf(String(c.artisanId)) < 0 && !(isPf && seesPlatform && c.status === "ACTIVE")) return false;
    if (a.status && c.status !== a.status) return false;
    if (a.specialty && parseJson_(c.categoriesJson, []).indexOf(a.specialty) < 0) return false;
    if (a.zone && !parseJson_(c.zonesJson, []).some(function (z) { return String(z).toLowerCase().indexOf(String(a.zone).toLowerCase()) >= 0; })) return false;
    return matchesQuery_(a.q, [c.name, c.email, c.phone]);
  }).sort(function (x, y) { return String(x.name).localeCompare(String(y.name)); });
  const page = pageOf_(rows, a);
  const clientFilter = p.isSuper ? null : visiblePropFilter_(p);
  page.items = page.items.map(function (c) {
    const isPf = !!platform && String(c.organizationId) === platform, own = mine.indexOf(String(c.artisanId)) >= 0;
    const o = contractorOut_(c, !!a.withStats, orgIds.indexOf(String(c.organizationId)) >= 0, isPf && !own ? clientFilter : null);
    o.platform = isPf; return o;
  });
  return page;
}
/** Prestataires utilisables pour un bien, filtrés par type de prestation (specialty / serviceType). */
function ctrChoices_(p, a) {
  const prop = dbGet_("Properties", safeText_(a.propertyId, 120));
  if (!prop || !canPickProviders_(p, prop)) throw new AppError("FORBIDDEN", "Bien introuvable ou accès refusé.");
  const type = safeText_(a.serviceType || a.specialty || "", 40);
  const cleaners = indexBy_(dbAll_("UserRoles").filter(function (r) { return r.role === "CLEANER" && r.status === "ACTIVE"; }), "userId");
  const usersByEmail = {}; dbAll_("Users").forEach(function (u) { if (u.status === "ACTIVE") usersByEmail[normalizeEmail_(u.email)] = u; });
  return dbAll_("Artisans").filter(function (c) { return contractorUsableFor_(p, c, prop) && (!type || parseJson_(c.categoriesJson, []).indexOf(type) >= 0); })
    .sort(function (x, y) { return String(x.name).localeCompare(String(y.name)); })
    .map(function (c) {
      const u = usersByEmail[normalizeEmail_(c.email)];
      return { artisanId: c.artisanId, name: c.name, email: c.email, phone: c.phone, specialties: parseJson_(c.categoriesJson, []), zones: parseJson_(c.zonesJson, []),
        hasAccount: !!c.userId || !!u, canClean: !!(u && cleaners[String(u.userId)]), platform: isPlatformContractor_(c), commissionRate: c.commissionRate };
    });
}
function ctrGet_(p, a) {
  const c = dbGet_("Artisans", safeText_(a.artisanId, 120));
  if (!c) throw new AppError("FORBIDDEN", "Prestataire introuvable ou accès refusé.");
  const pf = isPlatformContractor_(c);
  const mgr = pf ? p.isSuper : hasOrgCap_(p, c.organizationId, "contractor.manage"), self = myArtisanIds_(p).indexOf(String(c.artisanId)) >= 0;
  const viewer = pf && c.status === "ACTIVE" && p.roles.some(function (r) { return ["contractor.manage", "workorder.manage", "cleaning.manage"].some(function (k) { return r.caps.indexOf(k) >= 0; }); });
  if (!mgr && !self && !viewer) throw new AppError("FORBIDDEN", "Prestataire introuvable ou accès refusé.");
  const o = contractorOut_(c, true, mgr || self, (pf && !mgr && !self) ? visiblePropFilter_(p) : null);
  o.platform = pf; o.canEdit = mgr;
  // Un propriétaire ou une agence ne voit que les interventions de SES biens, jamais celles des autres clients.
  const visible = function (w) { if (mgr && !pf) return true; if (self) return true; const pr = dbGet_("Properties", w.propertyId); return !!pr && canProp_(p, pr, "workorder.manage"); };
  o.workOrders = dbAll_("WorkOrders").filter(function (w) { return String(w.artisanId) === String(c.artisanId) && visible(w); }).sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); }).slice(0, 50).map(woOut_);
  o.documents = (mgr || self) ? docList_(p, { ownerType: "CONTRACTOR", ownerId: c.artisanId }) : [];
  return o;
}
function ctrCreate_(p, a) {
  let orgId;
  if (p.isSuper) {
    orgId = platformOrgId_();
    assert_(orgId, "Organisation plateforme absente : exécutez setupProject().", "CONFIG");
  } else {
    if (getSetting_("contractors.platformOnly") !== false) forbid_("Les prestataires (ménage, artisans…) sont intégrés par l'administrateur ImmoPilot. Choisissez-les dans la liste, par type de prestation.");
    orgId = safeText_(a.organizationId || (p.roles.find(function (r) { return r.caps.indexOf("contractor.manage") >= 0; }) || {}).organizationId, 120);
    assertOrgCap_(p, orgId, "contractor.manage");
    assertFeature_(orgId, "contractors");
    assertOrgWritable_(orgId);
  }
  const d = contractorInput_(a, orgId);
  assert_((d.categoriesJson || []).length, "Choisissez au moins un type de prestation.");
  assert_(d.name && d.email, "Nom et e-mail obligatoires.");
  const c = withLock_(function () {
    assert_(!dbAll_("Artisans").some(function (c) { return String(c.organizationId) === orgId && normalizeEmail_(c.email) === d.email && c.status !== "BLOCKED"; }), "Ce prestataire existe déjà dans votre annuaire.");
    const u = dbAll_("Users").find(function (x) { return normalizeEmail_(x.email) === d.email; });
    const row = dbInsert_("Artisans", Object.assign({ categoriesJson: [], zonesJson: [] }, d, { organizationId: orgId, status: "ACTIVE", createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_(),
      userId: u && dbAll_("UserRoles").some(function (r) { return String(r.userId) === String(u.userId) && r.role === "ARTISAN" && r.status === "ACTIVE"; }) ? u.userId : "" }));
    audit_("ARTISAN_CREATED", "Artisan", row.artisanId, orgId, { name: row.name, platform: !!p.isSuper });
    return row;
  });
  const out = { ok: true, artisanId: c.artisanId, id: c.artisanId, hasAccount: !!c.userId, invitations: [] };
  if (p.isSuper && a.inviteAccount !== false) out.invitations = providerInvite_(p, c);
  else if (!c.userId) out.note = "Invitez ce prestataire (rôle ARTISAN) pour qu'il réponde lui-même aux demandes.";
  return out;
}
/** Invitations du compte d'un prestataire de la plateforme : CLEANER pour le ménage, ARTISAN pour les autres prestations. */
function providerInvite_(p, c) {
  const specs = parseJson_(c.categoriesJson, []), org = dbGet_("Organizations", c.organizationId), out = [];
  const roles = [];
  if (specs.indexOf("CLEANING") >= 0) roles.push("CLEANER");
  if (specs.some(function (x) { return x !== "CLEANING"; })) roles.push("ARTISAN");
  const user = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === normalizeEmail_(c.email); });
  roles.forEach(function (role) {
    const has = user && dbAll_("UserRoles").some(function (r) { return String(r.userId) === String(user.userId) && r.role === role && r.status === "ACTIVE"; });
    const pending = dbAll_("Invitations").some(function (i) { return normalizeEmail_(i.email) === normalizeEmail_(c.email) && i.role === role && String(i.organizationId) === String(c.organizationId) && i.status === "PENDING"; });
    if (has || pending) { out.push({ role: role, status: has ? "ALREADY_ACTIVE" : "ALREADY_PENDING" }); return; }
    const r = invitationInsertAndSend_(p, { email: c.email, displayName: c.name, organizationId: c.organizationId, role: role }, org);
    out.push({ role: role, status: r.status, emailSent: r.emailSent, invitationId: r.invitationId });
  });
  return out;
}
function ctrUpdate_(p, a) {
  const c = dbGet_("Artisans", safeText_(a.artisanId, 120));
  if (!c) notFound_("Prestataire");
  const self = myArtisanIds_(p).indexOf(String(c.artisanId)) >= 0;
  const mgr = isPlatformContractor_(c) ? p.isSuper : hasOrgCap_(p, c.organizationId, "contractor.manage");
  if (!mgr) {
    assert_(self, "Accès refusé.", "FORBIDDEN");
    ["status", "commissionRate", "notes", "name", "email"].forEach(function (k) { assert_(a[k] === undefined, "Champ non modifiable par le prestataire : " + k, "FORBIDDEN"); });
  }
  const d = contractorInput_(a, c.organizationId); d.updatedAt = nowIso_();
  dbUpdate_("Artisans", c.artisanId, d);
  audit_("ARTISAN_UPDATED", "Artisan", c.artisanId, c.organizationId, diff_(c, d, Object.keys(d).filter(function (k) { return k !== "updatedAt"; })));
  return { ok: true };
}
