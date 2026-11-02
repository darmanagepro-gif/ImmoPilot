/**
 * Inscription en ligne (sans intervention de l'administrateur) et référencement des artisans.
 *
 * Clients (propriétaire ou agence) : choix du profil → choix du forfait → informations (identité, structure, mot de passe,
 * acceptation des conditions et du statut de la plateforme) → code reçu par e-mail → compte, organisation et abonnement
 * créés (période d'essai du forfait) → signature électronique du contrat → enregistrement de la carte (SumUp).
 *
 * Artisans : corps de métier → statut (auto-entrepreneur ou société) → informations légales de la structure →
 * assurance RC professionnelle (et décennale en France pour les travaux du bâtiment) → code e-mail → compte créé
 * « en attente » → dépôt OBLIGATOIRE des pièces exigées dans le pays → contrôle par le super administrateur →
 * référencement (le prestataire apparaît alors dans l'annuaire proposé aux propriétaires et agences).
 *
 * Sécurité : routes publiques limitées en fréquence (IP et e-mail), code à 6 chiffres conservé haché (15 min, 5 essais),
 * mot de passe haché dès la demande (jamais conservé en clair), rien n'est créé avant la confirmation de l'adresse e-mail.
 */
var SIGNUP_CODE_MINUTES_ = 15, SIGNUP_MAX_TRIES_ = 5, SIGNUP_MAX_SENDS_ = 5;

/* --------------------------- Référentiels par pays --------------------------- */
/** Corps de métier proposés aux artisans (codes de list.specialties, libellés côté interface). */
var PROVIDER_TRADES_ = ["CLEANING", "PLUMBING", "ELECTRICITY", "AC", "PAINTING", "LOCKSMITH", "CARPENTRY", "APPLIANCE", "GARDENING", "POOL", "OTHER"];
/** France : métiers du bâtiment soumis à l'assurance décennale obligatoire (art. L. 241-1 du Code des assurances). */
var DECENNALE_TRADES_ = ["PLUMBING", "ELECTRICITY", "AC", "CARPENTRY", "PAINTING", "POOL"];

function signupLegalForms_() {
  return edition_().code === "FR" ? { COMPANY: ["SARL", "EURL", "SAS", "SASU", "SA", "SNC", "SCI", "EI", "AUTRE"], AGENCY: ["SARL", "EURL", "SAS", "SASU", "SA", "AUTRE"] }
    : { COMPANY: ["SARL", "SARL AU", "SA", "SNC", "SCI", "AUTRE"], AGENCY: ["SARL", "SARL AU", "SA", "AUTRE"] };
}

/** Pièces justificatives exigées d'un artisan selon le pays, son statut, ses métiers et son assurance. */
function providerDocRules_(businessType, trades, hasRcPro) {
  const fr = edition_().code === "FR", out = [];
  const add = function (code, label, help) { out.push({ code: code, label: label, help: help || "", required: true }); };
  if (fr) {
    add("ID_DOCUMENT", "Pièce d'identité du dirigeant (carte d'identité ou passeport, recto verso)", "En cours de validité.");
    if (businessType === "AE") add("SIRENE", "Avis de situation SIRENE (INSEE) ou extrait d'immatriculation au RNE", "De moins de 3 mois.");
    else add("KBIS", "Extrait Kbis", "De moins de 3 mois.");
    add("URSSAF", "Attestation de vigilance URSSAF", "De moins de 6 mois (art. L. 8222-1 et D. 8222-5 du Code du travail).");
    if ((trades || []).some(function (t) { return DECENNALE_TRADES_.indexOf(t) >= 0; })) add("DECENNALE", "Attestation d'assurance décennale", "En cours de validité : obligatoire pour les travaux de construction et de rénovation.");
    if (hasRcPro) add("RC_PRO", "Attestation d'assurance responsabilité civile professionnelle", "En cours de validité.");
    add("RIB", "RIB au nom de l'entreprise", "Pour le règlement de vos factures.");
  } else {
    add("CIN", "Carte nationale d'identité (CIN) du dirigeant, recto verso", "En cours de validité.");
    if (businessType === "AE") add("AE_CARD", "Attestation d'inscription au Registre national de l'auto-entrepreneur", "Carte d'auto-entrepreneur ou attestation en cours de validité.");
    else { add("RC_EXTRACT", "Extrait du registre de commerce (modèle J)", "De moins de 3 mois."); add("CNSS", "Attestation d'affiliation à la CNSS", "Ou attestation de situation récente."); }
    if (hasRcPro) add("RC_PRO", "Attestation d'assurance responsabilité civile professionnelle", "En cours de validité.");
    add("RIB", "RIB (relevé d'identité bancaire) au nom de l'entreprise", "Pour le règlement de vos factures.");
  }
  return out;
}
var PROVIDER_DOC_CODES_ = ["ID_DOCUMENT", "SIRENE", "KBIS", "URSSAF", "DECENNALE", "RC_PRO", "RIB", "CIN", "AE_CARD", "RC_EXTRACT", "CNSS", "OTHER_PROOF"];

