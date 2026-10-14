/**
 * Authentification applicative.
 *
 * Pourquoi pas l'identité Google seule ? Avec un déploiement « Exécuter en tant que : moi » et « Accès : tout le monde »,
 * Session.getActiveUser() est VIDE pour les comptes extérieurs au domaine du propriétaire du script. Elle ne peut donc
 * pas servir d'identité pour un SaaS ouvert. ImmoPilot utilise des comptes applicatifs :
 *  - mot de passe haché PBKDF2-HMAC-SHA256 avec sel aléatoire (jamais stocké en clair) ;
 *  - jeton de session aléatoire de 256 bits, seul son SHA-256 est stocké (feuille Sessions), expiration configurable ;
 *  - l'identité provient UNIQUEMENT du jeton vérifié côté serveur, jamais d'un e-mail transmis par le navigateur ;
 *  - verrouillage après 5 échecs (15 min) + limitation par CacheService ;
 *  - possession de l'adresse e-mail prouvée par un lien à usage unique (invitation / activation / réinitialisation).
 */
var LOGIN_MAX_FAILS_ = 5;
var LOGIN_LOCK_MINUTES_ = 15;

function pbkdfIters_() { if (TEST_HOOKS_.pbkdfIters) return TEST_HOOKS_.pbkdfIters; return Math.max(1000, parseInt(PropertiesService.getScriptProperties().getProperty(IMMO_CONFIG.PBKDF_ITERATIONS_PROPERTY), 10) || 2000); }
function hexToBytes_(hex) { const out = []; for (let i = 0; i < hex.length; i += 2) { let v = parseInt(hex.substr(i, 2), 16); if (v > 127) v -= 256; out.push(v); } return out; }

/** PBKDF2-HMAC-SHA256, une sortie de 32 octets (RFC 8018). */
function pbkdf2Hex_(password, saltHex, iters) {
  const pw = Utilities.newBlob(String(password)).getBytes();
  const salt = hexToBytes_(saltHex);
  let u = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, salt.concat([0, 0, 0, 1]), pw);
  const t = u.slice();
  for (let i = 1; i < iters; i++) {
    u = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, u, pw);
    for (let j = 0; j < t.length; j++) t[j] = t[j] ^ u[j];
  }
  return bytesToHex_(t);
}
function validatePassword_(pw) {
  pw = String(pw || "");
  assert_(pw.length >= 10 && pw.length <= 128, "Le mot de passe doit contenir entre 10 et 128 caractères.");
  assert_(/[a-zA-Z]/.test(pw) && /\d/.test(pw), "Le mot de passe doit contenir au moins une lettre et un chiffre.");
  return pw;
}
function setUserPassword_(userId, pw) {
  validatePassword_(pw);
  const salt = sha256Hex_(randomToken_()).slice(0, 32), iters = pbkdfIters_();
  dbUpdate_("Users", userId, { passwordHash: pbkdf2Hex_(pw, salt, iters), passwordSalt: salt, passwordIters: iters, failedAttempts: 0, lockedUntil: "", pwChangedAt: nowIso_(), updatedAt: nowIso_() });
}
function verifyPassword_(user, pw) {
  if (!user || !user.passwordHash || !user.passwordSalt) return false;
  return safeEq_(pbkdf2Hex_(String(pw || ""), user.passwordSalt, Number(user.passwordIters) || pbkdfIters_()), user.passwordHash);
}

function rateLimit_(bucket, max, seconds) {
  const c = CacheService.getScriptCache(), k = "rl_" + sha256Hex_(bucket).slice(0, 40);
  const n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), seconds);
  if (n > max) throw new AppError("RATE_LIMIT", "Trop de tentatives. Patientez quelques minutes.");
}

function createSession_(user, userAgent) {
  const token = randomToken_(), hours = Number(getSetting_("session.hours")) || 12;
  dbInsert_("Sessions", { userId: user.userId, tokenHash: sha256Hex_(token), createdAt: nowIso_(), expiresAt: new Date(Date.now() + hours * 3600000).toISOString(), lastSeenAt: nowIso_(), userAgent: safeText_(userAgent || "", 200) });
  return token;
}

/** Résout le jeton de session en principal. Aucune donnée d'autorisation n'est mise en cache entre deux appels. */
function principalFromToken_(token) {
  token = String(token || "");
  if (!/^[a-f0-9]{64}$/.test(token)) throw new AppError("AUTH", "Session invalide. Veuillez vous reconnecter.");
  const h = sha256Hex_(token);
  const s = dbAll_("Sessions").find(function (x) { return x.tokenHash === h; });
  if (!s || s.revokedAt || !parseTs_(s.expiresAt) || parseTs_(s.expiresAt).getTime() < Date.now()) throw new AppError("AUTH", "Session expirée. Veuillez vous reconnecter.");
  const user = dbGet_("Users", s.userId);
  if (!user || user.status !== "ACTIVE") throw new AppError("AUTH", "Compte inactif ou suspendu.");
  const p = buildPrincipal_(user);
  if (!p.roles.length) throw new AppError("AUTH", "Aucun rôle actif n'est attribué à ce compte, ou votre organisation est suspendue.");
  p.sessionId = s.sessionId;
  const last = parseTs_(s.lastSeenAt);
  if (!last || Date.now() - last.getTime() > 10 * 60000) dbUpdate_("Sessions", s.sessionId, { lastSeenAt: nowIso_() });
  return p;
}

