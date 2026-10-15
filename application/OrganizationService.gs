/**
 * Organisations (tenants) et accès d'assistance exceptionnel du super administrateur.
 * Suspendre une organisation n'efface aucune donnée : les rôles de ses membres deviennent inopérants
 * et ses biens deviennent inaccessibles jusqu'à la réactivation.
 */
var ORG_TYPES_ = ["OWNER_ORG", "AGENCY", "PROVIDER", "PLATFORM"];

function orgPublic_(o) {
  return { organizationId: o.organizationId, name: o.name, status: o.status, type: o.type || "", city: o.city || "", country: o.country || "",
    planCode: o.planCode || "", billingEmail: o.billingEmail || "", createdAt: o.createdAt, suspendedAt: o.suspendedAt || "", suspensionReason: o.suspensionReason || "" };
}

function orgList_(p, a) {
  a = a || {};
  let orgs = dbAll_("Organizations");
  if (!p.isSuper) { const mine = memberOrgIds_(p); orgs = orgs.filter(function (o) { return mine.indexOf(String(o.organizationId)) >= 0; }); }
  if (a.status) orgs = orgs.filter(function (o) { return o.status === a.status; });
  if (a.type) orgs = orgs.filter(function (o) { return o.type === a.type; });
  orgs = orgs.filter(function (o) { return matchesQuery_(a.q, [o.name, o.city, o.organizationId]); });
  const roles = dbAll_("UserRoles"), props = dbAll_("Properties");
  const rows = orgs.map(function (o) {
    const r = orgPublic_(o);
    if (p.isSuper) {
      r.userCount = roles.filter(function (x) { return String(x.organizationId) === String(o.organizationId) && x.status === "ACTIVE"; }).length;
      r.propertyCount = props.filter(function (x) { return String(x.organizationId) === String(o.organizationId) && x.status !== "DELETED"; }).length;
      const e = entitlement_(o.organizationId); r.subscriptionStatus = e.status; r.planCode = e.planCode || r.planCode;
      if (e.inheritedFrom) r.billedToName = ((dbGet_("Organizations", e.inheritedFrom) || {}).name) || "";
    }
    return r;
  }).sort(function (x, y) { return String(x.name).localeCompare(String(y.name)); });
  return pageOf_(rows, a);
}

function orgCreate_(p, a) {
  requireSuper_(p);
  const name = reqText_(a.name, "Nom de l'organisation", 2, 120);
  const type = oneOf_(a.type || "OWNER_ORG", ORG_TYPES_, "Type d'organisation");
  return withLock_(function () {
    assert_(!dbAll_("Organizations").some(function (o) { return String(o.name).toLowerCase() === name.toLowerCase() && o.status !== "INACTIVE"; }), "Une organisation porte déjà ce nom.");
    const o = dbInsert_("Organizations", { name: name, status: "ACTIVE", type: type, city: safeText_(a.city || "Marrakech", 80), country: safeText_(a.country || "MA", 2),
      timezone: tz_(), locale: oneOf_(a.locale || "fr", IMMO_LANGS_, "Langue"), billingEmail: a.billingEmail ? validateEmail_(a.billingEmail) : "",
      createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_() });
    audit_("ORGANIZATION_CREATED", "Organization", o.organizationId, o.organizationId, { name: name, type: type });
    if (a.planCode) subAssign_(p, { organizationId: o.organizationId, planCode: a.planCode, trial: true });
    return { ok: true, organizationId: o.organizationId };
  });
}

