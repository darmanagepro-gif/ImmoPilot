/**
 * Autorisations centralisées. Principe : toute lecture/écriture passe par une vérification serveur
 * d'appartenance de la ressource (organisation + bien) et de capacité. Masquer un bouton côté client
 * n'est jamais une mesure de sécurité.
 *
 * Sources d'accès à un bien :
 *  - OWNER de l'organisation du bien (capacités du rôle, éventuellement restreintes par permissionsJson) ;
 *  - Agence : attribution active AgencyPropertyPermissions → intersection(capacités du rôle agence, capacités des drapeaux) ;
 *  - Personnel affecté (PropertyAssignments) : gardien, ménage, artisan, locataire ;
 *  - Mission de ménage, ordre de travail/devis, bail : accès minimal lié à la mission ;
 *  - Super administrateur : AUCUN accès aux données privées, sauf autorisation d'assistance (SupportGrant)
 *    approuvée par l'organisation, limitée dans le temps, en lecture seule et journalisée.
 */
var CTX_ = { principal: null, propMemo: {}, grantId: "" };

var SUPPORT_READ_CAPS_ = ["reservation.view", "incident.view", "finance.view", "invoice.view", "lease.view", "report.view", "document.view"];
var WRITE_CAP_RE_ = /\.(create|edit|archive|assign|cancel|manage|decide|operate|submit|invite|approve)$/;

function ctxReset_() { CTX_ = { principal: null, propMemo: {}, grantId: "" }; }

function capsForRole_(roleRow) {
  const base = (ROLE_CAPS[roleRow.role] || []).slice();
  const ov = parseJson_(roleRow.permissionsJson, []);
  if (!Array.isArray(ov)) return base;
  // Les surcharges ne peuvent que RETIRER des capacités du plafond du rôle (pas d'élévation possible).
  const removed = ov.filter(function (x) { return String(x).charAt(0) === "-"; }).map(function (x) { return String(x).slice(1); });
  return base.filter(function (c) { return removed.indexOf(c) < 0; });
}

function buildPrincipal_(user) {
  const orgs = indexBy_(dbAll_("Organizations"), "organizationId");
  const roles = dbAll_("UserRoles").filter(function (r) {
    if (String(r.userId) !== String(user.userId) || r.status !== "ACTIVE") return false;
    const o = orgs[String(r.organizationId)];
    return r.role === "SUPER_ADMIN" || (o && o.status === "ACTIVE");
  }).map(function (r) { return { userRoleId: r.userRoleId, role: r.role, organizationId: String(r.organizationId), caps: capsForRole_(r) }; });
  const isSuper = roles.some(function (r) { return r.role === "SUPER_ADMIN"; });
  const now = Date.now();
  const grants = isSuper ? dbAll_("SupportGrants").filter(function (g) {
    return String(g.superAdminUserId) === String(user.userId) && g.status === "ACTIVE" && parseTs_(g.expiresAt) && parseTs_(g.expiresAt).getTime() > now;
  }) : [];
  return { userId: String(user.userId), email: normalizeEmail_(user.email), displayName: user.displayName || user.email, locale: user.locale || "fr",
    roles: roles, isSuper: isSuper, grants: grants, supportOrgIds: grants.map(function (g) { return String(g.organizationId); }) };
}

function hasRole_(p, role, orgId) {
  return p.roles.some(function (r) { return r.role === role && (orgId === undefined || String(r.organizationId) === String(orgId)); });
}
function hasAnyRole_(p, roles) { return p.roles.some(function (r) { return roles.indexOf(r.role) >= 0; }); }
function orgCaps_(p, orgId) {
  const s = {};
  p.roles.forEach(function (r) { if (String(r.organizationId) === String(orgId)) r.caps.forEach(function (c) { s[c] = true; }); });
  return s;
}
function hasOrgCap_(p, orgId, cap) { return !!orgCaps_(p, orgId)[cap]; }
function assertOrgCap_(p, orgId, cap) {
  assert_(orgId, "Organisation manquante.");
  if (!hasOrgCap_(p, orgId, cap)) forbid_("Accès refusé : droits insuffisants dans cette organisation.");
  const org = dbGet_("Organizations", orgId);
  if (!org || org.status !== "ACTIVE") forbid_("Organisation inactive ou suspendue.");
  return org;
}
function requireSuper_(p) { if (!p.isSuper) forbid_("Réservé au super administrateur."); return p; }
function memberOrgIds_(p) { const s = {}; p.roles.forEach(function (r) { if (r.role !== "SUPER_ADMIN") s[r.organizationId] = true; }); return Object.keys(s); }
function uiCaps_(p) { const s = {}; p.roles.forEach(function (r) { r.caps.forEach(function (c) { s[c] = true; }); }); return Object.keys(s); }