/* ---------------------- Points d'entrée publics (via apiPublic) ---------------------- */
function authLogin_(args) {
  const email = validateEmail_(args.email), pw = String(args.password || "");
  rateLimit_("login:" + email, 10, 600);
  const user = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === email; });
  const generic = new AppError("AUTH", "Identifiants invalides.");
  if (!user) { pbkdf2Hex_(pw, "00", 50); throw generic; }
  const locked = parseTs_(user.lockedUntil);
  if (locked && locked.getTime() > Date.now()) throw new AppError("LOCKED", "Compte temporairement verrouillé après plusieurs échecs. Réessayez plus tard ou réinitialisez votre mot de passe.");
  if (!user.passwordHash) throw new AppError("AUTH", "Compte non activé. Utilisez le lien d'invitation ou « Mot de passe oublié » pour définir votre mot de passe.");
  if (!verifyPassword_(user, pw)) {
    const fails = (Number(user.failedAttempts) || 0) + 1;
    dbUpdate_("Users", user.userId, { failedAttempts: fails, lockedUntil: fails >= LOGIN_MAX_FAILS_ ? new Date(Date.now() + LOGIN_LOCK_MINUTES_ * 60000).toISOString() : "" });
    auditAs_(email, user.userId, "LOGIN_FAILED", "User", user.userId, "", { fails: fails }, "FAIL");
    throw generic;
  }
  if (user.status !== "ACTIVE") { auditAs_(email, user.userId, "LOGIN_REFUSED_STATUS", "User", user.userId, "", { status: user.status }, "FAIL"); throw new AppError("AUTH", "Compte suspendu ou désactivé."); }
  const p = buildPrincipal_(user);
  if (!p.roles.length) throw new AppError("AUTH", "Aucun rôle actif, ou organisation suspendue.");
  dbUpdate_("Users", user.userId, { failedAttempts: 0, lockedUntil: "", lastLoginAt: nowIso_() });
  const token = createSession_(user, args.userAgent);
  auditAs_(email, user.userId, "LOGIN_SUCCESS", "User", user.userId, "", {});
  CTX_.principal = p;
  return { token: token, me: meBootstrap_(p) };
}

function authRequestReset_(args) {
  const email = validateEmail_(args.email);
  rateLimit_("reset:" + email, 3, 3600);
  const user = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === email && u.status === "ACTIVE"; });
  if (user) sendPasswordLink_(user, user.passwordHash ? "RESET" : "ACTIVATION");
  return { ok: true, message: "Si un compte actif correspond à cette adresse, un lien vient d'être envoyé (valable 1 heure)." };
}

/** Crée un jeton de réinitialisation/activation et l'envoie par e-mail. Retourne l'URL (utile pour la console d'installation). */
function sendPasswordLink_(user, purpose) {
  const token = randomToken_();
  dbAll_("PasswordResets").filter(function (r) { return String(r.userId) === String(user.userId) && !r.usedAt; })
    .forEach(function (r) { dbUpdate_("PasswordResets", r.resetId, { usedAt: nowIso_() }); });
  const hours = purpose === "ACTIVATION" ? 72 : 1;
  dbInsert_("PasswordResets", { userId: user.userId, tokenHash: sha256Hex_(token), createdAt: nowIso_(), expiresAt: new Date(Date.now() + hours * 3600000).toISOString(), usedAt: "", purpose: purpose });
  const url = appUrl_() + "?action=reset&token=" + token;
  const subject = purpose === "ACTIVATION" ? "Activez votre compte ImmoPilot" : "Réinitialisation de votre mot de passe ImmoPilot";
  const body = "Bonjour " + (user.displayName || "") + ",\n\n" + (purpose === "ACTIVATION" ? "Définissez votre mot de passe pour activer votre compte" : "Une réinitialisation de mot de passe a été demandée") +
    " (lien valable " + hours + " h, utilisable une seule fois) :\n" + url + "\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nImmoPilot";
  sendMailSafe_(user.email, subject, body, "auth:" + purpose + ":" + user.userId + ":" + Date.now());
  auditAs_("", user.userId, "PASSWORD_LINK_" + purpose, "User", user.userId, "", {});
  return url;
}