function orgUpdate_(p, a) {
  const id = safeText_(a.organizationId, 120), o = dbGet_("Organizations", id);
  if (!o) notFound_("Organisation");
  if (!p.isSuper) assertOrgCap_(p, id, "settings.manage");
  const patch = { updatedAt: nowIso_() };
  if (a.name !== undefined) patch.name = reqText_(a.name, "Nom", 2, 120);
  if (a.city !== undefined) patch.city = safeText_(a.city, 80);
  if (a.billingEmail !== undefined) patch.billingEmail = a.billingEmail ? validateEmail_(a.billingEmail) : "";
  if (a.locale !== undefined) patch.locale = oneOf_(a.locale, IMMO_LANGS_, "Langue");
  if (a.type !== undefined) { requireSuper_(p); patch.type = oneOf_(a.type, ORG_TYPES_, "Type"); }
  dbUpdate_("Organizations", id, patch);
  audit_("ORGANIZATION_UPDATED", "Organization", id, id, diff_(o, patch, Object.keys(patch)));
  return { ok: true };
}

/** Suspension / réactivation / désactivation (aucune suppression de données). */
function orgSetStatus_(p, a) {
  requireSuper_(p);
  const id = safeText_(a.organizationId, 120), o = dbGet_("Organizations", id);
  if (!o) notFound_("Organisation");
  const status = oneOf_(a.status, ["ACTIVE", "SUSPENDED", "INACTIVE"], "Statut");
  assert_(o.type !== "PLATFORM" || status === "ACTIVE", "L'organisation plateforme ne peut pas être suspendue.");
  const reason = status === "ACTIVE" ? "" : reqText_(a.reason, "Motif", 3, 300);
  dbUpdate_("Organizations", id, { status: status, suspendedAt: status === "ACTIVE" ? "" : nowIso_(), suspensionReason: reason, updatedAt: nowIso_() });
  audit_("ORGANIZATION_STATUS_" + status, "Organization", id, id, { reason: reason });
  return { ok: true, status: status };
}

/* ---------------- Accès d'assistance (support) ---------------- */
function supportRequest_(p, a) {
  requireSuper_(p);
  const orgId = safeText_(a.organizationId, 120);
  if (!dbGet_("Organizations", orgId)) notFound_("Organisation");
  const hours = Math.min(Math.max(parseInt(a.hours, 10) || 4, 1), 24);
  const g = dbInsert_("SupportGrants", { superAdminUserId: p.userId, organizationId: orgId, justification: reqText_(a.justification, "Justification", 10, 500),
    status: "REQUESTED", requestedAt: nowIso_(), expiresAt: "", scope: "READ:" + hours });
  audit_("SUPPORT_ACCESS_REQUESTED", "SupportGrant", g.grantId, orgId, { hours: hours, justification: g.justification });
  const approvers = dbAll_("UserRoles").filter(function (r) { return r.status === "ACTIVE" && String(r.organizationId) === orgId && (r.role === "OWNER" || r.role === "AGENCY_ADMIN"); }).map(function (r) { return r.userId; });
  notify_({ eventKey: "support:" + g.grantId, userIds: approvers, type: "SUPPORT_REQUEST", organizationId: orgId,
    title: "Demande d'accès d'assistance", body: "L'équipe ImmoPilot demande un accès en lecture seule de " + hours + " h : " + g.justification, link: "#settings" });
  return { ok: true, grantId: g.grantId };
}
function supportDecide_(p, a) {
  const g = dbGet_("SupportGrants", safeText_(a.grantId, 120));
  if (!g) notFound_("Demande");
  assertOrgCap_(p, g.organizationId, "support.approve");
  assert_(g.status === "REQUESTED", "Demande déjà traitée.");
  const approve = a.decision === "APPROVE";
  const hours = parseInt(String(g.scope).split(":")[1], 10) || 4;
  dbUpdate_("SupportGrants", g.grantId, approve ? { status: "ACTIVE", approvedAt: nowIso_(), approvedBy: p.email, expiresAt: new Date(Date.now() + hours * 3600000).toISOString() } : { status: "DENIED", approvedAt: nowIso_(), approvedBy: p.email });
  audit_("SUPPORT_ACCESS_" + (approve ? "APPROVED" : "DENIED"), "SupportGrant", g.grantId, g.organizationId, {});
  notify_({ eventKey: "support-decision:" + g.grantId, userIds: [g.superAdminUserId], type: "SUPPORT_DECISION", organizationId: g.organizationId,
    title: "Accès d'assistance " + (approve ? "accordé" : "refusé"), body: "Organisation " + g.organizationId, link: "#admin" });
  return { ok: true };
}
function supportRevoke_(p, a) {
  const g = dbGet_("SupportGrants", safeText_(a.grantId, 120));
  if (!g) notFound_("Accès");
  if (!(p.isSuper && String(g.superAdminUserId) === p.userId)) assertOrgCap_(p, g.organizationId, "support.approve");
  assert_(["REQUESTED", "ACTIVE"].indexOf(g.status) >= 0, "Accès déjà clos.");
  dbUpdate_("SupportGrants", g.grantId, { status: "REVOKED", revokedAt: nowIso_() });
  audit_("SUPPORT_ACCESS_REVOKED", "SupportGrant", g.grantId, g.organizationId, {});
  return { ok: true };
}
function supportList_(p, a) {
  const orgs = indexBy_(dbAll_("Organizations"), "organizationId");
  const rows = dbAll_("SupportGrants").filter(function (g) {
    if (p.isSuper && String(g.superAdminUserId) === p.userId) return true;
    return hasOrgCap_(p, g.organizationId, "support.approve");
  }).map(function (g) {
    const exp = parseTs_(g.expiresAt);
    return { grantId: g.grantId, organizationId: g.organizationId, organizationName: (orgs[g.organizationId] || {}).name || "", justification: g.justification,
      status: g.status === "ACTIVE" && exp && exp.getTime() < Date.now() ? "EXPIRED" : g.status, requestedAt: g.requestedAt, expiresAt: g.expiresAt, approvedBy: g.approvedBy };
  }).sort(function (x, y) { return String(y.requestedAt).localeCompare(String(x.requestedAt)); });
  return pageOf_(rows, a);
}


