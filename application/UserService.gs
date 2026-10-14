/**
 * Utilisateurs, invitations, rôles et permissions.
 * Prévention de l'élévation de privilèges :
 *  - aucun rôle SUPER_ADMIN ne peut être attribué depuis l'application (uniquement createFirstSuperAdmin, depuis l'éditeur) ;
 *  - on ne peut inviter que les rôles listés dans INVITABLE_ROLES pour son propre rôle, dans sa propre organisation ;
 *  - les surcharges de permissions ne peuvent que retirer des capacités ; on ne peut pas modifier ses propres rôles.
 */
/** Durée de validité d'une invitation (jours). Fonction et non variable : le fichier ne déclare aucune variable globale. */
function inviteDays_() { return 7; }

function bestRoleIn_(p, orgId) {
  const order = ["SUPER_ADMIN", "OWNER", "AGENCY_ADMIN"];
  if (p.isSuper) return "SUPER_ADMIN";
  for (let i = 0; i < order.length; i++) if (hasRole_(p, order[i], orgId)) return order[i];
  return "";
}
function assertCanGrantRole_(p, orgId, role) {
  assertValidRole_(role);
  assert_(role !== "SUPER_ADMIN", "Le rôle SUPER_ADMIN ne peut pas être attribué depuis l'application.", "FORBIDDEN");
  if (!p.isSuper) assertOrgCap_(p, orgId, "user.invite");
  const best = bestRoleIn_(p, orgId);
  const allowed = INVITABLE_ROLES[best] || [];
  if (allowed.indexOf(role) < 0) forbid_("Vous ne pouvez pas attribuer le rôle " + role + " dans cette organisation.");
  const org = dbGet_("Organizations", orgId);
  assert_(org && org.status === "ACTIVE", "Organisation inactive ou introuvable.");
  return org;
}
function assertValidRole_(role) { assert_(IMMO_CONFIG.ROLES.indexOf(String(role)) >= 0, "Rôle inconnu."); return role; }
function sanitizeRemovals_(role, list) {
  if (!Array.isArray(list)) return [];
  const base = ROLE_CAPS[role] || [];
  return list.map(function (c) { return String(c).replace(/^-/, ""); }).filter(function (c) { return base.indexOf(c) >= 0; }).map(function (c) { return "-" + c; });
}
function appUrl_() {
  if (TEST_HOOKS_.appUrl) return TEST_HOOKS_.appUrl;
  const fixed = normalizeAppUrl_(PropertiesService.getScriptProperties().getProperty(IMMO_CONFIG.APP_URL_PROPERTY));
  if (fixed) return fixed;
  let u = "";
  try { u = ScriptApp.getService().getUrl() || ""; } catch (e) { u = ""; }
  assert_(/^https:\/\//.test(u), "Adresse de l'application inconnue : déployez l'application web et renseignez IMMO_APP_URL avec l'URL complète se terminant par /exec.", "CONFIG");
  return u;
}
/**
 * Accepte l'URL complète (https://script.google.com/macros/s/…/exec) ou, par erreur fréquente, le seul identifiant
 * de déploiement (AKfycb…) : l'URL complète est alors reconstruite. Toute autre valeur est ignorée (retour "").
 */
function normalizeAppUrl_(raw) {
  let v = String(raw || "").trim().replace(/^["'<\s]+|["'>\s]+$/g, "");
  if (!v) return "";
  if (/^https:\/\/script\.google\.com\/\S+$/.test(v)) return v.replace(/\/dev(\?.*)?$/, "/exec").replace(/\?.*$/, "");
  if (/^https:\/\/\S+$/.test(v)) return v.replace(/\?.*$/, "");
  if (/^script\.google\.com\//.test(v)) return normalizeAppUrl_("https://" + v);
  if (/^[A-Za-z0-9_-]{30,}$/.test(v)) return "https://script.google.com/macros/s/" + v + "/exec";
  return "";
}

function inviteCreate_(p, a) {
  const email = validateEmail_(a.email), orgId = safeText_(a.organizationId, 120), role = String(a.role || "");
  const org = assertCanGrantRole_(p, orgId, role);
  assertQuota_(orgId, "users");
  let propertyId = "";
  if (a.propertyId) { assert_(["GUARD", "CLEANER", "ARTISAN", "TENANT"].indexOf(role) >= 0, "Seuls les rôles de terrain peuvent être liés à un bien."); propertyId = assertProp_(p, a.propertyId, "property.assign").propertyId; }
  return invitationInsertAndSend_(p, { email: email, displayName: a.displayName, organizationId: orgId, role: role, removedCaps: a.removedCaps, propertyId: propertyId }, org);
}
/**
 * Enregistre une invitation (jeton à usage unique, haché) et envoie l'e-mail. Les droits de l'invitant doivent avoir été
 * vérifiés AVANT l'appel (inviteCreate_, ou création d'agence par un propriétaire).
 */
function invitationInsertAndSend_(p, a, org) {
  const email = validateEmail_(a.email), orgId = String(a.organizationId), role = String(a.role), propertyId = a.propertyId || "";
  const displayName = safeText_(a.displayName || email.split("@")[0], 100);
  const token = randomToken_();
  const inv = withLock_(function () {
    const existing = dbAll_("Invitations").find(function (i) { return normalizeEmail_(i.email) === email && String(i.organizationId) === orgId && i.role === role && i.status === "PENDING" && parseTs_(i.expiresAt) && parseTs_(i.expiresAt).getTime() > Date.now(); });
    assert_(!existing, "Une invitation est déjà en attente pour cet e-mail, ce rôle et cette organisation. Révoquez-la ou renvoyez-la.");
    const user = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === email; });
    if (user) assert_(!dbAll_("UserRoles").some(function (r) { return String(r.userId) === String(user.userId) && String(r.organizationId) === orgId && r.role === role && r.status === "ACTIVE"; }), "Cette personne possède déjà ce rôle dans l'organisation.");
    return dbInsert_("Invitations", { email: email, displayName: displayName, organizationId: orgId, role: role, tokenHash: sha256Hex_(token), status: "PENDING",
      expiresAt: new Date(Date.now() + inviteDays_() * 86400000).toISOString(), createdAt: nowIso_(), createdBy: p.email, acceptedAt: "", revokedAt: "",
      permissionsJson: sanitizeRemovals_(role, a.removedCaps), propertyId: propertyId });
  });
  const sent = sendInvitationEmail_(inv, token, org, p);
  audit_("INVITATION_SENT", "Invitation", inv.invitationId, orgId, { email: email, role: role, emailSent: sent.ok });
  return { ok: true, invitationId: inv.invitationId, emailSent: sent.ok, emailError: sent.error || "", status: sent.ok ? "PENDING" : "EMAIL_FAILED" };
}
function sendInvitationEmail_(inv, token, org, p) {
  const url = appUrl_() + "?action=accept&token=" + token;
  const body = "Bonjour " + inv.displayName + ",\n\n" + p.displayName + " vous invite à rejoindre ImmoPilot.\n\nOrganisation : " + org.name + "\nRôle : " + inv.role +
    "\n\nAcceptez l'invitation avec ce lien personnel, à usage unique, valable " + inviteDays_() + " jours :\n" + url +
    "\n\nSi vous n'attendiez pas cette invitation, ignorez ce message.\n\nImmoPilot";
  const r = sendMailSafe_(inv.email, "Invitation à rejoindre ImmoPilot — " + org.name, body, "invite:" + inv.invitationId + ":" + inv.tokenHash.slice(0, 8));
  if (!r.ok) dbUpdate_("Invitations", inv.invitationId, { status: "EMAIL_FAILED" });
  return r;
}
function inviteResend_(p, a) {
  const inv = dbGet_("Invitations", safeText_(a.invitationId, 120));
  if (!inv) notFound_("Invitation");
  const org = assertCanGrantRole_(p, inv.organizationId, inv.role);
  assert_(["PENDING", "EMAIL_FAILED", "EXPIRED"].indexOf(inv.status) >= 0, "Cette invitation ne peut plus être renvoyée.");
  const token = randomToken_();
  dbUpdate_("Invitations", inv.invitationId, { tokenHash: sha256Hex_(token), status: "PENDING", expiresAt: new Date(Date.now() + inviteDays_() * 86400000).toISOString() });
  const fresh = dbGet_("Invitations", inv.invitationId);
  const r = sendInvitationEmail_(fresh, token, org, p);
  audit_("INVITATION_RESENT", "Invitation", inv.invitationId, inv.organizationId, { emailSent: r.ok });
  return { ok: true, emailSent: r.ok, emailError: r.error || "" };
}
function inviteRevoke_(p, a) {
  const inv = dbGet_("Invitations", safeText_(a.invitationId, 120));
  if (!inv) notFound_("Invitation");
  if (!p.isSuper) assertOrgCap_(p, inv.organizationId, "user.invite");
  assert_(["PENDING", "EMAIL_FAILED"].indexOf(inv.status) >= 0, "Cette invitation ne peut plus être révoquée.");
  dbUpdate_("Invitations", inv.invitationId, { status: "REVOKED", revokedAt: nowIso_(), tokenHash: "" });
  audit_("INVITATION_REVOKED", "Invitation", inv.invitationId, inv.organizationId, { email: inv.email });
  return { ok: true };
}
function inviteList_(p, a) {
  a = a || {};
  const orgs = indexBy_(dbAll_("Organizations"), "organizationId");
  const rows = dbAll_("Invitations").filter(function (i) {
    if (a.organizationId && String(i.organizationId) !== String(a.organizationId)) return false;
    return p.isSuper || hasOrgCap_(p, i.organizationId, "user.invite");
  }).map(function (i) {
    const expired = i.status === "PENDING" && parseTs_(i.expiresAt) && parseTs_(i.expiresAt).getTime() < Date.now();
    return { invitationId: i.invitationId, email: i.email, displayName: i.displayName, organizationId: i.organizationId, organizationName: (orgs[i.organizationId] || {}).name || "",
      role: i.role, status: expired ? "EXPIRED" : i.status, expiresAt: i.expiresAt, createdAt: i.createdAt, createdBy: i.createdBy, acceptedAt: i.acceptedAt };
  }).filter(function (i) { return (!a.status || i.status === a.status) && matchesQuery_(a.q, [i.email, i.displayName, i.organizationName]); })
    .sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); });
  return pageOf_(rows, a);
}