/** Statut de la plateforme : texte affiché pendant l'inscription (et accepté expressément). */
function platformStatusText_() {
  const v = legalValues_();
  return {
    title: "Ce qu'est ImmoPilot",
    points: [
      "ImmoPilot est un logiciel en ligne (SaaS) édité par " + (v.publisherName || "ECO SYNERGY") + " et mis à disposition par abonnement : vous l'utilisez pour gérer vous-même vos biens, vos locations, vos équipes et vos documents.",
      "ImmoPilot est aussi une plateforme de mise en relation avec des artisans et prestataires référencés (ménage, plomberie, électricité…). Les prestations sont commandées, réalisées et facturées directement entre vous et le prestataire.",
      "L'éditeur n'est ni agent immobilier, ni administrateur de biens, ni conciergerie, ni partie à vos contrats (baux, réservations, travaux). Il ne détient pas vos fonds : loyers et paiements des séjours vous sont versés directement.",
      "Vous payez à l'éditeur l'abonnement (sans engagement : résiliation à tout moment, effective à la fin de la période payée) et, si vous faites appel à un artisan référencé, une commission de mise en relation de " + commissionRates_().client + " % HT du montant de sa facture, réunie dans un récapitulatif mensuel."
    ],
    providerPoints: [
      "Le référencement est gratuit. Il est accordé après contrôle de vos informations légales et des pièces exigées par la réglementation du pays.",
      "Critères : activité déclarée et immatriculée, pièces lisibles et à jour, assurance en cours de validité lorsqu'elle est exigée. Aucun classement payant : les clients vous choisissent par corps de métier et zone d'intervention.",
      "Vos devis, interventions et factures sont établis par vous, en votre nom, directement avec le client. L'éditeur n'est pas partie à ces contrats et ne garantit ni le paiement ni l'exécution des prestations.",
      "Commission de mise en relation : " + commissionRates_().artisan + " % HT de chaque facture réglée d'une mission obtenue par la plateforme, retenue automatiquement si le client paie en ligne, sinon réglée par lien de paiement après le règlement du client.",
      "Déréférencement : une pièce expirée, une information inexacte ou un manquement grave entraîne la suspension du référencement, après information par e-mail. Vous pouvez demander votre déréférencement à tout moment."
    ]
  };
}

/* --------------------------- Validation des identifiants --------------------------- */
function luhnOk_(digits) { let s = 0; for (let i = 0; i < digits.length; i++) { let d = Number(digits.charAt(digits.length - 1 - i)); if (i % 2) { d *= 2; if (d > 9) d -= 9; } s += d; } return s % 10 === 0; }
function siretCheck_(v) {
  const d = String(v || "").replace(/\s/g, "");
  assert_(/^\d{14}$/.test(d), "Le SIRET doit comporter 14 chiffres.");
  assert_(luhnOk_(d) || /^356000000/.test(d), "Ce numéro SIRET n'est pas valide (vérifiez les chiffres).");
  return d;
}
function iceCheck_(v) { const d = String(v || "").replace(/\s/g, ""); assert_(/^\d{15}$/.test(d), "L'ICE doit comporter 15 chiffres."); return d; }
function optText_(v, n) { return safeText_(v == null ? "" : String(v).trim(), n); }

/** Identifiant de l'entreprise selon le pays (SIRET en France, ICE au Maroc), avec les champs complémentaires. */
function companyLegalInput_(a, kind) {
  const fr = edition_().code === "FR", forms = signupLegalForms_()[kind === "AGENCY" ? "AGENCY" : "COMPANY"];
  const o = { legalName: reqText_(a.legalName, "Raison sociale", 2, 160), legalForm: oneOf_(String(a.legalForm || ""), forms, "Forme juridique"),
    capital: optText_(a.capital, 40), address: reqText_(a.address, "Adresse du siège", 5, 300), managerName: reqText_(a.managerName, "Nom du dirigeant", 2, 120) };
  if (fr) {
    o.siret = siretCheck_(a.siret); o.rcsCity = optText_(a.rcsCity, 80); o.vatNumber = optText_(a.vatNumber, 20).toUpperCase().replace(/\s/g, "");
    if (o.vatNumber) assert_(/^FR[0-9A-Z]{2}\d{9}$/.test(o.vatNumber), "N° de TVA intracommunautaire invalide (format FR + 11 caractères).");
  } else {
    o.ice = iceCheck_(a.ice); o.rcNumber = reqText_(a.rcNumber, "N° de registre de commerce", 1, 40); o.rcCity = optText_(a.rcCity, 80);
    o.ifNumber = optText_(a.ifNumber, 20); o.patente = optText_(a.patente, 30); o.cnss = optText_(a.cnss, 30);
  }
  return o;
}