/** Identifiants d'artisan (fiches Artisans) liés au compte connecté. */
function myArtisanIds_(p) {
  if (!hasRole_(p, "ARTISAN")) return [];
  return dbAll_("Artisans").filter(function (a) { return a.status !== "BLOCKED" && (String(a.userId) === p.userId || normalizeEmail_(a.email) === p.email); })
    .map(function (a) { return String(a.artisanId); });
}
function myTenantIds_(p) {
  if (!hasRole_(p, "TENANT")) return [];
  return dbAll_("Tenants").filter(function (t) { return String(t.userId) === p.userId || (normalizeEmail_(t.email) === p.email && t.email); })
    .map(function (t) { return String(t.tenantId); });
}

/** Calcule les capacités de l'utilisateur sur un bien. Retourne null si aucun accès. */
function propertyAccess_(p, prop) {
  if (!prop || prop.status === "DELETED") return null;
  const memoKey = String(prop.propertyId);
  if (CTX_.propMemo[memoKey] !== undefined) return CTX_.propMemo[memoKey];
  const org = dbGet_("Organizations", prop.organizationId);
  if (!org || org.status !== "ACTIVE") { CTX_.propMemo[memoKey] = null; return null; }
  const caps = {}, via = {};
  let guardAll = false, guardResv = [], agencyOrgIds = [], checkinOther = false;
  const add = function (list, src) { list.forEach(function (c) { caps[c] = true; if (c === "checkin.operate" && src !== "GUARD_RESV") checkinOther = true; }); via[src] = true; };

  p.roles.forEach(function (r) { if (r.role === "OWNER" && String(r.organizationId) === String(prop.organizationId)) add(r.caps, "OWNER"); });

  const today = todayStr_();
  dbAll_("AgencyPropertyPermissions").forEach(function (a) {
    if (String(a.propertyId) !== memoKey || a.status !== "ACTIVE" || !bool_(a.canView)) return;
    if (a.validFrom && today < a.validFrom) return;
    if (a.validTo && today > a.validTo) return;
    const agencyRoles = p.roles.filter(function (r) { return String(r.organizationId) === String(a.agencyOrganizationId) && (r.role === "AGENCY_ADMIN" || r.role === "AGENCY_USER"); });
    if (!agencyRoles.length) return;
    const agOrg = dbGet_("Organizations", a.agencyOrganizationId);
    if (!agOrg || agOrg.status !== "ACTIVE") return;
    const flagCaps = {};
    Object.keys(AGENCY_FLAG_CAPS).forEach(function (f) { if (bool_(a[f])) AGENCY_FLAG_CAPS[f].forEach(function (c) { flagCaps[c] = true; }); });
    const roleCaps = {}; agencyRoles.forEach(function (r) { r.caps.forEach(function (c) { roleCaps[c] = true; }); });
    add(Object.keys(flagCaps).filter(function (c) { return roleCaps[c]; }), "AGENCY");
    agencyOrgIds.push(String(a.agencyOrganizationId));
  });

  dbAll_("PropertyAssignments").forEach(function (a) {
    if (String(a.propertyId) !== memoKey || a.status !== "ACTIVE" || String(a.userId) !== p.userId) return;
    const r = p.roles.find(function (x) { return x.role === a.role; });
    if (!r) return;
    if (a.role === "GUARD" && a.reservationId) { guardResv.push(String(a.reservationId)); add(r.caps, "GUARD_RESV"); }
    else { if (a.role === "GUARD") guardAll = true; add(r.caps, "STAFF"); }
  });

  if (hasRole_(p, "CLEANER") && dbAll_("CleaningMissions").some(function (m) {
    return String(m.propertyId) === memoKey && (String(m.providerUserId) === p.userId || normalizeEmail_(m.providerEmail) === p.email) &&
      ["OFFERED", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "VALIDATED"].indexOf(m.status) >= 0;
  })) add(["cleaning.operate", "incident.report"], "MISSION");

  const artIds = myArtisanIds_(p);
  if (artIds.length && (dbAll_("WorkOrders").some(function (w) { return String(w.propertyId) === memoKey && artIds.indexOf(String(w.artisanId)) >= 0 && w.status !== "CANCELLED"; }) ||
    dbAll_("Quotes").some(function (q) { return String(q.propertyId) === memoKey && artIds.indexOf(String(q.artisanId)) >= 0 && q.status !== "CANCELLED"; })))
    add(["workorder.operate", "quote.submit", "invoice.submit"], "ARTISAN");

  const tIds = myTenantIds_(p);
  if (tIds.length && dbAll_("Leases").some(function (l) { return String(l.propertyId) === memoKey && tIds.indexOf(String(l.tenantId)) >= 0 && ["ACTIVE", "NOTICE"].indexOf(l.status) >= 0; }))
    add(["lease.self", "incident.report"], "TENANT");

  if (p.isSuper && p.supportOrgIds.indexOf(String(prop.organizationId)) >= 0) {
    add(SUPPORT_READ_CAPS_, "SUPPORT");
    CTX_.grantId = (p.grants.find(function (g) { return String(g.organizationId) === String(prop.organizationId); }) || {}).grantId || "";
  }

  const result = Object.keys(caps).length ? { caps: caps, via: via, guardAll: guardAll, guardResv: guardResv, checkinRestricted: !checkinOther && !guardAll && guardResv.length > 0, agencyOrgIds: agencyOrgIds } : null;
  CTX_.propMemo[memoKey] = result;
  return result;
}