/* ---------------- Agences créées par un propriétaire ---------------- */
var OWNER_AGENCY_LIMIT_ = 50;
/**
 * Un PROPRIÉTAIRE crée une agence pour l'un de ses biens, en une seule opération :
 *  1. organisation de type AGENCY (créée par lui, aucune donnée du propriétaire n'y est copiée) ;
 *  2. invitation à usage unique de l'administrateur de l'agence (rôle AGENCY_ADMIN) ;
 *  3. attribution du bien avec les droits choisis (mêmes règles que « Attribuer une agence »).
 * Réservé au rôle OWNER de l'organisation du bien (une agence ne peut pas créer d'autres agences).
 */
function ownerAgencyCreate_(p, a) {
  const prop = assertProp_(p, a.propertyId, "property.assign");
  if (!hasRole_(p, "OWNER", prop.organizationId)) forbid_("Seul le propriétaire du bien peut créer une agence.");
  const name = reqText_(a.name, "Nom de l'agence", 2, 120);
  const adminEmail = validateEmail_(a.adminEmail);
  rateLimit_("agency-create:" + p.userId, 10, 3600);
  assert_(dbAll_("Organizations").filter(function (o) { return o.type === "AGENCY" && normalizeEmail_(o.createdBy) === p.email && o.status !== "INACTIVE"; }).length < OWNER_AGENCY_LIMIT_,
    "Nombre maximal d'agences créées atteint (" + OWNER_AGENCY_LIMIT_ + "). Contactez l'administrateur ImmoPilot.");
  const agency = withLock_(function () {
    const same = dbAll_("Organizations").find(function (o) { return String(o.name).toLowerCase() === name.toLowerCase() && o.status !== "INACTIVE"; });
    if (same) throw new AppError("VALIDATION", "Une organisation porte déjà ce nom. S'il s'agit de la même agence, utilisez « Attribuer une agence » ; sinon, choisissez un autre nom.");
    const o = dbInsert_("Organizations", { name: name, status: "ACTIVE", type: "AGENCY", city: safeText_(a.city || "Marrakech", 80), country: "MA", timezone: tz_(),
      locale: oneOf_(a.locale || "fr", IMMO_LANGS_, "Langue"), billingEmail: adminEmail, createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_(),
      managedByOrgId: prop.organizationId, contactName: safeText_(a.adminName || "", 100), phone: safeText_(a.phone || "", 30), address: safeText_(a.address || "", 240) });
    audit_("AGENCY_CREATED_BY_OWNER", "Organization", o.organizationId, prop.organizationId, { name: name, propertyId: prop.propertyId, adminEmail: adminEmail });
    return o;
  });
  const invitation = invitationInsertAndSend_(p, { email: adminEmail, displayName: a.adminName, organizationId: agency.organizationId, role: "AGENCY_ADMIN" }, agency);
  const perm = propertyAgencySet_(p, { propertyId: prop.propertyId, agencyOrganizationId: agency.organizationId, canView: true,
    canManageReservations: a.canManageReservations === true, canManageOperations: a.canManageOperations === true, canViewFinance: a.canViewFinance === true,
    commissionRate: a.commissionRate, validFrom: a.validFrom, validTo: a.validTo });
  return { ok: true, organizationId: agency.organizationId, invitationId: invitation.invitationId, emailSent: invitation.emailSent, emailError: invitation.emailError, permissionId: perm.permissionId };
}