/* --------------------------- Données d'inscription --------------------------- */
function signupClientInput_(a) {
  const profile = oneOf_(String(a.profile || ""), ["OWNER", "AGENCY"], "Profil");
  const plan = dbGet_("SubscriptionPlans", safeText_(a.planCode, 30));
  assert_(plan && plan.status === "ACTIVE", "Choisissez un forfait.");
  const person = { firstName: reqText_(a.firstName, "Prénom", 1, 80), lastName: reqText_(a.lastName, "Nom", 1, 80), phone: reqText_(a.phone, "Téléphone", 6, 30), city: reqText_(a.city, "Ville", 2, 80) };
  assert_(intlPhone_(person.phone), "Numéro de téléphone invalide.");
  const o = { profile: profile, planCode: plan.planCode, person: person };
  if (profile === "AGENCY") {
    o.company = companyLegalInput_(a, "AGENCY");
    if (edition_().code === "FR") { o.company.cardNumber = optText_(a.cardNumber, 40); o.company.cardIssuer = optText_(a.cardIssuer, 80); o.company.guarantor = optText_(a.guarantor, 120); }
  } else {
    o.ownerType = oneOf_(String(a.ownerType || "INDIVIDUAL"), ["INDIVIDUAL", "COMPANY"], "Vous êtes");
    if (o.ownerType === "COMPANY") o.company = companyLegalInput_(a, "COMPANY");
    else o.address = reqText_(a.homeAddress || a.address, "Adresse postale", 5, 300);
  }
  o.orgName = o.company ? o.company.legalName : (person.firstName + " " + person.lastName);
  return o;
}
function signupProviderInput_(a) {
  const trades = (Array.isArray(a.trades) ? a.trades : []).map(String).filter(function (t, i, arr) { return PROVIDER_TRADES_.indexOf(t) >= 0 && arr.indexOf(t) === i; });
  assert_(trades.length, "Choisissez au moins un corps de métier.");
  const businessType = oneOf_(String(a.businessType || ""), ["AE", "COMPANY"], "Statut");
  const fr = edition_().code === "FR";
  const person = { firstName: reqText_(a.firstName, "Prénom", 1, 80), lastName: reqText_(a.lastName, "Nom", 1, 80), phone: reqText_(a.phone, "Téléphone", 6, 30) };
  assert_(intlPhone_(person.phone), "Numéro de téléphone invalide.");
  let legal;
  if (businessType === "COMPANY") legal = companyLegalInput_(a, "COMPANY");
  else if (fr) legal = { legalName: optText_(a.legalName, 160) || (person.firstName + " " + person.lastName), siret: siretCheck_(a.siret), address: reqText_(a.address, "Adresse professionnelle", 5, 300),
    vatNumber: optText_(a.vatNumber, 20).toUpperCase().replace(/\s/g, ""), managerName: person.firstName + " " + person.lastName };
  else legal = { legalName: optText_(a.legalName, 160) || (person.firstName + " " + person.lastName), aeNumber: reqText_(a.aeNumber, "N° d'inscription au registre de l'auto-entrepreneur", 1, 40),
    ice: iceCheck_(a.ice), ifNumber: optText_(a.ifNumber, 20), address: reqText_(a.address, "Adresse professionnelle", 5, 300), managerName: person.firstName + " " + person.lastName };
  const ins = { hasRcPro: a.hasRcPro === true || a.hasRcPro === "true" };
  if (ins.hasRcPro) ins.rcPro = { insurer: reqText_(a.rcInsurer, "Assureur RC Pro", 2, 120), policy: reqText_(a.rcPolicy, "N° de police RC Pro", 2, 60), insurerAddress: reqText_(a.rcInsurerAddress, "Adresse de l'assureur", 5, 300),
    validUntil: dateOnly_(a.rcValidUntil, "Fin de validité RC Pro") };
  if (ins.rcPro) assert_(ins.rcPro.validUntil >= todayStr_(), "Votre attestation RC Pro est expirée : renseignez une assurance en cours de validité.");
  if (fr && trades.some(function (t) { return DECENNALE_TRADES_.indexOf(t) >= 0; })) {
    ins.decennale = { insurer: reqText_(a.decInsurer, "Assureur décennale", 2, 120), policy: reqText_(a.decPolicy, "N° de police décennale", 2, 60), validUntil: dateOnly_(a.decValidUntil, "Fin de validité décennale") };
    assert_(ins.decennale.validUntil >= todayStr_(), "Votre attestation décennale est expirée.");
  }
  return { businessType: businessType, trades: trades, zones: optText_(a.zones, 300).split(",").map(function (z) { return z.trim(); }).filter(Boolean).slice(0, 20), person: person, legal: legal, insurance: ins };
}

/* --------------------------- Routes publiques --------------------------- */
function signupInfo_() {
  const plans = dbAll_("SubscriptionPlans").filter(function (pl) { return pl.status === "ACTIVE"; }).sort(function (x, y) { return num_(x.sortOrder) - num_(y.sortOrder); }).map(planOut_);
  const e = edition_();
  return { country: e.code, countryName: e.countryName, currency: e.currency, plans: plans, status: platformStatusText_(), legalForms: signupLegalForms_(), trades: PROVIDER_TRADES_,
    decennaleTrades: e.code === "FR" ? DECENNALE_TRADES_ : [], docRules: { AE: providerDocRules_("AE", [], false), COMPANY: providerDocRules_("COMPANY", [], false) },
    cardPayment: sumupEnabled_(), publisher: legalValues_().publisherName || "ECO SYNERGY" };
}