/* ------------- Routes publiques d'acceptation (le jeton est la seule preuve) ------------- */
function inviteFromToken_(token) {
  token = String(token || "");
  assert_(/^[a-f0-9]{64}$/.test(token), "Lien d'invitation invalide.", "AUTH");
  const h = sha256Hex_(token);
  const inv = dbAll_("Invitations").find(function (i) { return i.tokenHash && safeEq_(i.tokenHash, h); });
  assert_(inv, "Invitation invalide, déjà utilisée ou révoquée.", "AUTH");
  assert_(inv.status === "PENDING", "Cette invitation n'est plus active.", "AUTH");
  assert_(parseTs_(inv.expiresAt) && parseTs_(inv.expiresAt).getTime() > Date.now(), "Cette invitation a expiré. Demandez-en une nouvelle.", "EXPIRED");
  return inv;
}
function inviteInfo_(a) {
  rateLimit_("invinfo:" + String(a.token || "").slice(0, 16), 20, 600);
  const inv = inviteFromToken_(a.token), org = dbGet_("Organizations", inv.organizationId);
  const user = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === normalizeEmail_(inv.email); });
  return { email: inv.email, displayName: inv.displayName, organizationName: org ? org.name : "", role: inv.role, expiresAt: inv.expiresAt,
    existingAccount: !!(user && user.passwordHash) };
}
function inviteAccept_(a) {
  rateLimit_("invaccept:" + String(a.token || "").slice(0, 16), 10, 600);
  return withLock_(function () {
    const inv = inviteFromToken_(a.token);
    const org = dbGet_("Organizations", inv.organizationId);
    assert_(org && org.status === "ACTIVE", "Organisation inactive.");
    let user = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === normalizeEmail_(inv.email); });
    if (user && user.passwordHash) {
      // Compte existant : la personne prouve qu'elle détient le compte avant qu'un nouveau rôle y soit ajouté.
      if (!verifyPassword_(user, a.currentPassword)) throw new AppError("AUTH", "Mot de passe du compte existant incorrect.");
      assert_(user.status !== "DISABLED", "Compte désactivé : contactez l'administrateur.");
    } else {
      validatePassword_(a.password);
      const displayName = safeText_(a.displayName || inv.displayName, 100) || inv.email.split("@")[0];
      if (!user) user = dbInsert_("Users", { email: normalizeEmail_(inv.email), displayName: displayName, status: "ACTIVE", createdAt: nowIso_(), createdBy: "invitation:" + inv.invitationId, locale: org.locale || "fr", notifPrefsJson: { email: true, mutedTypes: [] } });
      else dbUpdate_("Users", user.userId, { displayName: displayName, status: user.status === "DISABLED" ? "DISABLED" : "ACTIVE" });
      setUserPassword_(user.userId, a.password);
    }
    const already = dbAll_("UserRoles").find(function (r) { return String(r.userId) === String(user.userId) && String(r.organizationId) === String(inv.organizationId) && r.role === inv.role && r.status === "ACTIVE"; });
    if (!already) dbInsert_("UserRoles", { userId: user.userId, organizationId: inv.organizationId, role: inv.role, status: "ACTIVE", createdAt: nowIso_(), createdBy: "invitation:" + inv.invitationId, permissionsJson: inv.permissionsJson || "[]" });
    if (inv.propertyId) {
      const exists = dbAll_("PropertyAssignments").some(function (x) { return String(x.propertyId) === String(inv.propertyId) && String(x.userId) === String(user.userId) && x.role === inv.role && x.status === "ACTIVE"; });
      if (!exists) dbInsert_("PropertyAssignments", { propertyId: inv.propertyId, reservationId: "", userId: user.userId, email: normalizeEmail_(inv.email), role: inv.role, status: "ACTIVE", createdAt: nowIso_(), createdBy: "invitation:" + inv.invitationId });
    }
    if (inv.role === "ARTISAN") dbAll_("Artisans").filter(function (x) { return normalizeEmail_(x.email) === normalizeEmail_(inv.email) && !x.userId; }).forEach(function (x) { dbUpdate_("Artisans", x.artisanId, { userId: user.userId }); });
    if (inv.role === "TENANT") dbAll_("Tenants").filter(function (x) { return normalizeEmail_(x.email) === normalizeEmail_(inv.email) && !x.userId; }).forEach(function (x) { dbUpdate_("Tenants", x.tenantId, { userId: user.userId }); });
    dbUpdate_("Invitations", inv.invitationId, { status: "ACCEPTED", acceptedAt: nowIso_(), tokenHash: "" });
    auditAs_(inv.email, user.userId, "INVITATION_ACCEPTED", "Invitation", inv.invitationId, inv.organizationId, { role: inv.role });
    return { ok: true, message: "Invitation acceptée. Connectez-vous avec " + inv.email + ".", email: inv.email };
  });
}