function canProp_(p, prop, cap) { const a = propertyAccess_(p, prop); return !!(a && (!cap || a.caps[cap])); }
/** Charge un bien et vérifie la capacité. Message identique « introuvable ou refusé » pour éviter l'énumération (IDOR). */
function assertProp_(p, propertyId, cap) {
  const prop = dbGet_("Properties", safeText_(propertyId, 120));
  if (!prop || !canProp_(p, prop, cap)) throw new AppError("FORBIDDEN", "Bien introuvable ou accès refusé.");
  if (cap && WRITE_CAP_RE_.test(cap)) assertOrgWritable_(prop.organizationId);
  return prop;
}
function assertPropAny_(p, propertyId, caps) {
  const prop = dbGet_("Properties", safeText_(propertyId, 120));
  if (!prop || !caps.some(function (c) { return canProp_(p, prop, c); })) throw new AppError("FORBIDDEN", "Bien introuvable ou accès refusé.");
  return prop;
}
function accessibleProps_(p, cap) {
  return dbAll_("Properties").filter(function (pr) { return pr.status !== "DELETED" && canProp_(p, pr, cap); });
}
function accessiblePropIds_(p, cap) { const s = {}; accessibleProps_(p, cap).forEach(function (x) { s[String(x.propertyId)] = true; }); return s; }

/** Accès à une réservation : capacité sur le bien + restriction gardien à ses réservations affectées. */
function canResv_(p, resv, cap) {
  const prop = dbGet_("Properties", resv.propertyId);
  const a = propertyAccess_(p, prop);
  if (!a || !a.caps[cap]) return false;
  if ((cap === "checkin.operate" || cap === "guest.view.min") && a.checkinRestricted) return a.guardResv.indexOf(String(resv.reservationId)) >= 0;
  return true;
}
function assertResv_(p, reservationId, cap) {
  const r = dbGet_("Reservations", safeText_(reservationId, 120));
  if (!r || !canResv_(p, r, cap)) throw new AppError("FORBIDDEN", "Réservation introuvable ou accès refusé.");
  if (WRITE_CAP_RE_.test(cap)) assertOrgWritable_(r.organizationId);
  return r;
}

/** Destinataires « gestionnaires » d'un bien (propriétaires + agences ayant le drapeau requis). */
function propertyManagers_(prop, flag) {
  const ids = {};
  dbAll_("UserRoles").forEach(function (r) { if (r.status === "ACTIVE" && r.role === "OWNER" && String(r.organizationId) === String(prop.organizationId)) ids[r.userId] = true; });
  dbAll_("AgencyPropertyPermissions").forEach(function (a) {
    if (String(a.propertyId) !== String(prop.propertyId) || a.status !== "ACTIVE" || !bool_(a.canView) || (flag && !bool_(a[flag]))) return;
    dbAll_("UserRoles").forEach(function (r) { if (r.status === "ACTIVE" && String(r.organizationId) === String(a.agencyOrganizationId) && (r.role === "AGENCY_ADMIN" || r.role === "AGENCY_USER")) ids[r.userId] = true; });
  });
  return Object.keys(ids);
}
/** Organisation qui pilote les opérations (agence si elle a créé l'action, sinon propriétaire). */
function actingOrgForProp_(p, prop) {
  const a = propertyAccess_(p, prop);
  if (a && a.via.OWNER) return String(prop.organizationId);
  if (a && a.agencyOrgIds.length) return a.agencyOrgIds[0];
  return String(prop.organizationId);
}