/** 1. Contrôle des informations, envoi du code de confirmation par e-mail. Rien n'est encore créé. */
function signupStart_(a) {
  const meta = requestMeta_(), kind = oneOf_(String(a.kind || ""), ["CLIENT", "PROVIDER"], "Type d'inscription");
  rateLimit_("signup-ip:" + (meta.ip || "?"), 12, 3600);
  const email = validateEmail_(a.email);
  rateLimit_("signup-mail:" + email, 5, 3600);
  assert_(a.acceptTerms === true, "Acceptez les conditions générales pour continuer.");
  assert_(a.acceptStatus === true, "Confirmez avoir pris connaissance du statut de la plateforme.");
  assert_(a.acceptPrivacy === true, "Acceptez la politique de confidentialité pour continuer.");
  const pw = validatePassword_(a.password);
  if (dbAll_("Users").some(function (u) { return normalizeEmail_(u.email) === email; }))
    throw new AppError("VALIDATION", "Un compte existe déjà avec cette adresse e-mail. Connectez-vous, ou utilisez « Mot de passe oublié ».");
  const data = kind === "CLIENT" ? signupClientInput_(a) : signupProviderInput_(a);
  if (kind === "PROVIDER") assert_(platformOrgId_(), "Le référencement des artisans n'est pas encore ouvert sur cette plateforme.", "CONFIG");
  const salt = sha256Hex_(randomToken_()).slice(0, 32), iters = pbkdfIters_();
  data.pw = { hash: pbkdf2Hex_(pw, salt, iters), salt: salt, iters: iters };
  data.locale = oneOf_(String(a.locale || "fr"), IMMO_LANGS_, "Langue");
  data.consent = { at: nowIso_(), ip: meta.ip, userAgent: meta.userAgent, cgvVersion: LEGAL_VERSION_ };
  const code = signupCode_();
  const row = withLock_(function () {
    dbAll_("SignupRequests").filter(function (r) { return normalizeEmail_(r.email) === email && r.status === "PENDING"; })
      .forEach(function (r) { dbUpdate_("SignupRequests", r.requestId, { status: "REPLACED" }); });
    return dbInsert_("SignupRequests", { kind: kind, email: email, codeHash: "", attempts: 0, expiresAt: new Date(Date.now() + SIGNUP_CODE_MINUTES_ * 60000).toISOString(),
      payloadJson: data, status: "PENDING", createdAt: nowIso_(), ip: meta.ip, sends: 1, lastSentAt: nowIso_() });
  });
  dbUpdate_("SignupRequests", row.requestId, { codeHash: sha256Hex_(row.requestId + ":" + code) });
  signupSendCode_(email, code, kind, row.requestId);
  auditAs_(email, "", "SIGNUP_STARTED", "SignupRequest", row.requestId, "", { kind: kind, profile: data.profile || data.businessType });
  return { requestId: row.requestId, destination: maskEmailAddr_(email), expiresInMinutes: SIGNUP_CODE_MINUTES_ };
}
function signupCode_() { return (parseInt(randomToken_().slice(0, 12), 16) % 1000000 + 1000000).toString().slice(1); }
function signupSendCode_(email, code, kind, requestId) {
  const body = "Bonjour,\n\nVoici votre code de confirmation pour " + (kind === "PROVIDER" ? "votre référencement artisan" : "la création de votre compte") + " ImmoPilot :\n\n" + code +
    "\n\nIl est valable " + SIGNUP_CODE_MINUTES_ + " minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun compte ne sera créé.\n\nImmoPilot";
  sendMailSafe_(email, "Votre code de confirmation ImmoPilot : " + code, body, "signup:" + requestId + ":" + Date.now());
}
function signupLoad_(requestId) {
  const r = dbGet_("SignupRequests", safeText_(requestId, 120));
  assert_(r && r.status === "PENDING", "Demande d'inscription introuvable ou déjà utilisée. Recommencez l'inscription.");
  assert_(parseTs_(r.expiresAt) && parseTs_(r.expiresAt).getTime() > Date.now(), "Code expiré. Demandez un nouveau code.");
  return r;
}
function signupResend_(a) {
  const meta = requestMeta_();
  rateLimit_("signup-ip:" + (meta.ip || "?"), 12, 3600);
  const r = dbGet_("SignupRequests", safeText_(a.requestId, 120));
  assert_(r && r.status === "PENDING", "Demande d'inscription introuvable. Recommencez l'inscription.");
  assert_((Number(r.sends) || 0) < SIGNUP_MAX_SENDS_, "Trop de codes envoyés. Recommencez l'inscription dans une heure.");
  const code = signupCode_();
  dbUpdate_("SignupRequests", r.requestId, { codeHash: sha256Hex_(r.requestId + ":" + code), attempts: 0, sends: (Number(r.sends) || 0) + 1, lastSentAt: nowIso_(),
    expiresAt: new Date(Date.now() + SIGNUP_CODE_MINUTES_ * 60000).toISOString() });
  signupSendCode_(r.email, code, r.kind, r.requestId);
  return { ok: true, destination: maskEmailAddr_(r.email), expiresInMinutes: SIGNUP_CODE_MINUTES_ };
}