/* ------------- Gestion des utilisateurs d'une organisation ------------- */
function userList_(p, a) {
  a = a || {};
  const orgId = safeText_(a.organizationId || "", 120);
  if (orgId && !p.isSuper) assertOrgCap_(p, orgId, "user.manage");
  const visibleOrgs = p.isSuper ? null : p.roles.filter(function (r) { return r.caps.indexOf("user.manage") >= 0; }).map(function (r) { return r.organizationId; });
  const users = indexBy_(dbAll_("Users"), "userId"), orgs = indexBy_(dbAll_("Organizations"), "organizationId");
  const rows = dbAll_("UserRoles").filter(function (r) {
    if (orgId && String(r.organizationId) !== orgId) return false;
    return visibleOrgs === null || visibleOrgs.indexOf(String(r.organizationId)) >= 0;
  }).map(function (r) {
    const u = users[r.userId] || {};
    return { userRoleId: r.userRoleId, userId: r.userId, email: u.email || "", displayName: u.displayName || "", userStatus: u.status || "", role: r.role,
      roleStatus: r.status, organizationId: r.organizationId, organizationName: (orgs[r.organizationId] || {}).name || "", removedCaps: parseJson_(r.permissionsJson, []),
      lastLoginAt: u.lastLoginAt || "", activated: !!u.passwordHash, createdAt: r.createdAt };
  }).filter(function (x) { return (!a.role || x.role === a.role) && (!a.status || x.roleStatus === a.status) && matchesQuery_(a.q, [x.email, x.displayName, x.organizationName]); })
    .sort(function (x, y) { return String(x.organizationName + x.email).localeCompare(String(y.organizationName + y.email)); });
  return pageOf_(rows, a);
}
function roleTarget_(p, userRoleId, cap) {
  const r = dbGet_("UserRoles", safeText_(userRoleId, 120));
  if (!r) notFound_("Rôle");
  assert_(r.role !== "SUPER_ADMIN", "Le rôle SUPER_ADMIN ne se gère pas depuis l'application.", "FORBIDDEN");
  assert_(String(r.userId) !== p.userId, "Vous ne pouvez pas modifier vos propres droits.", "FORBIDDEN");
  if (!p.isSuper) {
    assertOrgCap_(p, r.organizationId, cap);
    if ((INVITABLE_ROLES[bestRoleIn_(p, r.organizationId)] || []).indexOf(r.role) < 0) forbid_("Vous ne pouvez pas gérer ce rôle.");
  }
  return r;
}
function roleSetStatus_(p, a) {
  const r = roleTarget_(p, a.userRoleId, "user.manage");
  const status = oneOf_(a.status, ["ACTIVE", "SUSPENDED", "REVOKED"], "Statut");
  dbUpdate_("UserRoles", r.userRoleId, { status: status, revokedAt: status === "ACTIVE" ? "" : nowIso_(), revokedBy: status === "ACTIVE" ? "" : p.email });
  if (status !== "ACTIVE") dbAll_("PropertyAssignments").filter(function (x) {
    const prop = dbGet_("Properties", x.propertyId);
    return String(x.userId) === String(r.userId) && x.role === r.role && x.status === "ACTIVE" && prop && String(prop.organizationId) === String(r.organizationId);
  }).forEach(function (x) { dbUpdate_("PropertyAssignments", x.assignmentId, { status: "REVOKED", revokedAt: nowIso_(), revokedBy: p.email }); });
  audit_("ROLE_STATUS_" + status, "UserRole", r.userRoleId, r.organizationId, { userId: r.userId, role: r.role });
  return { ok: true };
}
function roleSetPermissions_(p, a) {
  const r = roleTarget_(p, a.userRoleId, "user.manage");
  const removals = sanitizeRemovals_(r.role, a.removedCaps);
  dbUpdate_("UserRoles", r.userRoleId, { permissionsJson: removals });
  audit_("ROLE_PERMISSIONS_UPDATED", "UserRole", r.userRoleId, r.organizationId, { removed: removals });
  return { ok: true, removedCaps: removals };
}
function roleCapsCatalog_(p, a) { assertValidRole_(a.role); return { role: a.role, caps: ROLE_CAPS[a.role] || [] }; }