/* ---------------- Gestion des agences par le propriétaire ---------------- */
/** Organisations dont le connecté est PROPRIÉTAIRE. */
function ownerOrgIds_(p) { return p.roles.filter(function (r) { return r.role === "OWNER"; }).map(function (r) { return String(r.organizationId); }); }
/** Agence visible par ce propriétaire : il l'a créée, ou elle a (ou a eu) un accès à l'un de ses biens. */
function ownerAgencyLoad_(p, agencyOrgId) {
  const owners = ownerOrgIds_(p);
  if (!owners.length) forbid_("Réservé au propriétaire.");
  const org = dbGet_("Organizations", safeText_(agencyOrgId, 120));
  const linked = org && dbAll_("AgencyPropertyPermissions").some(function (z) { return String(z.agencyOrganizationId) === String(org.organizationId) && owners.indexOf(String(z.ownerOrganizationId)) >= 0; });
  const creator = !!org && normalizeEmail_(org.createdBy) === p.email;
  if (!org || org.type !== "AGENCY" || (!linked && !creator)) throw new AppError("FORBIDDEN", "Agence introuvable ou accès refusé.");
  return { org: org, owners: owners, creator: creator };
}
/** Liste « Mes agences » : chaque agence avec ses droits sur MES biens (jamais ceux des autres propriétaires). */
function ownerAgencyList_(p) {
  const owners = ownerOrgIds_(p);
  if (!owners.length) forbid_("Réservé au propriétaire.");
  const props = indexBy_(dbAll_("Properties").filter(function (x) { return owners.indexOf(String(x.organizationId)) >= 0 && x.status !== "DELETED"; }), "propertyId");
  const perms = dbAll_("AgencyPropertyPermissions").filter(function (z) { return props[String(z.propertyId)]; });
  const ids = {};
  perms.forEach(function (z) { ids[String(z.agencyOrganizationId)] = true; });
  dbAll_("Organizations").forEach(function (o) { if (o.type === "AGENCY" && normalizeEmail_(o.createdBy) === p.email) ids[String(o.organizationId)] = true; });
  const roles = dbAll_("UserRoles"), users = indexBy_(dbAll_("Users"), "userId"), invites = dbAll_("Invitations");
  return Object.keys(ids).map(function (id) {
    const o = dbGet_("Organizations", id); if (!o) return null;
    const adminUsers = roles.filter(function (r) { return String(r.organizationId) === id && r.role === "AGENCY_ADMIN" && r.status === "ACTIVE"; }).map(function (r) { return users[String(r.userId)]; }).filter(Boolean);
    const admins = adminUsers.map(function (u) { return u.email; });
    const pendingInv = invites.filter(function (i) { return String(i.organizationId) === id && (i.status === "PENDING" || i.status === "EMAIL_FAILED") && i.role === "AGENCY_ADMIN"; });
    const pending = pendingInv.map(function (i) { return i.email; });
    const resp = adminUsers[0] ? { name: adminUsers[0].displayName, email: adminUsers[0].email, phone: adminUsers[0].phone || "", activated: !!adminUsers[0].passwordHash }
      : pendingInv[0] ? { name: pendingInv[0].displayName, email: pendingInv[0].email, phone: "", activated: false, pending: true } : null;
    const billedTo = agencyBillingParent_(o);
    const mine = perms.filter(function (z) { return String(z.agencyOrganizationId) === id; }).map(function (z) {
      const pr = props[String(z.propertyId)];
      return { permissionId: z.permissionId, propertyId: z.propertyId, propertyName: pr.name, propertyCity: pr.city, status: z.status, canView: bool_(z.canView), canManageReservations: bool_(z.canManageReservations),
        canManageOperations: bool_(z.canManageOperations), canViewFinance: bool_(z.canViewFinance), commissionRate: z.commissionRate, validFrom: z.validFrom, validTo: z.validTo };
    });
    return { organizationId: id, name: o.name, city: o.city, contactEmail: o.billingEmail, locale: o.locale, status: o.status, createdByMe: normalizeEmail_(o.createdBy) === p.email,
      address: o.address || "", phone: o.phone || "", contactName: o.contactName || "", responsible: resp, adminName: resp ? resp.name : "", adminEmail: resp ? resp.email : "",
      includedInMySubscription: !!billedTo && owners.indexOf(billedTo) >= 0,
      admins: admins, pendingInvitations: pending, activeProperties: mine.filter(function (x) { return x.status === "ACTIVE"; }).length, properties: mine };
  }).filter(Boolean).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
}
/** Modifier la fiche d'une agence : uniquement celle que l'on a créée (une agence partagée appartient à plusieurs clients). */
function ownerAgencyUpdate_(p, a) {
  const x = ownerAgencyLoad_(p, a.agencyOrganizationId);
  if (!x.creator) forbid_("Vous pouvez modifier uniquement les agences que vous avez créées. Pour les autres, gérez seulement leurs accès à vos biens.");
  const patch = { updatedAt: nowIso_() };
  if (a.name !== undefined) {
    const name = reqText_(a.name, "Nom de l'agence", 2, 120);
    assert_(!dbAll_("Organizations").some(function (o) { return String(o.organizationId) !== String(x.org.organizationId) && String(o.name).toLowerCase() === name.toLowerCase() && o.status !== "INACTIVE"; }), "Une organisation porte déjà ce nom.");
    patch.name = name;
  }
  if (a.city !== undefined) patch.city = safeText_(a.city, 80);
  if (a.contactEmail !== undefined) patch.billingEmail = a.contactEmail ? validateEmail_(a.contactEmail) : "";
  if (a.locale !== undefined) patch.locale = oneOf_(a.locale, IMMO_LANGS_, "Langue");
  if (a.phone !== undefined) patch.phone = safeText_(a.phone, 30);
  if (a.address !== undefined) patch.address = safeText_(a.address, 240);
  if (a.adminName !== undefined) patch.contactName = safeText_(a.adminName, 100);
  dbUpdate_("Organizations", x.org.organizationId, patch);
  audit_("AGENCY_UPDATED_BY_OWNER", "Organization", x.org.organizationId, x.owners[0], diff_(x.org, patch, Object.keys(patch).filter(function (k) { return k !== "updatedAt"; })));
  let responsible = null;
  if (a.adminEmail !== undefined && String(a.adminEmail || "").trim()) responsible = ownerAgencySetResponsible_(p, x, validateEmail_(a.adminEmail), safeText_(a.adminName || "", 100), a.adminPhone);
  return { ok: true, responsible: responsible };
}
/** Responsable actuel de l'agence : comptes AGENCY_ADMIN actifs et invitations en attente. */
function ownerAgencyResponsibles_(orgId) {
  const users = indexBy_(dbAll_("Users"), "userId");
  return {
    roles: dbAll_("UserRoles").filter(function (r) { return String(r.organizationId) === String(orgId) && r.role === "AGENCY_ADMIN" && r.status === "ACTIVE"; }).map(function (r) { return { role: r, user: users[String(r.userId)] || {} }; }),
    invites: dbAll_("Invitations").filter(function (i) { return String(i.organizationId) === String(orgId) && i.role === "AGENCY_ADMIN" && (i.status === "PENDING" || i.status === "EMAIL_FAILED"); })
  };
}
/**
 * Changement d'e-mail du responsable (agence créée par le propriétaire) : l'ancien responsable perd son accès à CETTE agence
 * (son compte n'est pas supprimé : il peut travailler pour d'autres organisations), ses invitations en attente sont révoquées,
 * et un nouveau lien d'activation, à usage unique, est envoyé à la nouvelle adresse. Même adresse : seuls le nom et le téléphone sont mis à jour.
 */
