/**
 * ImmoPilot — inscription en ligne (mode SaaS).
 *
 * Un propriétaire ou une agence crée seul son compte depuis l'écran de connexion : organisation, abonnement en période
 * d'essai et e-mail d'activation (lien à usage unique pour choisir le mot de passe, qui prouve aussi que l'adresse est la sienne).
 * Aucun compte utilisateur n'existe tant que le lien n'a pas été ouvert ; les inscriptions jamais activées sont désactivées
 * automatiquement après 14 jours (tâche quotidienne).
 *
 * Réglages (propriétés du script, ou « immopilot set … » sur le serveur) :
 *   IMMO_SIGNUP_OPEN        "1" pour ouvrir l'inscription (fermée par défaut ; jamais dans un paquet de démonstration)
 *   IMMO_SIGNUP_TRIAL_DAYS  durée de l'essai gratuit en jours (60 par défaut : offre de lancement « 2 mois offerts »)
 */
var SIGNUP_CREATOR_PREFIX_ = "inscription:";
var SIGNUP_ACCOUNT_TYPES_ = { OWNER_ORG: "OWNER", AGENCY: "AGENCY_ADMIN" };

function signupProp_(k) { try { return PropertiesService.getScriptProperties().getProperty(k); } catch (e) { return null; } }
function signupOpen_() { return !IMMO_PUBLIC_DEMO_ && String(signupProp_("IMMO_SIGNUP_OPEN") || "") === "1"; }
function signupTrialDays_() {
  const raw = signupProp_("IMMO_SIGNUP_TRIAL_DAYS"), n = parseInt(raw, 10);
  return raw === null || raw === "" || isNaN(n) ? 60 : Math.max(0, Math.min(365, n));
}
/** Démonstration : adresse de l'inscription sur la version officielle (IMMO_SIGNUP_URL), pour le bouton « Créer mon compte ». */
function signupExternalUrl_() {
  if (!IMMO_PUBLIC_DEMO_) return "";
  const m = String(signupProp_("IMMO_SIGNUP_URL") || "").trim().match(/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s"'<>]*)?$/i);
  return m ? m[0] : "";
}
function signupAssertOpen_() { if (!signupOpen_()) throw new AppError("NOT_FOUND", "L'inscription en ligne n'est pas ouverte. Contactez ImmoPilot pour créer votre compte."); }

/** Forfaits proposés à l'inscription (aucune donnée client). */
function signupInfo_() {
  signupAssertOpen_();
  const plans = dbAll_("SubscriptionPlans").filter(function (pl) { return pl.status === "ACTIVE"; })
    .sort(function (a, b) { return (Number(a.sortOrder) || 9) - (Number(b.sortOrder) || 9); })
    .map(function (pl) { return { planCode: pl.planCode, name: pl.name, price: num_(pl.price), currency: pl.currency || cur_(), maxProperties: pl.maxProperties, maxUsers: pl.maxUsers }; });
  return { open: true, trialDays: signupTrialDays_(), plans: plans, currency: cur_(), country: edition_().countryName };
}

function signupCreate_(a) {
  signupAssertOpen_();
  a = a || {};
  rateLimit_("signup-global", 60, 3600);
  const email = validateEmail_(a.email);
  rateLimit_("signup:" + email, 5, 86400);
  const done = { ok: true, email: email, message: "Merci ! Un e-mail vient d'être envoyé à " + email + ". Ouvrez le lien qu'il contient pour choisir votre mot de passe et activer votre compte " +
    "(pensez à regarder dans les courriers indésirables). Le lien est valable " + inviteDays_() + " jours." };
  if (a.website) return done; // champ piège invisible : rempli seulement par les robots
  const displayName = reqText_(a.displayName, "Votre nom", 2, 100);
  const type = oneOf_(String(a.accountType || "OWNER_ORG"), Object.keys(SIGNUP_ACCOUNT_TYPES_), "Type de compte");
  const orgName = safeText_(a.organizationName, 120) || displayName;
  assert_(orgName.length >= 2, "Nom de votre structure trop court.");
  const phone = safeText_(a.phone, 30);
  assert_(a.acceptTerms === true, "Veuillez accepter les conditions générales et la politique de confidentialité.");
  const plan = dbGet_("SubscriptionPlans", safeText_(a.planCode || "ESSENTIEL", 30));
  assert_(plan && plan.status === "ACTIVE", "Forfait introuvable.");

  // Compte déjà existant : on ne crée rien et on prévient la personne par e-mail (la réponse reste identique, sans révéler qui est inscrit).
  const user = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === email; });
  if (user && user.passwordHash) {
    sendMailSafe_(email, "Votre compte ImmoPilot existe déjà", "Bonjour,\n\nUne inscription a été demandée avec votre adresse, mais vous avez déjà un compte ImmoPilot.\n\n" +
      "Connectez-vous ici : " + appUrl_() + "\nMot de passe oublié ? Utilisez le lien « Mot de passe oublié » de l'écran de connexion.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nImmoPilot",
      "signup-exists:" + email + ":" + todayStr_());
    return done;
  }
  const now = Date.now(), base = appUrl_(); // adresse vérifiée AVANT toute création (sinon l'espace existerait sans e-mail d'activation)
  // Inscription déjà en attente d'activation (e-mail perdu, lien expiré…) : nouveau lien pour le même espace, sans doublon.
  const pending = dbAll_("Invitations").filter(function (i) { return normalizeEmail_(i.email) === email && ["PENDING", "EMAIL_FAILED", "EXPIRED"].indexOf(i.status) >= 0 && String(i.createdBy) === SIGNUP_CREATOR_PREFIX_ + email; })
    .filter(function (i) { const o = dbGet_("Organizations", i.organizationId); return o && o.status === "ACTIVE"; })
    .sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); })[0];
  if (pending) {
    const fresh = randomToken_();
    dbUpdate_("Invitations", pending.invitationId, { tokenHash: sha256Hex_(fresh), status: "PENDING", expiresAt: new Date(now + inviteDays_() * 86400000).toISOString() });
    const o = dbGet_("Organizations", pending.organizationId);
    const r = sendMailSafe_(email, "Activez votre compte ImmoPilot", signupMailBody_(pending.displayName, o.name, "", "", base + "?action=accept&token=" + fresh), "signup:" + pending.invitationId + ":" + fresh.slice(0, 8));
    if (!r.ok) throw new AppError("INTERNAL", "L'e-mail d'activation n'a pas pu partir. Réessayez dans quelques minutes ou contactez ImmoPilot.");
    return done;
  }

  const trialDays = signupTrialDays_(), token = randomToken_(), role = SIGNUP_ACCOUNT_TYPES_[type];
  const made = withLock_(function () {
    const names = {}; dbAll_("Organizations").forEach(function (o) { if (o.status !== "INACTIVE") names[String(o.name).toLowerCase()] = true; });
    let name = orgName, k = 2; while (names[name.toLowerCase()]) name = orgName + " (" + (k++) + ")";
    const org = dbInsert_("Organizations", { name: name, status: "ACTIVE", type: type, city: edition_().city, country: edition_().country, timezone: tz_(), locale: oneOf_(IMMO_LANGS_.indexOf(a.locale) >= 0 ? a.locale : "fr", IMMO_LANGS_, "Langue"),
      billingEmail: email, phone: phone, contactName: displayName, createdAt: nowIso_(), createdBy: SIGNUP_CREATOR_PREFIX_ + email, updatedAt: nowIso_() });
    const start = todayStr_(), trial = trialDays > 0, trialEnd = trial ? addDaysStr_(start, trialDays) : "";
    const sub = dbInsert_("Subscriptions", { organizationId: org.organizationId, planCode: plan.planCode, status: trial ? "TRIAL" : "PAST_DUE", startDate: start, nextDueDate: trial ? trialEnd : start,
      periodEnd: trial ? trialEnd : start, trialEnd: trialEnd, price: plan.price, agencyOptionPrice: num_(plan.agencyOptionPrice), currency: plan.currency || cur_(), periodicity: plan.periodicity,
      cancelAtPeriodEnd: false, createdAt: nowIso_(), createdBy: SIGNUP_CREATOR_PREFIX_ + email, updatedAt: nowIso_(), updatedBy: SIGNUP_CREATOR_PREFIX_ + email });
    dbUpdate_("Organizations", org.organizationId, { planCode: plan.planCode });
    const inv = dbInsert_("Invitations", { email: email, displayName: displayName, organizationId: org.organizationId, role: role, tokenHash: sha256Hex_(token), status: "PENDING",
      expiresAt: new Date(now + inviteDays_() * 86400000).toISOString(), createdAt: nowIso_(), createdBy: SIGNUP_CREATOR_PREFIX_ + email, acceptedAt: "", revokedAt: "", permissionsJson: "[]", propertyId: "" });
    auditAs_(email, "", "SIGNUP_CREATED", "Organization", org.organizationId, org.organizationId, { planCode: plan.planCode, type: type, trialDays: trialDays, subscriptionId: sub.subscriptionId });
    return { org: org, inv: inv, trialEnd: trialEnd };
  });

  const body = signupMailBody_(displayName, made.org.name, plan.name, made.trialEnd, base + "?action=accept&token=" + token);
  const sent = sendMailSafe_(email, "Activez votre compte ImmoPilot", body, "signup:" + made.inv.invitationId);
  if (!sent.ok) {
    dbUpdate_("Invitations", made.inv.invitationId, { status: "EMAIL_FAILED" });
    throw new AppError("INTERNAL", "Votre espace est créé, mais l'e-mail d'activation n'a pas pu partir. Réessayez dans quelques minutes ou contactez ImmoPilot.");
  }
  signupNotifyAdmins_(made.org, plan, email, displayName, phone, type, made.trialEnd);
  return done;
}