function authResetPassword_(args) {
  const token = String(args.token || "");
  assert_(/^[a-f0-9]{64}$/.test(token), "Lien invalide.");
  rateLimit_("resetuse:" + token.slice(0, 16), 10, 3600);
  return withLock_(function () {
    const h = sha256Hex_(token);
    const r = dbAll_("PasswordResets").find(function (x) { return x.tokenHash === h; });
    assert_(r && !r.usedAt, "Lien invalide ou déjà utilisé.", "AUTH");
    assert_(parseTs_(r.expiresAt).getTime() > Date.now(), "Lien expiré. Faites une nouvelle demande.", "AUTH");
    const user = dbGet_("Users", r.userId);
    assert_(user && user.status === "ACTIVE", "Compte inactif.", "AUTH");
    setUserPassword_(user.userId, args.password);
    dbUpdate_("PasswordResets", r.resetId, { usedAt: nowIso_() });
    revokeAllSessions_(user.userId);
    auditAs_(user.email, user.userId, "PASSWORD_SET", "User", user.userId, "", { purpose: r.purpose });
    return { ok: true, message: "Mot de passe enregistré. Vous pouvez vous connecter." };
  });
}

function revokeAllSessions_(userId) {
  dbAll_("Sessions").filter(function (s) { return String(s.userId) === String(userId) && !s.revokedAt; })
    .forEach(function (s) { dbUpdate_("Sessions", s.sessionId, { revokedAt: nowIso_() }); });
}

/* ---------------------- Routes authentifiées ---------------------- */
function meLogout_(p) { dbUpdate_("Sessions", p.sessionId, { revokedAt: nowIso_() }); audit_("LOGOUT", "User", p.userId, ""); return { ok: true }; }
function meLogoutAll_(p) { revokeAllSessions_(p.userId); audit_("LOGOUT_ALL", "User", p.userId, ""); return { ok: true }; }
function meChangePassword_(p, a) {
  const user = dbGet_("Users", p.userId);
  rateLimit_("chpw:" + p.userId, 5, 900);
  if (!verifyPassword_(user, a.currentPassword)) { audit_("PASSWORD_CHANGE_FAILED", "User", p.userId, "", {}, "FAIL"); throw new AppError("AUTH", "Mot de passe actuel incorrect."); }
  setUserPassword_(p.userId, a.newPassword);
  dbAll_("Sessions").filter(function (s) { return String(s.userId) === p.userId && !s.revokedAt && s.sessionId !== p.sessionId; })
    .forEach(function (s) { dbUpdate_("Sessions", s.sessionId, { revokedAt: nowIso_() }); });
  audit_("PASSWORD_CHANGED", "User", p.userId, "");
  return { ok: true };
}
function meUpdateProfile_(p, a) {
  const patch = { updatedAt: nowIso_() };
  if (a.displayName !== undefined) patch.displayName = reqText_(a.displayName, "Nom", 2, 100);
  if (a.locale !== undefined) patch.locale = oneOf_(a.locale, ["fr", "en", "ar"], "Langue");
  if (a.phone !== undefined) patch.phone = safeText_(a.phone, 30);
  if (a.notifPrefs !== undefined) {
    const np = a.notifPrefs || {};
    patch.notifPrefsJson = { email: np.email !== false, inApp: true, mutedTypes: Array.isArray(np.mutedTypes) ? np.mutedTypes.slice(0, 40).map(function (x) { return safeText_(x, 60); }) : [] };
  }
  dbUpdate_("Users", p.userId, patch);
  audit_("PROFILE_UPDATED", "User", p.userId, "", { fields: Object.keys(patch) });
  return { ok: true };
}

/** Données d'amorçage de l'interface : identité, rôles, organisations, capacités d'affichage. */
function meBootstrap_(p) {
  const orgs = indexBy_(dbAll_("Organizations"), "organizationId");
  const user = dbGet_("Users", p.userId);
  const unread = dbAll_("Notifications").filter(function (n) { return String(n.userId) === p.userId && !n.readAt; }).length;
  return {
    userId: p.userId, email: p.email, displayName: p.displayName, locale: (user && user.locale) || "fr", isSuper: p.isSuper,
    roles: p.roles.map(function (r) { return { role: r.role, organizationId: r.organizationId, organizationName: (orgs[r.organizationId] || {}).name || "" }; }),
    caps: uiCaps_(p).concat(p.isSuper ? ["platform.admin"] : []),
    notifPrefs: parseJson_(user && user.notifPrefsJson, { email: true, mutedTypes: [] }),
    unreadNotifications: unread, appName: IMMO_CONFIG.APP_NAME, version: IMMO_CONFIG.VERSION,
    currency: getSetting_("currency"), timezone: tz_(), today: todayStr_(),
    supportGrants: p.grants.map(function (g) { return { organizationId: g.organizationId, expiresAt: g.expiresAt }; }),
    lists: { incidentCategories: getSetting_("list.incidentCategories"), expenseCategories: getSetting_("list.expenseCategories"),
      cancelReasons: getSetting_("list.cancelReasons"), cleaningAnomalies: getSetting_("list.cleaningAnomalies"), specialties: getSetting_("list.specialties") }
  };
}