function ownerAgencySetResponsible_(p, x, email, name, phone) {
  const id = String(x.org.organizationId), cur = ownerAgencyResponsibles_(id);
  const same = cur.roles.some(function (r) { return normalizeEmail_(r.user.email) === email; }) || cur.invites.some(function (i) { return normalizeEmail_(i.email) === email; });
  if (same) {
    cur.roles.filter(function (r) { return normalizeEmail_(r.user.email) === email; }).forEach(function (r) {
      const patch = {}; if (name && !r.user.passwordHash) patch.displayName = name; if (phone !== undefined && !r.user.phone) patch.phone = safeText_(phone, 30);
      if (Object.keys(patch).length) dbUpdate_("Users", r.user.userId, Object.assign(patch, { updatedAt: nowIso_() }));
    });
    return { changed: false, email: email };
  }
  withLock_(function () {
    cur.invites.forEach(function (i) { dbUpdate_("Invitations", i.invitationId, { status: "REVOKED", revokedAt: nowIso_(), tokenHash: "" }); });
    cur.roles.forEach(function (r) {
      dbUpdate_("UserRoles", r.role.userRoleId, { status: "REVOKED", revokedAt: nowIso_(), revokedBy: p.email });
      // Ses sessions ne doivent plus donner accès à l'agence : le principal est recalculé à chaque appel, la révocation du rôle suffit.
    });
    dbUpdate_("Organizations", id, { billingEmail: email, contactName: name || x.org.contactName || "", updatedAt: nowIso_() });
  });
  const inv = invitationInsertAndSend_(p, { email: email, displayName: name || email.split("@")[0], organizationId: id, role: "AGENCY_ADMIN" }, dbGet_("Organizations", id));
  audit_("AGENCY_RESPONSIBLE_CHANGED", "Organization", id, x.owners[0], { from: cur.roles.map(function (r) { return r.user.email; }).concat(cur.invites.map(function (i) { return i.email; })), to: email, emailSent: inv.emailSent });
  return { changed: true, email: email, emailSent: inv.emailSent, emailError: inv.emailError };
}
/** Renvoyer le lien d'activation au responsable (invitation en attente, ou compte jamais activé). */
function ownerAgencyResendInvite_(p, a) {
  const x = ownerAgencyLoad_(p, a.agencyOrganizationId);
  if (!x.creator) forbid_("Réservé aux agences que vous avez créées.");
  const id = String(x.org.organizationId), cur = ownerAgencyResponsibles_(id);
  rateLimit_("agency-resend:" + id, 5, 3600);
  if (cur.invites.length) {
    const last = cur.invites[cur.invites.length - 1];
    withLock_(function () { cur.invites.forEach(function (i) { dbUpdate_("Invitations", i.invitationId, { status: "REVOKED", revokedAt: nowIso_(), tokenHash: "" }); }); });
    const inv = invitationInsertAndSend_(p, { email: last.email, displayName: last.displayName, organizationId: id, role: "AGENCY_ADMIN" }, x.org);
    audit_("AGENCY_INVITE_RESENT", "Organization", id, x.owners[0], { email: last.email, emailSent: inv.emailSent });
    return { ok: true, email: last.email, emailSent: inv.emailSent, emailError: inv.emailError };
  }
  const notActivated = cur.roles.find(function (r) { return !r.user.passwordHash; });
  if (notActivated) { sendPasswordLink_(notActivated.user, "ACTIVATION"); audit_("AGENCY_INVITE_RESENT", "Organization", id, x.owners[0], { email: notActivated.user.email }); return { ok: true, email: notActivated.user.email, emailSent: true }; }
  assert_(cur.roles.length, "Aucun responsable : indiquez son e-mail dans « Modifier la fiche ».");
  throw new AppError("VALIDATION", "Le compte du responsable est déjà activé : il se connecte avec son mot de passe (en cas d'oubli, « Mot de passe oublié » sur l'écran de connexion).");
}
/** Retirer l'accès de l'agence à TOUS mes biens (immédiat ; l'historique est conservé). */
function ownerAgencyRevokeAll_(p, a) {
  const x = ownerAgencyLoad_(p, a.agencyOrganizationId);
  const active = dbAll_("AgencyPropertyPermissions").filter(function (z) { return String(z.agencyOrganizationId) === String(x.org.organizationId) && x.owners.indexOf(String(z.ownerOrganizationId)) >= 0 && z.status === "ACTIVE"; });
  active.forEach(function (z) { propertyAgencySet_(p, { propertyId: z.propertyId, agencyOrganizationId: x.org.organizationId, canView: false }); });
  audit_("AGENCY_ACCESS_REVOKED_ALL", "Organization", x.org.organizationId, x.owners[0], { properties: active.length });
  return { ok: true, revoked: active.length };
}
/**
 * Supprimer une agence que l'on a créée. Non destructif : accès à mes biens retirés, invitations en attente révoquées,
 * comptes de l'agence désactivés pour cette organisation, organisation passée « inactive » ; l'historique reste consultable.
 * Refusé si l'agence travaille aussi pour d'autres propriétaires (on retire alors seulement ses accès à mes biens).
 */