/** Suspension globale d'un compte (super administrateur) : révoque aussi toutes ses sessions. */
function userSetStatus_(p, a) {
  requireSuper_(p);
  const u = dbGet_("Users", safeText_(a.userId, 120));
  if (!u) notFound_("Utilisateur");
  assert_(String(u.userId) !== p.userId, "Vous ne pouvez pas suspendre votre propre compte.");
  const status = oneOf_(a.status, ["ACTIVE", "SUSPENDED", "DISABLED"], "Statut");
  dbUpdate_("Users", u.userId, { status: status, updatedAt: nowIso_(), failedAttempts: 0, lockedUntil: "" });
  if (status !== "ACTIVE") revokeAllSessions_(u.userId);
  audit_("USER_STATUS_" + status, "User", u.userId, "", { email: u.email, reason: safeText_(a.reason, 300) });
  return { ok: true };
}
/** Renvoie un lien d'activation (comptes historiques sans mot de passe, ou compte bloqué). */
function userSendActivation_(p, a) {
  const u = dbGet_("Users", safeText_(a.userId, 120));
  if (!u) notFound_("Utilisateur");
  if (!p.isSuper) {
    const ok = dbAll_("UserRoles").some(function (r) { return String(r.userId) === String(u.userId) && r.status === "ACTIVE" && hasOrgCap_(p, r.organizationId, "user.manage"); });
    if (!ok) forbid_();
  }
  assert_(u.status === "ACTIVE", "Le compte doit être actif.");
  sendPasswordLink_(u, u.passwordHash ? "RESET" : "ACTIVATION");
  audit_("ACTIVATION_LINK_SENT", "User", u.userId, "", {});
  return { ok: true };
}

