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

function pbkdfIters_() { if (TEST_HOOKS_.pbkdfIters) return TEST_HOOKS_.pbkdfIters; return Math.max(1000, parseInt(PropertiesService.getScriptProperties().getProperty(IMMO_CONFIG.PBKDF_ITERATIONS_PROPERTY), 10) || 10000); }
function hexToBytes_(hex) { const out = []; for (let i = 0; i < hex.length; i += 2) { let v = parseInt(hex.substr(i, 2), 16); if (v > 127) v -= 256; out.push(v); } return out; }

/**
 * PBKDF2-HMAC-SHA256, une sortie de 32 octets (RFC 8018), calculé en JavaScript pur : environ 50 fois plus rapide que
 * 2 appels au service Utilities par itération (chaque appel au service coûte un aller-retour). Résultats identiques
 * (vecteurs RFC vérifiés par les tests) : les mots de passe existants restent valides.
 */
var SHA256_K_ = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
  0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
var SHA256_IV_ = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
/** Compression d'un bloc de 16 mots (w[0..15]) dans l'état st (8 mots), modifié sur place. w doit avoir 64 cases. */
function sha256Compress_(st, w) {
  const K = SHA256_K_;
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15], y = w[i - 2];
    w[i] = (w[i - 16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w[i - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
  }
  let a = st[0], b = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], h = st[7];
  for (let i = 0; i < 64; i++) {
    const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
    const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  st[0] = (st[0] + a) | 0; st[1] = (st[1] + b) | 0; st[2] = (st[2] + c) | 0; st[3] = (st[3] + d) | 0;
  st[4] = (st[4] + e) | 0; st[5] = (st[5] + f) | 0; st[6] = (st[6] + g) | 0; st[7] = (st[7] + h) | 0;
}
/** SHA-256 des octets `bytes` à partir de l'état st (déjà « prefixLen » octets traités). Retourne 8 mots. */
function sha256Finish_(st, bytes, prefixLen) {
  const s = st.slice(), w = new Array(64), n = bytes.length, total = n + prefixLen;
  const padded = bytes.slice(); padded.push(0x80);
  while ((padded.length % 64) !== 56) padded.push(0);
  const bits = total * 8, hi = Math.floor(bits / 4294967296), lo = bits >>> 0;
  padded.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff, (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = (padded[off + 4 * i] << 24) | (padded[off + 4 * i + 1] << 16) | (padded[off + 4 * i + 2] << 8) | padded[off + 4 * i + 3];
    sha256Compress_(s, w);
  }
  return s;
}
function pbkdf2Hex_(password, saltHex, iters) {
  let key = Utilities.newBlob(String(password)).getBytes().map(function (b) { return b & 0xff; });
  if (key.length > 64) key = sha256Finish_(SHA256_IV_, key, 0).reduce(function (o, x) { o.push((x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff); return o; }, []);
  const ipad = [], opad = [], w = new Array(64);
  for (let i = 0; i < 64; i++) { const k = key[i] || 0; ipad.push(k ^ 0x36); opad.push(k ^ 0x5c); }
  const block = function (bytes) { for (let i = 0; i < 16; i++) w[i] = (bytes[4 * i] << 24) | (bytes[4 * i + 1] << 16) | (bytes[4 * i + 2] << 8) | bytes[4 * i + 3]; };
  const ist = SHA256_IV_.slice(), ost = SHA256_IV_.slice();
  block(ipad); sha256Compress_(ist, w); block(opad); sha256Compress_(ost, w);
  // U1 = HMAC(mot de passe, sel || INT(1))
  const salt = hexToBytes_(saltHex).map(function (b) { return b & 0xff; }).concat([0, 0, 0, 1]);
  const inner1 = sha256Finish_(ist, salt, 64);
  const toBytes = function (ws) { const o = []; ws.forEach(function (x) { o.push((x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff); }); return o; };
  let u = sha256Finish_(ost, toBytes(inner1), 64);
  const t = u.slice();
  // Itérations suivantes : messages de 32 octets, un seul bloc chacun (longueur fixe 64 + 32 octets = 768 bits).
  const s = new Array(8);
  for (let n = 1; n < iters; n++) {
    for (let i = 0; i < 8; i++) { w[i] = u[i]; s[i] = ist[i]; }
    w[8] = 0x80000000 | 0; for (let i = 9; i < 15; i++) w[i] = 0; w[15] = 768;
    sha256Compress_(s, w);
    for (let i = 0; i < 8; i++) { w[i] = s[i]; s[i] = ost[i]; }
    w[8] = 0x80000000 | 0; for (let i = 9; i < 15; i++) w[i] = 0; w[15] = 768;
    sha256Compress_(s, w);
    u = s.slice();
    for (let i = 0; i < 8; i++) t[i] ^= u[i];
  }
  return t.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
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
  const s = dbFindFast_("Sessions", "tokenHash", h);
  if (!s || s.revokedAt || !parseTs_(s.expiresAt) || parseTs_(s.expiresAt).getTime() < Date.now()) throw new AppError("AUTH", "Session expirée. Veuillez vous reconnecter.");
  const user = dbGet_("Users", s.userId);
  if (!user || user.status !== "ACTIVE") throw new AppError("AUTH", "Compte inactif ou suspendu.");
  const p = buildPrincipal_(user);
  if (!p.roles.length) throw new AppError("AUTH", "Aucun rôle actif n'est attribué à ce compte, ou votre organisation est suspendue.");
  p.sessionId = s.sessionId;
  if (s.impersonatorUserId) {
    // Session « entrer dans l'espace » ouverte par un super administrateur : elle n'est valable que tant qu'il l'est encore.
    const su = dbGet_("Users", s.impersonatorUserId), sp = su && su.status === "ACTIVE" ? buildPrincipal_(su) : null;
    if (!sp || !sp.isSuper) { dbUpdate_("Sessions", s.sessionId, { revokedAt: nowIso_() }); throw new AppError("AUTH", "Accès d'administration expiré. Veuillez vous reconnecter."); }
    p.impersonator = { userId: sp.userId, email: sp.email, displayName: sp.displayName };
  }
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
  if (!user) { pbkdf2Hex_(pw, "00", pbkdfIters_()); throw generic; } // même durée qu'un vrai contrôle
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
  const patch = { failedAttempts: 0, lockedUntil: "", lastLoginAt: nowIso_() };
  // Renforcement transparent : un mot de passe haché avec moins d'itérations que le réglage actuel est re-haché à la connexion.
  if ((Number(user.passwordIters) || 0) < pbkdfIters_()) {
    const salt = sha256Hex_(randomToken_()).slice(0, 32), iters = pbkdfIters_();
    Object.assign(patch, { passwordHash: pbkdf2Hex_(pw, salt, iters), passwordSalt: salt, passwordIters: iters });
  }
  dbUpdate_("Users", user.userId, patch);
  const token = createSession_(user, args.userAgent);
  auditAs_(email, user.userId, "LOGIN_SUCCESS", "User", user.userId, "", {});
  CTX_.principal = p;
  // Tout ce qu'il faut pour afficher l'application en un seul aller-retour (pas d'appel me.get / meta.get ensuite).
  return { token: token, me: meBootstrap_(p), meta: metaGet_(p) };
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
function meLogoutAll_(p) { notWhileImpersonating_(p); revokeAllSessions_(p.userId); audit_("LOGOUT_ALL", "User", p.userId, ""); return { ok: true }; }
function meChangePassword_(p, a) {
  notWhileImpersonating_(p);
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
  if (a.locale !== undefined) patch.locale = oneOf_(a.locale, IMMO_LANGS_, "Langue");
  if (a.phone !== undefined) patch.phone = safeText_(a.phone, 30);
  if (a.notifPrefs !== undefined) {
    const np = a.notifPrefs || {};
    patch.notifPrefsJson = { email: np.email !== false, inApp: true, mutedTypes: Array.isArray(np.mutedTypes) ? np.mutedTypes.slice(0, 40).map(function (x) { return safeText_(x, 60); }) : [] };
  }
  dbUpdate_("Users", p.userId, patch);
  audit_("PROFILE_UPDATED", "User", p.userId, "", { fields: Object.keys(patch) });
  return { ok: true };
}

/* ---------------------- Super administrateur : entrer dans l'espace d'un compte ---------------------- */
var IMPERSONATION_HOURS_ = 2;
/** Actions personnelles réservées au vrai titulaire du compte (mot de passe, sessions, suppression). */
function notWhileImpersonating_(p) { if (p.impersonator) forbid_("Action réservée au titulaire du compte : indisponible quand le super administrateur est dans son espace."); }
/** Ouvre une session au nom d'un compte client. Tout y est possible ; chaque action est journalisée au nom du super administrateur. */
function impersonateStart_(p, a) {
  requireSuper_(p);
  assert_(!p.impersonator, "Revenez d'abord à votre espace.", "FORBIDDEN");
  rateLimit_("imp:" + p.userId, 60, 3600);
  const user = dbGet_("Users", safeText_(a.userId, 120));
  if (!user) notFound_("Compte");
  assert_(String(user.userId) !== p.userId, "C'est déjà votre compte.");
  assert_(user.status === "ACTIVE", "Ce compte est bloqué ou supprimé : débloquez-le avant d'y entrer.");
  const tp = buildPrincipal_(user);
  assert_(!tp.isSuper, "Impossible d'entrer dans l'espace d'un autre super administrateur.", "FORBIDDEN");
  assert_(tp.roles.length, "Ce compte n'a aucun rôle actif (rôle suspendu ou organisation suspendue).");
  const token = randomToken_();
  dbInsert_("Sessions", { userId: user.userId, tokenHash: sha256Hex_(token), createdAt: nowIso_(), expiresAt: new Date(Date.now() + IMPERSONATION_HOURS_ * 3600000).toISOString(),
    lastSeenAt: nowIso_(), userAgent: "Super administrateur : " + p.email, impersonatorUserId: p.userId });
  audit_("IMPERSONATION_START", "User", user.userId, (tp.roles[0] || {}).organizationId || "", { target: normalizeEmail_(user.email), reason: safeText_(a.reason || "", 300) });
  tp.impersonator = { userId: p.userId, email: p.email, displayName: p.displayName };
  CTX_.principal = tp; CTX_.propMemo = {};
  return { token: token, me: meBootstrap_(tp), meta: metaGet_(tp) };
}
/** Ferme la session ouverte dans l'espace du client (le jeton du super administrateur, gardé par le navigateur, reste valable). */
function impersonateEnd_(p) {
  assert_(p.impersonator, "Vous n'êtes pas dans l'espace d'un autre compte.");
  dbUpdate_("Sessions", p.sessionId, { revokedAt: nowIso_() });
  audit_("IMPERSONATION_END", "User", p.userId, "", { target: p.email });
  return { ok: true };
}
/** Tous les comptes clients classés par type d'espace (propriétaires, agences, prestataires, gardiens, locataires). */
var ACCOUNT_CATEGORIES_ = { OWNER: ["OWNER"], AGENCY: ["AGENCY_ADMIN", "AGENCY_USER"], PROVIDER: ["CLEANER", "ARTISAN"], GUARD: ["GUARD"], TENANT: ["TENANT"] };
function adminAccounts_(p, a) {
  requireSuper_(p);
  a = a || {};
  const cat = ACCOUNT_CATEGORIES_[a.category] ? a.category : "";
  const orgs = indexBy_(dbAll_("Organizations"), "organizationId"), byUser = {};
  dbAll_("UserRoles").forEach(function (r) {
    if (r.role === "SUPER_ADMIN") return;
    (byUser[r.userId] = byUser[r.userId] || []).push(r);
  });
  const supers = {};
  dbAll_("UserRoles").forEach(function (r) { if (r.role === "SUPER_ADMIN" && r.status === "ACTIVE") supers[r.userId] = true; });
  const counts = { OWNER: 0, AGENCY: 0, PROVIDER: 0, GUARD: 0, TENANT: 0 };
  const rows = [];
  dbAll_("Users").forEach(function (u) {
    const rs = byUser[u.userId];
    if (!rs || supers[u.userId] || u.status === "DISABLED") return;
    const cats = Object.keys(ACCOUNT_CATEGORIES_).filter(function (c) { return rs.some(function (r) { return ACCOUNT_CATEGORIES_[c].indexOf(r.role) >= 0; }); });
    const inCat = cat ? rs.filter(function (r) { return ACCOUNT_CATEGORIES_[cat].indexOf(r.role) >= 0; }) : rs;
    const row = { userId: u.userId, displayName: u.displayName || "", email: u.email || "", phone: u.phone || "", userStatus: u.status || "", activated: !!u.passwordHash,
      lastLoginAt: u.lastLoginAt || "", categories: cats,
      roles: inCat.map(function (r) { const o = orgs[r.organizationId] || {}; return { role: r.role, status: r.status, organizationId: r.organizationId, organizationName: o.name || "", orgStatus: o.status || "", isDemo: bool_(o.isDemo) }; }) };
    row.isDemo = row.roles.length > 0 && row.roles.every(function (r) { return r.isDemo; });
    row.canEnter = row.userStatus === "ACTIVE" && rs.some(function (r) { const o = orgs[r.organizationId] || {}; return r.status === "ACTIVE" && o.status === "ACTIVE"; });
    cats.forEach(function (c) { counts[c]++; });
    if (cat && !inCat.length) return;
    if (a.hideDemo && row.isDemo) return;
    if (!matchesQuery_(a.q, [row.displayName, row.email, row.phone].concat(row.roles.map(function (r) { return r.organizationName; })))) return;
    rows.push(row);
  });
  rows.sort(function (x, y) { return String((x.roles[0] || {}).organizationName + x.displayName).localeCompare(String((y.roles[0] || {}).organizationName + y.displayName)); });
  const out = pageOf_(rows, a); out.counts = counts;
  return out;
}

/** Données d'amorçage de l'interface : identité, rôles, organisations, capacités d'affichage. */
function meBootstrap_(p) {
  const orgs = indexBy_(dbAll_("Organizations"), "organizationId");
  const user = dbGet_("Users", p.userId);
  const unread = dbAll_("Notifications").filter(function (n) { return String(n.userId) === p.userId && !n.readAt; }).length;
  return {
    userId: p.userId, email: p.email, displayName: p.displayName, locale: (user && user.locale) || "fr", isSuper: p.isSuper, impersonator: p.impersonator || null,
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