/* ---------- Abonnement : droits d'écriture, fonctionnalités et quotas ---------- */
/**
 * Organisation qui paie l'abonnement d'une agence créée par un propriétaire : l'agence n'a pas d'abonnement propre,
 * elle est une OPTION de l'abonnement du propriétaire (« option agences »). Retourne "" pour toute autre organisation.
 * Agences créées avant ce réglage : rattachées au propriétaire qui les a créées.
 */
function agencyBillingParent_(org) {
  if (!org || org.type !== "AGENCY") return "";
  if (org.managedByOrgId) return String(org.managedByOrgId);
  const creator = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === normalizeEmail_(org.createdBy); });
  if (!creator) return "";
  const own = dbAll_("UserRoles").find(function (r) { return String(r.userId) === String(creator.userId) && r.role === "OWNER" && r.status === "ACTIVE"; });
  return own ? String(own.organizationId) : "";
}
/** Agences actives rattachées à l'abonnement d'un propriétaire (option agences). */
function managedAgencies_(ownerOrgId) {
  return dbAll_("Organizations").filter(function (o) { return o.type === "AGENCY" && o.status === "ACTIVE" && agencyBillingParent_(o) === String(ownerOrgId); });
}
function entitlement_(orgId, depth) {
  const org = dbGet_("Organizations", orgId), parent = agencyBillingParent_(org);
  if (parent && parent !== String(orgId) && !depth) return Object.assign({}, entitlement_(parent, 1), { inheritedFrom: parent });
  const sub = dbAll_("Subscriptions").filter(function (s) { return String(s.organizationId) === String(orgId) && s.status !== "CANCELLED"; })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })[0];
  if (!sub) return { planCode: "", status: "NONE", features: null, readOnly: false, plan: null };
  const plan = dbGet_("SubscriptionPlans", sub.planCode);
  const readOnly = ["SUSPENDED", "EXPIRED"].indexOf(sub.status) >= 0;
  return { planCode: sub.planCode, status: sub.status, features: plan ? parseJson_(plan.featuresJson, []) : [], readOnly: readOnly, plan: plan, subscription: sub };
}
/** Organisations de démonstration (exclues des statistiques et de la facturation de la plateforme). */
function demoOrgIdSet_() { const s = {}; dbAll_("Organizations").forEach(function (o) { if (o.isDemo === true) s[String(o.organizationId)] = true; }); return s; }
function billingEnforced_() { return getSetting_("billing.enforce") !== false; }
function assertOrgWritable_(orgId) {
  if (!billingEnforced_()) return;
  const e = entitlement_(orgId);
  if (e.readOnly) throw new AppError("SUBSCRIPTION", "Abonnement suspendu ou expiré : le compte est en lecture seule. Contactez l'administrateur ImmoPilot.");
}
/** Une organisation sans abonnement (installation historique) conserve l'accès complet ; à régulariser par le super administrateur. */
function assertFeature_(orgId, feature) {
  if (!billingEnforced_()) return;
  const e = entitlement_(orgId);
  if (e.features && e.features.indexOf(feature) < 0) throw new AppError("PLAN", "Fonctionnalité non incluse dans le forfait " + (e.planCode || "") + " : " + feature + ".");
}
function assertQuota_(orgId, kind) {
  if (!billingEnforced_()) return;
  const e = entitlement_(orgId);
  if (!e.plan) return;
  if (kind === "properties") {
    const n = dbAll_("Properties").filter(function (x) { return String(x.organizationId) === String(orgId) && ["ARCHIVED", "DELETED"].indexOf(x.status) < 0; }).length;
    assert_(n < Number(e.plan.maxProperties || 0), "Quota de biens atteint pour le forfait " + e.planCode + " (" + e.plan.maxProperties + ").", "QUOTA");
  }
  if (kind === "users") {
    const n = dbAll_("UserRoles").filter(function (r) { return String(r.organizationId) === String(orgId) && r.status === "ACTIVE"; }).length +
      dbAll_("Invitations").filter(function (i) { return String(i.organizationId) === String(orgId) && i.status === "PENDING"; }).length;
    assert_(n < Number(e.plan.maxUsers || 0), "Quota d'utilisateurs atteint pour le forfait " + e.planCode + " (" + e.plan.maxUsers + ").", "QUOTA");
  }
}