/** 2. Code correct : création du compte (et de l'organisation et de l'abonnement, ou de la fiche artisan), puis connexion. */
function signupConfirm_(a) {
  const meta = requestMeta_();
  rateLimit_("signup-confirm:" + (meta.ip || "?"), 30, 3600);
  const r = signupLoad_(a.requestId), code = String(a.code || "").replace(/\s/g, "");
  assert_(/^\d{6}$/.test(code), "Saisissez le code à 6 chiffres reçu par e-mail.");
  if (!safeEq_(sha256Hex_(r.requestId + ":" + code), r.codeHash)) {
    const n = (Number(r.attempts) || 0) + 1;
    dbUpdate_("SignupRequests", r.requestId, { attempts: n, status: n >= SIGNUP_MAX_TRIES_ ? "FAILED" : "PENDING" });
    throw new AppError("VALIDATION", n >= SIGNUP_MAX_TRIES_ ? "Trop d'essais : recommencez l'inscription." : "Code incorrect (" + (SIGNUP_MAX_TRIES_ - n) + " essai(s) restant(s)).");
  }
  const d = parseJson_(r.payloadJson, null);
  assert_(d && d.pw, "Demande d'inscription illisible. Recommencez l'inscription.");
  const created = withLock_(function () {
    const again = dbGet_("SignupRequests", r.requestId);
    assert_(again && again.status === "PENDING", "Demande déjà utilisée.");
    assert_(!dbAll_("Users").some(function (u) { return normalizeEmail_(u.email) === normalizeEmail_(r.email); }), "Un compte existe déjà avec cette adresse e-mail. Connectez-vous.");
    const user = dbInsert_("Users", { email: r.email, displayName: d.person.firstName + " " + d.person.lastName, status: "ACTIVE", createdAt: nowIso_(), createdBy: "inscription en ligne",
      passwordHash: d.pw.hash, passwordSalt: d.pw.salt, passwordIters: d.pw.iters, failedAttempts: 0, locale: d.locale || "fr", phone: d.person.phone, pwChangedAt: nowIso_(), updatedAt: nowIso_() });
    const out = r.kind === "CLIENT" ? signupCreateClient_(user, d) : signupCreateProvider_(user, d);
    dbUpdate_("SignupRequests", r.requestId, { status: "DONE", usedAt: nowIso_(), payloadJson: { kind: r.kind, userId: user.userId } }); // le hachage du mot de passe n'est plus conservé ici
    out.user = user; return out;
  });
  const token = createSession_(created.user, meta.userAgent);
  const p = buildPrincipal_(created.user);
  CTX_.principal = p;
  auditAs_(r.email, created.user.userId, "SIGNUP_COMPLETED", r.kind === "CLIENT" ? "Organization" : "Artisan", created.id, created.orgId || "", { kind: r.kind, consent: d.consent });
  return { token: token, me: meBootstrap_(p), meta: metaGet_(p), next: r.kind === "CLIENT" ? "onboarding" : "referencing" };
}

function signupCreateClient_(user, d) {
  const e = edition_(), c = d.company || {};
  const org = dbInsert_("Organizations", { name: d.orgName, status: "ACTIVE", type: d.profile === "AGENCY" ? "AGENCY" : "OWNER_ORG", city: d.person.city, country: e.country, timezone: tz_(), locale: d.locale || "fr",
    billingEmail: user.email, phone: d.person.phone, address: c.address || d.address || "", contactName: user.displayName, legalJson: Object.assign({ ownerType: d.ownerType || "", profile: d.profile }, c),
    signupSource: "SELF", createdAt: nowIso_(), createdBy: user.email, updatedAt: nowIso_() });
  // Une agence inscrite seule enregistre aussi les biens de ses mandants : elle reçoit le rôle d'administration d'agence ET de propriétaire.
  (d.profile === "AGENCY" ? ["AGENCY_ADMIN", "OWNER"] : ["OWNER"]).forEach(function (role) {
    dbInsert_("UserRoles", { userId: user.userId, organizationId: org.organizationId, role: role, status: "ACTIVE", createdAt: nowIso_(), createdBy: user.email });
  });
  const plan = dbGet_("SubscriptionPlans", d.planCode);
  subCreate_(org.organizationId, plan, Number(plan.trialDays) > 0, todayStr_(), user.email);
  notify_({ eventKey: "signup-client:" + org.organizationId, userIds: superAdminIds_(), type: "SIGNUP", organizationId: "", title: "Nouvelle inscription : " + org.name,
    body: (d.profile === "AGENCY" ? "Agence" : "Propriétaire") + " · forfait " + plan.name + " · " + user.email + " · " + d.person.phone, link: "#accounts" });
  return { id: org.organizationId, orgId: org.organizationId };
}

function signupCreateProvider_(user, d) {
  const pf = platformOrgId_();
  assert_(pf, "Organisation plateforme absente.", "CONFIG");
  const L = d.legal || {};
  const row = dbInsert_("Artisans", { organizationId: pf, name: L.legalName || user.displayName, email: user.email, phone: d.person.phone, categoriesJson: d.trades, zonesJson: d.zones || [],
    status: "PENDING", createdAt: nowIso_(), createdBy: user.email, userId: user.userId, legalName: L.legalName || "", taxId: L.siret || L.ice || "", billingInfo: L.address || "",
    updatedAt: nowIso_(), businessType: d.businessType, legalJson: L, insuranceJson: d.insurance, reviewJson: {}, source: "SIGNUP" });
  // Rôles du prestataire (comme une invitation par l'administrateur) : ils ne donnent accès à aucun bien tant que la fiche n'est pas « Référencé ».
  const roles = [];
  if (d.trades.indexOf("CLEANING") >= 0) roles.push("CLEANER");
  if (d.trades.some(function (t) { return t !== "CLEANING"; })) roles.push("ARTISAN");
  roles.forEach(function (role) { dbInsert_("UserRoles", { userId: user.userId, organizationId: pf, role: role, status: "ACTIVE", createdAt: nowIso_(), createdBy: user.email }); });
  return { id: row.artisanId, orgId: pf };
}