function signupMailBody_(displayName, orgName, planName, trialEnd, url) {
  return "Bonjour " + displayName + ",\n\nBienvenue sur ImmoPilot " + edition_().countryName + " !\n\nVotre espace « " + orgName + " » est prêt" +
    (trialEnd ? ", avec le forfait " + planName + " offert jusqu'au " + trialEnd + " (aucun paiement demandé pendant l'essai)" : "") + ".\n\n" +
    "Pour l'activer, choisissez votre mot de passe avec ce lien personnel, à usage unique, valable " + inviteDays_() + " jours :\n" + url +
    "\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez ce message : sans activation, rien ne sera conservé.\n\nL'équipe ImmoPilot";
}
/** Prévient les super administrateurs de chaque nouvelle inscription (sans bloquer l'inscription en cas d'échec). */
function signupNotifyAdmins_(org, plan, email, displayName, phone, type, trialEnd) {
  try {
    const admins = String(signupProp_(IMMO_CONFIG.ADMIN_EMAILS_PROPERTY) || "").split(/[,;\s]+/).filter(function (x) { return /@/.test(x); }).slice(0, 5);
    admins.forEach(function (to) {
      sendMailSafe_(to, "Nouvelle inscription ImmoPilot " + edition_().code + " : " + org.name,
        "Nouvelle inscription en ligne.\n\nStructure : " + org.name + " (" + (type === "AGENCY" ? "agence" : "propriétaire") + ")\nContact : " + displayName + " — " + email + (phone ? " — " + phone : "") +
        "\nForfait : " + plan.name + (trialEnd ? " (essai jusqu'au " + trialEnd + ")" : "") + "\n\nLe compte sera actif dès que la personne aura choisi son mot de passe.\n" + appUrl_(),
        "signup-admin:" + org.organizationId, org.organizationId);
    });
  } catch (e) { console.error("Alerte inscription : " + e.message); }
}