function ownerAgencyDelete_(p, a) {
  const x = ownerAgencyLoad_(p, a.agencyOrganizationId);
  if (!x.creator) forbid_("Vous pouvez supprimer uniquement les agences que vous avez créées. Pour les autres, utilisez « Retirer tous les accès ».");
  const id = String(x.org.organizationId);
  const elsewhere = dbAll_("AgencyPropertyPermissions").some(function (z) { return String(z.agencyOrganizationId) === id && z.status === "ACTIVE" && x.owners.indexOf(String(z.ownerOrganizationId)) < 0; });
  assert_(!elsewhere, "Cette agence gère aussi les biens d'autres propriétaires : elle ne peut pas être supprimée. Utilisez « Retirer tous les accès » pour couper ses accès à vos biens.");
  const revoked = ownerAgencyRevokeAll_(p, a).revoked;
  withLock_(function () {
    dbAll_("Invitations").filter(function (i) { return String(i.organizationId) === id && (i.status === "PENDING" || i.status === "EMAIL_FAILED"); })
      .forEach(function (i) { dbUpdate_("Invitations", i.invitationId, { status: "REVOKED", revokedAt: nowIso_(), tokenHash: "" }); });
    dbAll_("UserRoles").filter(function (r) { return String(r.organizationId) === id && r.status === "ACTIVE"; })
      .forEach(function (r) { dbUpdate_("UserRoles", r.userRoleId, { status: "REVOKED", revokedAt: nowIso_(), revokedBy: p.email }); });
    dbUpdate_("Organizations", id, { status: "INACTIVE", suspendedAt: nowIso_(), suspensionReason: "Supprimée par le propriétaire " + p.email, updatedAt: nowIso_() });
  });
  audit_("AGENCY_DELETED_BY_OWNER", "Organization", id, x.owners[0], { name: x.org.name, propertiesRevoked: revoked });
  return { ok: true, revoked: revoked };
}