/** Vrai tant qu'un client inscrit en ligne n'a pas signé son contrat (ou enregistré sa carte quand le paiement par carte est ouvert). */
function signupOnboardingPending_(p) {
  return p.roles.some(function (r) {
    if (r.caps.indexOf("settings.manage") < 0) return false;
    const org = dbGet_("Organizations", r.organizationId);
    if (!org || org.signupSource !== "SELF") return false;
    const s = entitlement_(org.organizationId).subscription;
    if (!s || ["CANCELLED", "EXPIRED"].indexOf(s.status) >= 0) return false;
    return !subSignatureOf_(org.organizationId, s) || (sumupEnabled_() && !sumupCardOf_(org.organizationId));
  });
}

/* --------------------------- Espace artisan : mon référencement --------------------------- */
function myProviderRow_(p) {
  return dbAll_("Artisans").filter(function (a) { return a.source === "SIGNUP" && String(a.userId) === String(p.userId) && a.status !== "BLOCKED"; })
    .sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); })[0] || null;
}
/** Pièces déposées (actives) par code, avec leur statut de contrôle. */
function providerDocs_(c) {
  const rev = parseJson_(c.reviewJson, {}) || {};
  return dbAll_("Documents").filter(function (x) { return x.ownerType === "CONTRACTOR" && String(x.ownerId) === String(c.artisanId) && x.status === "ACTIVE" && PROVIDER_DOC_CODES_.indexOf(x.category) >= 0; })
    .sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); })
    .map(function (x) { const r = rev[x.documentId] || {}; return { documentId: x.documentId, code: x.category, fileName: x.fileName, createdAt: x.createdAt, review: r.status || "PENDING", reason: r.reason || "", reviewedAt: r.at || "" }; });
}
function providerState_(c) {
  const ins = parseJson_(c.insuranceJson, {}) || {}, trades = parseJson_(c.categoriesJson, []);
  const rules = providerDocRules_(c.businessType || "AE", trades, !!ins.hasRcPro), docs = providerDocs_(c);
  const today = todayStr_();
  const checklist = rules.map(function (r) {
    const list = docs.filter(function (x) { return x.code === r.code && x.review !== "REJECTED"; });
    const rejected = docs.filter(function (x) { return x.code === r.code && x.review === "REJECTED"; })[0];
    return Object.assign({}, r, { provided: list.length > 0, approved: list.some(function (x) { return x.review === "APPROVED"; }), docs: list, lastRejection: !list.length && rejected ? rejected.reason || "Pièce refusée" : "" });
  });
  const expired = [];
  if (ins.rcPro && ins.rcPro.validUntil < today) expired.push("RC Pro");
  if (ins.decennale && ins.decennale.validUntil < today) expired.push("Décennale");
  return { checklist: checklist, missing: checklist.filter(function (x) { return !x.provided; }).map(function (x) { return x.label; }), allApproved: checklist.every(function (x) { return x.approved; }), expired: expired };
}
function providerOut_(c, forAdmin) {
  const st = providerState_(c);
  const o = { artisanId: c.artisanId, name: c.name, email: c.email, phone: c.phone, status: c.status, businessType: c.businessType, trades: parseJson_(c.categoriesJson, []), zones: parseJson_(c.zonesJson, []),
    legal: parseJson_(c.legalJson, {}), insurance: parseJson_(c.insuranceJson, {}), submittedAt: c.submittedAt || "", verifiedAt: c.verifiedAt || "", rejectReason: c.rejectReason || "",
    checklist: st.checklist, missing: st.missing, allApproved: st.allApproved, expired: st.expired, otherDocs: providerDocs_(c).filter(function (x) { return x.code === "OTHER_PROOF"; }),
    country: edition_().code, legalForms: signupLegalForms_().COMPANY, decennaleTrades: edition_().code === "FR" ? DECENNALE_TRADES_ : [], status_: platformStatusText_().providerPoints };
  if (forAdmin) o.createdAt = c.createdAt;
  return o;
}
function providerMe_(p) {
  const c = myProviderRow_(p);
  assert_(c, "Aucune fiche de référencement liée à votre compte.");
  return providerOut_(c, false);
}
/** Mise à jour des informations par l'artisan : tant qu'il n'est pas référencé ; une fois référencé, seuls assurance, zones et téléphone. */
function providerSave_(p, a) {
  const c = myProviderRow_(p);
  assert_(c, "Aucune fiche de référencement liée à votre compte.");
  const locked = c.status === "ACTIVE";
  const prevIns = parseJson_(c.insuranceJson, {}) || {}, prevLegal = parseJson_(c.legalJson, {}) || {};
  const names = String((dbGet_("Users", p.userId) || {}).displayName || "").split(" ");
  // On repasse par la validation complète de l'inscription (mêmes règles), avec les valeurs actuelles comme base.
  const src = Object.assign({}, prevLegal, { trades: parseJson_(c.categoriesJson, []), businessType: c.businessType, zones: parseJson_(c.zonesJson, []).join(", "), phone: c.phone,
    firstName: names[0] || "-", lastName: names.slice(1).join(" ") || "-",
    hasRcPro: !!prevIns.hasRcPro, rcInsurer: (prevIns.rcPro || {}).insurer, rcPolicy: (prevIns.rcPro || {}).policy, rcInsurerAddress: (prevIns.rcPro || {}).insurerAddress, rcValidUntil: (prevIns.rcPro || {}).validUntil,
    decInsurer: (prevIns.decennale || {}).insurer, decPolicy: (prevIns.decennale || {}).policy, decValidUntil: (prevIns.decennale || {}).validUntil });
  ["legalName", "legalForm", "capital", "address", "managerName", "siret", "rcsCity", "vatNumber", "ice", "rcNumber", "rcCity", "ifNumber", "patente", "cnss", "aeNumber"].forEach(function (k) { if (!locked && a[k] !== undefined) src[k] = a[k]; });
  if (!locked && a.trades !== undefined) src.trades = a.trades;
  if (!locked && a.businessType !== undefined) src.businessType = a.businessType;
  ["zones", "phone", "hasRcPro", "rcInsurer", "rcPolicy", "rcInsurerAddress", "rcValidUntil", "decInsurer", "decPolicy", "decValidUntil"].forEach(function (k) { if (a[k] !== undefined) src[k] = a[k]; });
  const d = signupProviderInput_(src);
  const patch = { phone: d.person.phone, zonesJson: d.zones, insuranceJson: d.insurance, updatedAt: nowIso_() };
  if (!locked) Object.assign(patch, { categoriesJson: d.trades, businessType: d.businessType, legalJson: d.legal, legalName: d.legal.legalName, name: d.legal.legalName, taxId: d.legal.siret || d.legal.ice || "", billingInfo: d.legal.address || "" });
  if (c.status === "REJECTED") Object.assign(patch, { status: "PENDING", rejectReason: "" });
  dbUpdate_("Artisans", c.artisanId, patch);
  audit_("PROVIDER_PROFILE_SAVED", "Artisan", c.artisanId, c.organizationId, { locked: locked });
  return providerOut_(dbGet_("Artisans", c.artisanId), false);
}
/** Envoi du dossier pour contrôle : toutes les pièces exigées doivent être déposées. */
function providerSubmit_(p) {
  const c = myProviderRow_(p);
  assert_(c, "Aucune fiche de référencement liée à votre compte.");
  const st = providerState_(c);
  assert_(!st.missing.length, "Pièces manquantes : " + st.missing.join(" ; ") + ".");
  assert_(!st.expired.length, "Assurance expirée (" + st.expired.join(", ") + ") : mettez à jour vos informations et l'attestation.");
  dbUpdate_("Artisans", c.artisanId, { status: c.status === "ACTIVE" ? "ACTIVE" : "PENDING", submittedAt: nowIso_(), rejectReason: "", updatedAt: nowIso_() });
  notify_({ eventKey: "provider-submit:" + c.artisanId + ":" + Date.now(), userIds: superAdminIds_(), type: "PROVIDER_REVIEW", organizationId: "", title: "Référencement à contrôler : " + c.name,
    body: parseJson_(c.categoriesJson, []).join(", ") + " · " + c.email + " · " + c.phone, link: "#contractors/" + c.artisanId });
  audit_("PROVIDER_SUBMITTED", "Artisan", c.artisanId, c.organizationId, {});
  return { ok: true, message: "Dossier transmis. Vous recevrez un e-mail dès que le contrôle sera terminé (en général sous 2 jours ouvrés)." };
}