/** Tâche quotidienne : désactive les inscriptions jamais activées (aucun utilisateur actif) au-delà de 14 jours. */
function signupCleanupJob_() {
  const limit = Date.now() - 14 * 86400000;
  const activeOrgs = {}; dbAll_("UserRoles").forEach(function (r) { if (r.status === "ACTIVE") activeOrgs[String(r.organizationId)] = true; });
  let n = 0;
  dbAll_("Organizations").filter(function (o) {
    return o.status === "ACTIVE" && String(o.createdBy).indexOf(SIGNUP_CREATOR_PREFIX_) === 0 && !activeOrgs[String(o.organizationId)] && parseTs_(o.createdAt) && parseTs_(o.createdAt).getTime() < limit;
  }).forEach(function (o) {
    withLock_(function () {
      dbUpdate_("Organizations", o.organizationId, { status: "INACTIVE", suspensionReason: "Inscription jamais activée", updatedAt: nowIso_() });
      dbAll_("Subscriptions").filter(function (s) { return String(s.organizationId) === String(o.organizationId) && ["CANCELLED", "EXPIRED"].indexOf(s.status) < 0; })
        .forEach(function (s) { dbUpdate_("Subscriptions", s.subscriptionId, { status: "CANCELLED", canceledAt: nowIso_(), updatedAt: nowIso_(), updatedBy: "inscription-expiree" }); });
      dbAll_("Invitations").filter(function (i) { return String(i.organizationId) === String(o.organizationId) && ["PENDING", "EMAIL_FAILED"].indexOf(i.status) >= 0; })
        .forEach(function (i) { dbUpdate_("Invitations", i.invitationId, { status: "EXPIRED", tokenHash: "" }); });
    });
    n++;
  });
  return n;
}