/* ---------------- Suppression de compte (exigence Google Play / loi 09-08) ---------------- */
/**
 * L'utilisateur demande la suppression de son compte depuis l'application (Paramètres › Mon profil).
 * La demande est journalisée et transmise aux super administrateurs, qui la traitent avec user.erase.
 */
function meRequestDeletion_(p, a) {
  rateLimit_("delete-request:" + p.userId, 3, 86400);
  if (p.isSuper) {
    const others = superAdminIds_().filter(function (id) { return String(id) !== p.userId; });
    assert_(others.length > 0, "Vous êtes le seul super administrateur : désignez-en un autre avant de demander la suppression de votre compte.");
  }
  const reason = safeText_(a.reason || "", 1000);
  audit_("ACCOUNT_DELETION_REQUESTED", "User", p.userId, "", { reason: reason });
  notify_({ eventKey: "delete-request:" + p.userId + ":" + todayStr_(), userIds: superAdminIds_(), type: "ACCOUNT_DELETION", organizationId: "",
    title: "Demande de suppression de compte : " + p.email, body: "Motif : " + (reason || "non précisé") + ". À traiter dans Utilisateurs › « Supprimer le compte ».", link: "#users" });
  return { ok: true, message: "Votre demande a été transmise. Le compte et les données personnelles associées seront supprimés dans un délai de 30 jours ; certaines données comptables peuvent être conservées pour des obligations légales." };
}
/**
 * Super administrateur : suppression (anonymisation) d'un compte. Les données personnelles du compte sont effacées
 * (nom, e-mail, téléphone, mot de passe, préférences) ; accès, sessions, invitations et liens en cours sont révoqués.
 * Les enregistrements métier (réservations, paiements, factures, journal) sont conservés pour les obligations légales,
 * sans données d'identification du compte. Irréversible.
 */