/* --------------------------- Contrôle par le super administrateur --------------------------- */
function providerLoadAdmin_(p, artisanId) {
  requireSuper_(p);
  const c = dbGet_("Artisans", safeText_(artisanId, 120));
  assert_(c && isPlatformContractor_(c), "Prestataire introuvable.");
  return c;
}
function providerReviewList_(p, a) {
  requireSuper_(p);
  const want = a && a.status ? [String(a.status)] : ["PENDING", "REJECTED"];
  return dbAll_("Artisans").filter(function (c) { return c.source === "SIGNUP" && isPlatformContractor_(c) && want.indexOf(c.status) >= 0; })
    .sort(function (x, y) { return String(y.submittedAt || y.createdAt).localeCompare(String(x.submittedAt || x.createdAt)); })
    .map(function (c) { const st = providerState_(c); return { artisanId: c.artisanId, name: c.name, email: c.email, phone: c.phone, status: c.status, businessType: c.businessType, trades: parseJson_(c.categoriesJson, []),
      submittedAt: c.submittedAt || "", createdAt: c.createdAt, missing: st.missing.length, toReview: st.checklist.filter(function (x) { return x.provided && !x.approved; }).length, expired: st.expired }; });
}
function providerReviewDoc_(p, a) {
  const c = providerLoadAdmin_(p, a.artisanId), docId = safeText_(a.documentId, 120);
  const doc = dbGet_("Documents", docId);
  assert_(doc && doc.ownerType === "CONTRACTOR" && String(doc.ownerId) === String(c.artisanId), "Pièce introuvable.");
  const decision = oneOf_(String(a.decision || ""), ["APPROVED", "REJECTED"], "Décision");
  const reason = decision === "REJECTED" ? reqText_(a.reason, "Motif du refus", 3, 300) : "";
  const rev = parseJson_(c.reviewJson, {}) || {};
  rev[docId] = { status: decision, reason: reason, at: nowIso_(), by: p.email };
  dbUpdate_("Artisans", c.artisanId, { reviewJson: rev, updatedAt: nowIso_() });
  audit_("PROVIDER_DOC_REVIEWED", "Artisan", c.artisanId, c.organizationId, { documentId: docId, decision: decision });
  return providerOut_(dbGet_("Artisans", c.artisanId), true);
}
function providerDecide_(p, a) {
  const c = providerLoadAdmin_(p, a.artisanId), decision = oneOf_(String(a.decision || ""), ["APPROVE", "REJECT", "SUSPEND"], "Décision");
  const st = providerState_(c), url = safeAppUrl_();
  if (decision === "APPROVE") {
    assert_(st.allApproved, "Validez d'abord chaque pièce exigée.");
    assert_(!st.expired.length, "Assurance expirée : le prestataire doit la mettre à jour.");
    dbUpdate_("Artisans", c.artisanId, { status: "ACTIVE", verifiedAt: nowIso_(), verifiedBy: p.email, rejectReason: "", updatedAt: nowIso_() });
    sendMailSafe_(c.email, "Votre référencement ImmoPilot est validé", "Bonjour,\n\nBonne nouvelle : votre dossier est validé. Vous êtes désormais référencé(e) dans l'annuaire ImmoPilot pour : " +
      parseJson_(c.categoriesJson, []).join(", ") + ".\n\nLes propriétaires et agences peuvent vous envoyer des demandes de devis et d'intervention. Connectez-vous : " + url + "\n\nPensez à mettre à jour vos attestations avant leur expiration.\n\nImmoPilot", "provider-approved:" + c.artisanId + ":" + Date.now());
  } else {
    const reason = reqText_(a.reason, "Motif", 3, 500);
    dbUpdate_("Artisans", c.artisanId, { status: decision === "REJECT" ? "REJECTED" : "INACTIVE", rejectReason: reason, updatedAt: nowIso_() });
    sendMailSafe_(c.email, decision === "REJECT" ? "Votre dossier de référencement ImmoPilot est à compléter" : "Votre référencement ImmoPilot est suspendu",
      "Bonjour,\n\n" + (decision === "REJECT" ? "Votre dossier ne peut pas être validé en l'état" : "Votre référencement est suspendu") + " pour le motif suivant :\n\n" + reason +
      "\n\nCorrigez vos informations ou déposez les pièces demandées depuis votre espace (Mon référencement), puis renvoyez votre dossier : " + url + "\n\nImmoPilot", "provider-" + decision + ":" + c.artisanId + ":" + Date.now());
  }
  audit_("PROVIDER_" + decision, "Artisan", c.artisanId, c.organizationId, {});
  return providerOut_(dbGet_("Artisans", c.artisanId), true);
}

/** Chaque jour : rappel 30 jours avant l'expiration d'une assurance, suspension du référencement après expiration. */
function providerExpiryJob_() {
  const today = todayStr_(), soon = addDaysStr_(today, 30), url = safeAppUrl_();
  let reminded = 0, suspended = 0;
  dbAll_("Artisans").filter(function (c) { return c.source === "SIGNUP" && c.status === "ACTIVE"; }).forEach(function (c) {
    const ins = parseJson_(c.insuranceJson, {}) || {};
    [["rcPro", "responsabilité civile professionnelle"], ["decennale", "décennale"]].forEach(function (k) {
      const x = ins[k[0]]; if (!x || !x.validUntil) return;
      if (x.validUntil < today) {
        dbUpdate_("Artisans", c.artisanId, { status: "INACTIVE", rejectReason: "Attestation d'assurance " + k[1] + " expirée le " + x.validUntil + ".", updatedAt: nowIso_() });
        sendMailSafe_(c.email, "Référencement ImmoPilot suspendu : assurance expirée", "Bonjour,\n\nVotre attestation d'assurance " + k[1] + " a expiré le " + x.validUntil +
          ". Votre référencement est suspendu jusqu'au dépôt d'une attestation à jour dans votre espace (Mon référencement) : " + url + "\n\nImmoPilot", "provider-expired:" + c.artisanId + ":" + k[0] + ":" + x.validUntil);
        suspended++;
      } else if (x.validUntil <= soon) {
        sendMailSafe_(c.email, "Votre assurance expire bientôt", "Bonjour,\n\nVotre attestation d'assurance " + k[1] + " expire le " + x.validUntil +
          ". Déposez la nouvelle attestation dans votre espace (Mon référencement) pour rester référencé(e) : " + url + "\n\nImmoPilot", "provider-expiring:" + c.artisanId + ":" + k[0] + ":" + x.validUntil);
        reminded++;
      }
    });
  });
  return { reminded: reminded, suspended: suspended };
}