function userErase_(p, a) {
  requireSuper_(p);
  const u = dbGet_("Users", safeText_(a.userId, 120));
  if (!u) notFound_("Utilisateur");
  assert_(String(u.userId) !== p.userId, "Vous ne pouvez pas supprimer votre propre compte.");
  assert_(String(a.confirm || "") === "SUPPRIMER", "Confirmation attendue : tapez SUPPRIMER.");
  const oldEmail = normalizeEmail_(u.email);
  withLock_(function () {
    dbUpdate_("Users", u.userId, { displayName: "Compte supprimé", email: "supprime-" + String(u.userId).toLowerCase() + "@compte-supprime.invalid", phone: "", passwordHash: "", passwordSalt: "",
      status: "DISABLED", failedAttempts: 0, lockedUntil: "", notifPrefsJson: {}, updatedAt: nowIso_() });
    revokeAllSessions_(u.userId);
    dbAll_("UserRoles").filter(function (r) { return String(r.userId) === String(u.userId) && r.status !== "REVOKED"; })
      .forEach(function (r) { dbUpdate_("UserRoles", r.userRoleId, { status: "REVOKED", revokedAt: nowIso_(), revokedBy: p.email }); });
    dbAll_("PasswordResets").filter(function (r) { return String(r.userId) === String(u.userId) && !r.usedAt; })
      .forEach(function (r) { dbUpdate_("PasswordResets", r.resetId, { usedAt: nowIso_() }); });
    dbAll_("Invitations").filter(function (i) { return normalizeEmail_(i.email) === oldEmail && (i.status === "PENDING" || i.status === "EMAIL_FAILED"); })
      .forEach(function (i) { dbUpdate_("Invitations", i.invitationId, { status: "REVOKED", revokedAt: nowIso_(), tokenHash: "" }); });
    dbAll_("PropertyAssignments").filter(function (x) { return String(x.userId) === String(u.userId) && x.status === "ACTIVE"; })
      .forEach(function (x) { dbUpdate_("PropertyAssignments", x.assignmentId, { status: "REVOKED", revokedAt: nowIso_(), revokedBy: p.email }); });
  });
  // Trace sans donnée personnelle : empreinte de l'ancienne adresse (permet de prouver le traitement d'une demande).
  audit_("ACCOUNT_ERASED", "User", u.userId, "", { emailSha256: sha256Hex_(oldEmail), reason: safeText_(a.reason || "", 300) });
  return { ok: true };
}
