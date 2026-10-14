/**
 * ENVIRONNEMENT DE DÉMONSTRATION (test, présentation, vérificateurs Google Play).
 *
 * À exécuter UNE fois depuis l'éditeur Apps Script : creerEnvironnementDemo().
 * - Crée (ou complète, si on relance) les organisations, comptes, biens, droits d'agence, gardiens et le prestataire
 *   décrits dans DEMO_SPEC_ ; toutes les organisations et tous les biens portent le préfixe « DÉMO ».
 * - Ne supprime et ne modifie aucune donnée existante : un compte déjà présent garde son mot de passe et ses rôles ;
 *   seuls son nom (s'il n'a jamais été renseigné) et son téléphone (s'il est vide) sont complétés.
 * - Chaque nouveau compte reçoit un e-mail d'activation (lien valable 72 h, à usage unique) pour choisir son mot de passe.
 *   Un lien expiré se renvoie depuis l'application : Utilisateurs › « Envoyer le lien d'activation ».
 *
 * HISTORIQUE FICTIF (facultatif) : creerHistoriqueDemo() ajoute ensuite 6 mois d'activité sur ces biens (réservations, arrivées et départs,
 * ménages, incidents, devis, interventions, factures, dépenses, bail et loyers) pour alimenter tableaux de bord, finances et analyses de Pareto.
 * Toutes ces données sont fictives et marquées « DEMO » ; la fonction ne s'exécute qu'une fois.
 */
var DEMO_PHONE_ = "+33749980918";
/** L'application affiche une seule devise (MAD) : les prix donnés en euros sont convertis à ce taux arrondi et rappelés en euros dans la fiche. */
var DEMO_EUR_MAD_ = 11;
var DEMO_SPEC_ = {
  superAdmin: { email: "abder.loulou@icloud.com", name: "Éric Dupont" },
  owner: { email: "abderhmane.loulou@icloud.com", name: "Jean Bernard", org: "DÉMO – Jean Bernard (propriétaire)" },
  agency: { email: "ecosynergy31@gmail.com", name: "Moad Zaira", org: "DÉMO – Agence Moad Zaira" },
  provider: { email: "speedfibre69@gmail.com", name: "Mohamed Zetounie",
    notes: "Tous corps de métier : intervention sur devis.\nMénage à prix fixe : appartement 200 MAD (2 h) ; villa 400 MAD (2 h).\nContact WhatsApp : " + DEMO_PHONE_ + "." },
  pricingNote: "Prix demandé par le propriétaire à l'agence : {EUR} € la nuit, soit {MAD} MAD (prix fixe, 1 € ≈ " + DEMO_EUR_MAD_ + " MAD).\nPrix de vente au voyageur : libre, fixé par l'agence Moad Zaira.\n" +
    "Ménage : organisé par l'agence (prestataire choisi dans la liste ImmoPilot), facturé au propriétaire qui le règle directement.",
  properties: [
    { key: "duplex", name: "DÉMO – Duplex 3 suites", rentalMode: "SHORT_TERM", propertyType: "APARTMENT", bedrooms: 3, bathrooms: 3, capacity: 6, eur: 120,
      rooms: ["Séjour", "Cuisine", "Suite 1", "Suite 2", "Suite 3", "Terrasse"], agency: true,
      guard: { email: "ecosynergy31+gardien.duplex@gmail.com", name: "Gardien Duplex (démo)" } },
    { key: "deux", name: "DÉMO – Appartement 2 chambres", rentalMode: "SHORT_TERM", propertyType: "APARTMENT", bedrooms: 2, bathrooms: 1, capacity: 4, eur: 80,
      rooms: ["Séjour", "Cuisine", "Chambre 1", "Chambre 2", "Salle de bain"], agency: true,
      guard: { email: "ecosynergy31+gardien.appartement@gmail.com", name: "Gardien Appartement (démo)" } },
    { key: "long", name: "DÉMO – Appartement longue durée", rentalMode: "LONG_TERM", propertyType: "APARTMENT", agency: false,
      description: "Bien en location longue durée, géré directement par le propriétaire.",
      guard: { email: "ecosynergy31+gardien.longue@gmail.com", name: "Gardien Longue durée (démo)" } }
  ]
};

function creerEnvironnementDemo() {
  const editor = assertEditor_();
  ctxReset_(); dbReset_();
  const r = demoBuild_(editor);
  Logger.log(demoSummaryText_(r));
  return r;
}

/** Construit l'environnement au nom du super administrateur `actorEmail` (doit déjà exister). Relançable sans doublon. */
function demoBuild_(actorEmail) {
  const S = DEMO_SPEC_, report = { organizations: [], accounts: [], properties: [], agencyAccess: [], guards: [], provider: null, notes: [] };
  const platformId = platformOrgId_();
  assert_(platformId, "Organisation plateforme absente : exécutez d'abord setupProject().", "CONFIG");
  const actor = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === normalizeEmail_(actorEmail); });
  assert_(actor, "Votre compte super administrateur est introuvable : exécutez d'abord createFirstSuperAdmin().", "CONFIG");
  const sp = buildPrincipal_(actor);
  assert_(sp.isSuper, "Seul un super administrateur peut créer l'environnement de démonstration.", "FORBIDDEN");
  demoAs_(sp);

  // 1. Organisations
  const ownerOrg = demoOrg_(sp, S.owner.org, "OWNER_ORG", S.owner.email, report);
  const agencyOrg = demoOrg_(sp, S.agency.org, "AGENCY", S.agency.email, report);
  demoMarkOrgs_([ownerOrg, agencyOrg], sp.email);

  // 2. Comptes (créés sans mot de passe ; l'activation se fait par e-mail)
  demoAccount_(S.superAdmin.email, S.superAdmin.name, "SUPER_ADMIN", platformId, report);
  const ownerU = demoAccount_(S.owner.email, S.owner.name, "OWNER", ownerOrg.organizationId, report);
  demoAccount_(S.agency.email, S.agency.name, "AGENCY_ADMIN", agencyOrg.organizationId, report);

  // 3. Prestataire de l'annuaire plateforme : tous les types de prestation, ménage compris
  const provU = demoAccount_(S.provider.email, S.provider.name, "CLEANER", platformId, report);
  demoAccount_(S.provider.email, S.provider.name, "ARTISAN", platformId, report);
  let art = dbAll_("Artisans").find(function (c) { return String(c.organizationId) === platformId && normalizeEmail_(c.email) === normalizeEmail_(S.provider.email) && c.status !== "BLOCKED"; });
  if (!art) {
    const created = ctrCreate_(sp, { name: S.provider.name, email: S.provider.email, phone: DEMO_PHONE_, specialties: getSetting_("list.specialties", platformId),
      zones: ["Marrakech"], notes: S.provider.notes, inviteAccount: false });
    art = dbGet_("Artisans", created.artisanId);
    report.provider = { artisanId: art.artisanId, created: true };
  } else report.provider = { artisanId: art.artisanId, created: false };
  if (!art.userId) dbUpdate_("Artisans", art.artisanId, { userId: provU.userId, updatedAt: nowIso_() });
  report.provider.specialties = parseJson_(dbGet_("Artisans", art.artisanId).categoriesJson, []);

  // 4. Biens du propriétaire (créés en son nom), attribution à l'agence et gardiens
  const op = buildPrincipal_(dbGet_("Users", ownerU.userId));
  S.properties.forEach(function (d) {
    let prop = dbAll_("Properties").find(function (x) { return String(x.organizationId) === String(ownerOrg.organizationId) && x.name === d.name && ["ARCHIVED", "DELETED"].indexOf(x.status) < 0; });
    const created = !prop;
    if (!prop) {
      demoAs_(op);
      const input = { organizationId: ownerOrg.organizationId, name: d.name, city: "Marrakech", rentalMode: d.rentalMode, propertyType: d.propertyType,
        description: demoDescription_(d), checkInTime: "15:00", checkOutTime: "11:00", currency: "MAD" };
      if (d.eur) input.nightlyPrice = d.eur * DEMO_EUR_MAD_;
      ["bedrooms", "bathrooms", "capacity", "rooms"].forEach(function (k) { if (d[k] !== undefined) input[k] = d[k]; });
      prop = dbGet_("Properties", propertyCreate_(op, input).propertyId);
      demoAs_(sp);
    } else if (prop.currency === "EUR" && d.eur && Number(prop.nightlyPrice) === d.eur) {
      // Première version de la démo (prix stockés en euros) : conversion en MAD, devise affichée par l'application.
      dbUpdate_("Properties", prop.propertyId, { currency: "MAD", nightlyPrice: d.eur * DEMO_EUR_MAD_, description: demoDescription_(d), updatedAt: nowIso_(), updatedBy: sp.email });
      prop = dbGet_("Properties", prop.propertyId);
    }
    report.properties.push({ key: d.key, propertyId: prop.propertyId, name: prop.name, created: created, nightlyPrice: prop.nightlyPrice, currency: prop.currency, rentalMode: prop.rentalMode });
    if (d.agency) {
      demoAs_(op);
      const perm = propertyAgencySet_(op, { propertyId: prop.propertyId, agencyOrganizationId: agencyOrg.organizationId, canView: true,
        canManageReservations: true, canManageOperations: true, canViewFinance: true });
      demoAs_(sp);
      report.agencyAccess.push({ property: prop.name, permissionId: perm.permissionId });
    }
    const g = demoAccount_(d.guard.email, d.guard.name, "GUARD", ownerOrg.organizationId, report);
    demoAs_(op);
    const asg = propertyStaffAssign_(op, { propertyId: prop.propertyId, email: d.guard.email, role: "GUARD" });
    demoAs_(sp);
    report.guards.push({ property: prop.name, email: g.email, assignmentId: asg.assignmentId });
  });

  // 5. Liens d'activation (une seule fois par compte tant que le lien précédent est valable)
  report.accounts.forEach(function (acc) {
    if (acc.role === "ARTISAN") return; // même compte que CLEANER
    const u = dbGet_("Users", acc.userId);
    if (u.passwordHash) { acc.activation = "Compte déjà activé (mot de passe inchangé)."; return; }
    const pending = dbAll_("PasswordResets").some(function (r) { return String(r.userId) === String(u.userId) && r.purpose === "ACTIVATION" && !r.usedAt && parseTs_(r.expiresAt) && parseTs_(r.expiresAt).getTime() > Date.now(); });
    if (pending) { acc.activation = "Lien d'activation déjà envoyé et encore valable."; return; }
    try { sendPasswordLink_(u, "ACTIVATION"); acc.activation = "Lien d'activation envoyé par e-mail (72 h)."; }
    catch (e) { acc.activation = "ERREUR d'envoi : " + e.message; }
  });

  report.notes.push("Devise : l'application affiche les montants en MAD ; prix convertis à 1 € ≈ " + DEMO_EUR_MAD_ + " MAD (120 € = " + 120 * DEMO_EUR_MAD_ + " MAD, 80 € = " + 80 * DEMO_EUR_MAD_ + " MAD), rappelés en euros dans la description des biens.");
  report.notes.push("Ville par défaut : Marrakech (modifiable dans chaque fiche).");
  audit_("DEMO_ENVIRONMENT_BUILT", "System", "demo", ownerOrg.organizationId, { properties: report.properties.length, accounts: report.accounts.length });
  return report;
}

/**
 * Marque les organisations de démonstration : exclues des statistiques et de la facturation de la plateforme
 * (tableau de bord du super administrateur, abonnements), et sans e-mails automatiques (les notifications restent visibles dans l'application).
 */
function demoMarkOrgs_(orgs, actorEmail) {
  if (dbHeaders_("Organizations").indexOf("isDemo") < 0) migSchemaSync_(); // ajoute la colonne isDemo (opération additive)
  orgs.forEach(function (o) {
    if (o.isDemo !== true) dbUpdate_("Organizations", o.organizationId, { isDemo: true, updatedAt: nowIso_() });
    if (getSetting_("notify.emailEnabled", o.organizationId) !== false) setSetting_("notify.emailEnabled", false, o.organizationId, actorEmail);
  });
}

/**
 * Met la démonstration en veille (organisations suspendues : plus aucune connexion aux comptes de démo, données conservées)
 * ou la réactive. À n'utiliser qu'après la vérification Google Play : Google se connecte avec le compte de démonstration.
 */
function mettreDemoEnVeille() { const ed = assertEditor_(); ctxReset_(); dbReset_(); const r = demoSetSleep_(ed, true); Logger.log(JSON.stringify(r)); return r; }
function reveillerDemo() { const ed = assertEditor_(); ctxReset_(); dbReset_(); const r = demoSetSleep_(ed, false); Logger.log(JSON.stringify(r)); return r; }
function demoSetSleep_(actorEmail, sleep) {
  const actor = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === normalizeEmail_(actorEmail); });
  assert_(actor, "Compte super administrateur introuvable.", "CONFIG");
  const sp = buildPrincipal_(actor); assert_(sp.isSuper, "Réservé au super administrateur.", "FORBIDDEN"); demoAs_(sp);
  const orgs = dbAll_("Organizations").filter(function (o) { return o.isDemo === true; });
  assert_(orgs.length, "Aucune organisation de démonstration.");
  return { ok: true, status: sleep ? "SUSPENDED" : "ACTIVE", organizations: orgs.map(function (o) {
    if (o.status !== (sleep ? "SUSPENDED" : "ACTIVE")) orgSetStatus_(sp, { organizationId: o.organizationId, status: sleep ? "SUSPENDED" : "ACTIVE", reason: "Démonstration mise en veille (aucune donnée supprimée)" });
    return o.name;
  }) };
}

/** Change l'utilisateur courant et vide le cache des droits sur les biens (calculé pour l'utilisateur précédent). */
function demoAs_(p) { CTX_.principal = p; CTX_.propMemo = {}; }

/** Lignes de devis type : main-d'œuvre au taux horaire, déplacement, fournitures (total = montant HT). */
function demoQuoteLines_(label, ht) {
  const hours = Math.max(1, Math.round(ht * 0.35 / 150)), travel = 100, supplies = Math.max(0, ht - hours * 150 - travel);
  const lines = [{ description: "Main-d'œuvre — " + label, quantity: hours, unitPrice: 150, amount: hours * 150 }, { description: "Déplacement", quantity: 1, unitPrice: travel, amount: travel }];
  if (supplies > 0) lines.push({ description: "Fournitures et pièces", quantity: 1, unitPrice: supplies, amount: supplies });
  return lines;
}

function demoDescription_(d) {
  return d.description || DEMO_SPEC_.pricingNote.replace("{EUR}", d.eur).replace("{MAD}", d.eur * DEMO_EUR_MAD_);
}

function demoOrg_(sp, name, type, billingEmail, report) {
  let o = dbAll_("Organizations").find(function (x) { return String(x.name).toLowerCase() === name.toLowerCase() && x.status !== "INACTIVE"; });
  const created = !o;
  if (!o) o = dbGet_("Organizations", orgCreate_(sp, { name: name, type: type, city: "Marrakech", billingEmail: billingEmail, locale: "fr" }).organizationId);
  assert_(o.type === type, "L'organisation « " + name + " » existe déjà avec un autre type (" + o.type + ").");
  report.organizations.push({ organizationId: o.organizationId, name: o.name, type: o.type, created: created });
  return o;
}

/** Compte + rôle actif. Ne touche jamais au mot de passe ; complète seulement le nom (jamais saisi) et le téléphone (vide). */
function demoAccount_(email, name, role, orgId, report) {
  email = validateEmail_(email);
  let u = dbAll_("Users").find(function (x) { return normalizeEmail_(x.email) === email; });
  const created = !u;
  if (!u) u = dbInsert_("Users", { email: email, displayName: name, status: "ACTIVE", createdAt: nowIso_(), createdBy: "demo", locale: "fr", phone: DEMO_PHONE_, notifPrefsJson: { email: true, mutedTypes: [] } });
  else {
    const patch = {};
    if (!u.displayName || u.displayName === email.split("@")[0]) patch.displayName = name;
    if (!u.phone) patch.phone = DEMO_PHONE_;
    if (Object.keys(patch).length) { patch.updatedAt = nowIso_(); dbUpdate_("Users", u.userId, patch); }
    assert_(u.status !== "DISABLED", "Le compte " + email + " est désactivé : réactivez-le avant de relancer.");
  }
  const has = dbAll_("UserRoles").some(function (r) { return String(r.userId) === String(u.userId) && String(r.organizationId) === String(orgId) && r.role === role && r.status === "ACTIVE"; });
  if (!has) dbInsert_("UserRoles", { userId: u.userId, organizationId: orgId, role: role, status: "ACTIVE", createdAt: nowIso_(), createdBy: "demo", permissionsJson: "[]" });
  audit_(has ? "DEMO_ACCOUNT_CHECKED" : "DEMO_ROLE_GRANTED", "User", u.userId, orgId, { email: email, role: role });
  report.accounts.push({ email: email, name: name, role: role, userId: u.userId, created: created, roleAdded: !has });
  return { userId: u.userId, email: email };
}

function demoSummaryText_(r) {
  const L = ["=== Environnement de démonstration ImmoPilot ==="];
  r.organizations.forEach(function (o) { L.push("Organisation " + (o.created ? "créée" : "existante") + " : " + o.name + " (" + o.type + ")"); });
  r.accounts.filter(function (a) { return a.role !== "ARTISAN"; }).forEach(function (a) { L.push("Compte " + a.name + " <" + a.email + "> — " + a.role + (a.role === "CLEANER" ? " + ARTISAN" : "") + " — " + (a.activation || "")); });
  r.properties.forEach(function (p) { L.push("Bien " + (p.created ? "créé" : "existant") + " : " + p.name + " — " + p.rentalMode + (p.nightlyPrice ? " — " + p.nightlyPrice + " " + p.currency + "/nuit" : "")); });
  r.agencyAccess.forEach(function (x) { L.push("Agence Moad Zaira → " + x.property + " (consultation, réservations, opérations, finances)"); });
  r.guards.forEach(function (g) { L.push("Gardien " + g.email + " → " + g.property); });
  if (r.provider) L.push("Prestataire Mohamed Zetounie dans l'annuaire : " + r.provider.specialties.join(", "));
  r.notes.forEach(function (n) { L.push("Note : " + n); });
  return L.join("\n");
}

/* =========================== HISTORIQUE FICTIF DE 6 MOIS =========================== */

/** À exécuter depuis l'éditeur APRÈS creerEnvironnementDemo(). Une seule fois : une relance ne recrée rien. */
function creerHistoriqueDemo() {
  const editor = assertEditor_();
  ctxReset_(); dbReset_();
  const r = demoHistory_(editor, {});
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

/** Générateur pseudo-aléatoire reproductible (mêmes données à chaque installation). */
function demoRng_(seed) {
  let a = seed >>> 0;
  const next = function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    next: next,
    int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
    pick: function (list) { return list[Math.floor(next() * list.length)]; },
    weighted: function (pairs) { const tot = pairs.reduce(function (s, x) { return s + x[1]; }, 0); let u = next() * tot; for (let i = 0; i < pairs.length; i++) { u -= pairs[i][1]; if (u < 0) return pairs[i][0]; } return pairs[pairs.length - 1][0]; }
  };
}

var DEMO_GUESTS_ = ["Claire Martin", "Lucas Moreau", "Sofia Rossi", "James Walker", "Inès Haddad", "Thomas Müller", "Yasmine El Idrissi", "Paul Lefèvre", "Emma Johnson",
  "Hugo Garnier", "Lina Benjelloun", "Marco Bianchi", "Chloé Dubois", "Omar Tazi", "Anna Schmidt", "Julien Petit", "Sara Lopez", "Nathan Roux", "Leila Amrani", "Oliver Brown",
  "Camille Laurent", "Mehdi Alaoui", "Giulia Romano", "Antoine Faure", "Nora Chraibi", "Daniel Smith", "Léa Fontaine", "Karim Saidi", "Elena García", "Maxime Girard"];

/**
 * Crée l'historique. opts.today (AAAA-MM-JJ) sert aux tests. Retourne le nombre d'enregistrements par table.
 * Les lignes sont préparées en mémoire puis écrites en une fois par table (rapide, même sur Google Sheets).
 */
function demoHistory_(actorEmail, opts) {
  opts = opts || {};
  const S = DEMO_SPEC_, rnd = demoRng_(20261014), today = opts.today || todayStr_(), start = addDaysStr_(today, -182);
  const actor = dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === normalizeEmail_(actorEmail); });
  assert_(actor, "Compte super administrateur introuvable.", "CONFIG");
  const sp = buildPrincipal_(actor);
  assert_(sp.isSuper, "Réservé au super administrateur.", "FORBIDDEN");
  demoAs_(sp);
  const orgByName = function (n) { return dbAll_("Organizations").find(function (o) { return o.name === n && o.status === "ACTIVE"; }); };
  const ownerOrg = orgByName(S.owner.org), agencyOrg = orgByName(S.agency.org);
  assert_(ownerOrg && agencyOrg, "Lancez d'abord creerEnvironnementDemo().", "CONFIG");
  const userBy = function (email) { return dbAll_("Users").find(function (u) { return normalizeEmail_(u.email) === normalizeEmail_(email); }); };
  const ownerU = userBy(S.owner.email), agencyU = userBy(S.agency.email), provU = userBy(S.provider.email);
  const art = dbAll_("Artisans").find(function (c) { return String(c.organizationId) === platformOrgId_() && normalizeEmail_(c.email) === normalizeEmail_(S.provider.email); });
  const props = {};
  S.properties.forEach(function (d) {
    const pr = dbAll_("Properties").find(function (x) { return String(x.organizationId) === String(ownerOrg.organizationId) && x.name === d.name && ["ARCHIVED", "DELETED"].indexOf(x.status) < 0; });
    assert_(pr, "Bien « " + d.name + " » introuvable : relancez creerEnvironnementDemo().", "CONFIG");
    props[d.key] = { prop: pr, spec: d, guard: userBy(d.guard.email) };
  });
  assert_(ownerU && agencyU && provU && art && props.duplex.guard, "Environnement de démonstration incomplet : relancez creerEnvironnementDemo().", "CONFIG");
  const propIds = Object.keys(props).map(function (k) { return String(props[k].prop.propertyId); });
  const already = dbAll_("Reservations").some(function (r) { return propIds.indexOf(String(r.propertyId)) >= 0 && /^demo-hist:/.test(String(r.idempotencyKey || "")); });
  if (already) {
    const extra = demoExtras_(sp, ownerOrg, agencyOrg, props, provU, start, today);
    return { ok: true, already: true, message: "L'historique de démonstration existe déjà : seuls les éléments manquants (abonnements, listes et photos de ménage) ont été complétés.", extras: extra };
  }

  // Biens « en service » depuis le début de l'historique (sinon le taux d'occupation ne compterait que les nuits depuis leur création).
  Object.keys(props).forEach(function (k) { const pr = props[k].prop; if (String(pr.createdAt).slice(0, 10) > start) dbUpdate_("Properties", pr.propertyId, { createdAt: addDaysStr_(start, -30) + "T09:00:00.000Z" }); });
  const T = { Reservations: [], Guests: [], Payments: [], CheckIns: [], CheckOuts: [], CleaningMissions: [], Expenses: [], IncidentsV4: [], Quotes: [], WorkOrders: [], Invoices: [] };
  const orgId = String(ownerOrg.organizationId), agEmail = normalizeEmail_(agencyU.email), ownEmail = normalizeEmail_(ownerU.email);
  const iso = function (d) { return d.toISOString(); }, plusMin = function (d, m) { return new Date(d.getTime() + m * 60000); };
  const day = function (d) { return dateStr_(d); }, notAfterToday = function (s) { return s > today ? today : s; };
  const pay = function (o) {
    T.Payments.push(Object.assign({ paymentId: newId_("pay"), organizationId: orgId, currency: "MAD", status: "RECORDED", reconciled: true, reconciledAt: o.paidAt + "T12:00:00.000Z",
      reconciledBy: ownEmail, recordedBy: agEmail, createdAt: o.paidAt + "T12:00:00.000Z", note: "Donnée de démonstration" }, o));
  };
  const expense = function (o) {
    T.Expenses.push(Object.assign({ expenseId: newId_("exp"), organizationId: orgId, currency: "MAD", vatAmount: 0, status: "PAID", createdBy: ownEmail }, o, {
      createdAt: o.createdAt || o.expenseDate + "T10:00:00.000Z", paidAt: o.paidAt || o.expenseDate + "T10:00:00.000Z" }));
  };
  const existing = dbAll_("Reservations").filter(function (r) { return propIds.indexOf(String(r.propertyId)) >= 0 && ["CANCELLED", "DRAFT"].indexOf(r.status) < 0; });

  /* ---------- 1. Location courte durée : réservations, arrivées, départs, paiements, ménages ---------- */
  const sell = { duplex: [1500, 1900], deux: [1000, 1250] };
  ["duplex", "deux"].forEach(function (key) {
    const P = props[key], prop = P.prop, guard = P.guard, ownerNight = num_(prop.nightlyPrice) || P.spec.eur * DEMO_EUR_MAD_;
    let cursor = addDaysStr_(start, rnd.int(0, 4)), n = 0;
    while (cursor < addDaysStr_(today, 35)) {
      const nights = rnd.pick([2, 3, 3, 4, 4, 5, 6, 7]), ci = cursor, co = addDaysStr_(ci, nights);
      cursor = addDaysStr_(co, rnd.pick([0, 1, 1, 2, 3, 4, 6]));
      if (existing.some(function (r) { return String(r.propertyId) === String(prop.propertyId) && r.checkIn < co && r.checkOut > ci; })) continue;
      n++;
      const t = resvTimes_(prop, ci, co), rate = Math.round(rnd.int(sell[key][0], sell[key][1]) / 10) * 10, total = rate * nights;
      const margin = Math.max(0, total - ownerNight * nights), guestName = rnd.pick(DEMO_GUESTS_), source = rnd.weighted([["AIRBNB", 45], ["BOOKING", 30], ["DIRECT", 15], ["PHONE", 10]]);
      let status = "CONFIRMED";
      if (co <= today) { const u = rnd.next(); status = u < 0.09 ? "CANCELLED" : (u < 0.12 ? "NO_SHOW" : "COMPLETED"); }
      else if (ci <= today) status = "IN_PROGRESS";
      const created = notAfterToday(addDaysStr_(ci, -rnd.int(5, 45))), rid = newId_("resv");
      const r = { reservationId: rid, organizationId: orgId, propertyId: prop.propertyId, agencyOrganizationId: agencyOrg.organizationId, checkIn: ci, checkOut: co,
        checkInAt: iso(t.start), checkOutAt: iso(t.end), guestCount: rnd.int(1, Number(prop.capacity) || 2), guestName: guestName, status: status, notes: "Donnée de démonstration",
        createdAt: created + "T09:00:00.000Z", createdBy: agEmail, updatedAt: created + "T09:00:00.000Z", updatedBy: agEmail, guestEmail: "", guestPhone: "", totalPrice: total, taxes: 0, fees: 0,
        commissionRate: Math.round(margin / total * 1000) / 10, commissionAmount: margin, deposit: 0, depositStatus: "NONE", paymentStatus: "UNPAID", source: source,
        version: 1, idempotencyKey: "demo-hist:" + key + ":" + n, currency: "MAD" };
      const parts = guestName.split(" ");
      T.Guests.push({ guestId: newId_("gst"), organizationId: orgId, propertyId: prop.propertyId, reservationId: rid, lastName: parts.slice(1).join(" "), firstName: parts[0], email: "", phone: "",
        nationality: "", idType: "", idRefMasked: "", isPrimary: true, status: "ACTIVE", createdAt: r.createdAt, createdBy: agEmail, updatedAt: r.createdAt });
      const method = source === "AIRBNB" || source === "BOOKING" ? "PLATFORM" : rnd.pick(["TRANSFER", "CASH", "CARD"]);
      const advance = Math.round(total * 0.3);
      if (status === "CANCELLED") {
        r.cancelReason = rnd.weighted([["GUEST_REQUEST", 5], ["NO_PAYMENT", 2], ["OWNER_REQUEST", 1], ["FORCE_MAJEURE", 1], ["OTHER", 1]]);
        r.cancelledAt = notAfterToday(addDaysStr_(ci, -rnd.int(2, 20))) + "T10:00:00.000Z"; r.cancelledBy = agEmail; r.refundDue = 0;
      } else {
        const fullyPaid = status !== "CONFIRMED" && status !== "NO_SHOW" && rnd.next() > 0.07;
        pay({ propertyId: prop.propertyId, kind: "RESERVATION", refType: "RESERVATION", refId: rid, direction: "IN", amount: advance, method: method, paidAt: created, reference: "Acompte" });
        let paid = advance;
        if (fullyPaid) { pay({ propertyId: prop.propertyId, kind: "RESERVATION", refType: "RESERVATION", refId: rid, direction: "IN", amount: total - advance, method: method, paidAt: notAfterToday(ci), reference: "Solde" }); paid = total; }
        r.paymentStatus = status === "NO_SHOW" ? "PAID" : (paid >= total ? "PAID" : "PARTIAL");
      }
      if (status === "COMPLETED" || status === "IN_PROGRESS") {
        const late = rnd.next() < 0.18 ? rnd.int(15, 120) : 0, actualIn = plusMin(t.start, late || -rnd.int(0, 30));
        T.CheckIns.push({ checkInId: newId_("cki"), organizationId: orgId, propertyId: prop.propertyId, reservationId: rid, plannedAt: iso(t.start), actualAt: iso(actualIn), agentUserId: guard.userId,
          agentEmail: guard.email, checklistJson: { "Clés remises": true, "Inventaire vérifié": true, "Compteurs relevés": true }, conditionNotes: "Logement conforme.", metersJson: {}, photoDocIdsJson: [],
          comments: late ? "Arrivée tardive du voyageur." : "", incidentId: "", status: "DONE", idempotencyKey: "", createdAt: iso(actualIn), lateMinutes: late });
        r.version = 2;
      }
      if (status === "COMPLETED") {
        const late = rnd.next() < 0.12 ? rnd.int(10, 90) : 0, actualOut = plusMin(t.end, late || -rnd.int(0, 45));
        T.CheckOuts.push({ checkOutId: newId_("cko"), organizationId: orgId, propertyId: prop.propertyId, reservationId: rid, plannedAt: iso(t.end), actualAt: iso(actualOut), agentUserId: guard.userId,
          agentEmail: guard.email, checklistJson: { "Clés récupérées": true, "Inventaire vérifié": true }, conditionNotes: "", metersJson: {}, photoDocIdsJson: [], comments: late ? "Départ tardif." : "",
          incidentId: "", status: "DONE", idempotencyKey: "", createdAt: iso(actualOut), lateMinutes: late });
        r.version = 3;
        // Mission de ménage : Mohamed Zetounie, 200 MAD les 2 h (appartement), commandée par l'agence, payée par le propriétaire.
        const mStart = plusMin(actualOut, 30), accepted = plusMin(actualOut, rnd.int(5, 25)), started = plusMin(mStart, rnd.int(0, 10));
        const actualMin = rnd.next() < 0.12 ? rnd.int(135, 170) : rnd.int(85, 110), completed = plusMin(started, actualMin), validated = plusMin(completed, rnd.int(60, 300));
        const anomalies = [];
        if (rnd.next() < 0.28) {
          const type = rnd.weighted([["MISSING_ITEM", 4], ["DIRT", 3], ["BREAKAGE", 2], ["DAMAGE", 1], ["OTHER", 1]]);
          const desc = { MISSING_ITEM: "Serviettes manquantes", DIRT: "Four très sale", BREAKAGE: "Verre cassé", DAMAGE: "Tache sur le canapé", OTHER: "Ampoule grillée" }[type];
          anomalies.push({ type: type, room: rnd.pick(prop.roomsJson && parseJson_(prop.roomsJson, []).length ? parseJson_(prop.roomsJson, []) : ["Séjour"]), description: desc, at: iso(completed), by: provU.email, incidentId: "" });
        }
        const mid = newId_("cln");
        T.CleaningMissions.push({ missionId: mid, organizationId: orgId, propertyId: prop.propertyId, reservationId: rid, providerUserId: provU.userId, providerEmail: provU.email,
          startAt: iso(mStart), endAt: iso(plusMin(mStart, 120)), price: 200, currency: "MAD", status: "VALIDATED", responseAt: iso(accepted), expiresAt: iso(plusMin(actualOut, 120)),
          notes: "Ménage de départ (démonstration)", createdAt: iso(actualOut), createdBy: guard.email, updatedAt: iso(validated), priority: "HIGH", estimatedMinutes: 120, acceptedAt: iso(accepted),
          startedAt: iso(started), completedAt: iso(completed), actualMinutes: actualMin, validatedAt: iso(validated), validatedBy: agEmail, anomaliesJson: anomalies, reassignCount: 0,
          source: "AUTO", qualityScore: anomalies.length ? rnd.int(3, 4) : rnd.int(4, 5), validationNote: anomalies.length ? "Anomalie signalée et traitée." : "" });
        expense({ propertyId: prop.propertyId, category: "CLEANING", description: "Ménage mission " + mid, supplier: provU.email, amount: 200, expenseDate: day(completed), refType: "CLEANING",
          refId: mid, uniqueKey: "cleaning:" + mid, createdAt: iso(validated), createdBy: agEmail, paidAt: iso(plusMin(validated, 60 * 24 * rnd.int(2, 10))) });
      }
      T.Reservations.push(r);
    }
  });

  /* ---------- 2. Incidents, devis, interventions, factures (Mohamed Zetounie) ---------- */
  const INC = [
    ["duplex", "PLUMBING", "Fuite sous l'évier de la cuisine", 450], ["deux", "AC", "Recharge de gaz de la climatisation (chambre 1)", 900],
    ["long", "HUMIDITY", "Traces d'humidité dans la salle de bain", 1500], ["duplex", "AC", "Climatisation de la suite 2 ne refroidit plus", 1200],
    ["deux", "PLUMBING", "Ballon d'eau chaude en panne", 2200], ["duplex", "PLUMBING", "Chasse d'eau de la suite 1 qui coule", 300],
    ["deux", "APPLIANCE", "Le lave-linge ne vidange plus", 550], ["duplex", "ELECTRICITY", "Prises de la terrasse hors service", 650],
    ["long", "ELECTRICITY", "Le disjoncteur saute régulièrement", 400], ["deux", "PLUMBING", "Siphon de douche bouché", 250], ["duplex", "LOCKSMITH", "Serrure de la porte d'entrée dure", 350]
  ];
  INC.forEach(function (x, i) {
    const P = props[x[0]], prop = P.prop, ht = x[3], byAgency = x[0] !== "long", mgr = byAgency ? agEmail : ownEmail;
    const createdDay = addDaysStr_(start, 8 + i * 15 + rnd.int(0, 6));
    if (createdDay > addDaysStr_(today, -12)) return;
    const created = localToDate_(createdDay, "09:30"), incId = newId_("inc"), qid = newId_("quo"), woId = newId_("wo"), ivId = newId_("ivc");
    const split = computeInvoiceSplit_(ht, 20, 15, 20);
    const decided = addDaysStr_(createdDay, 2), desired = addDaysStr_(decided, 3), doneDay = addDaysStr_(desired, rnd.next() < 0.3 ? rnd.int(1, 5) : -rnd.int(0, 2));
    const completed = localToDate_(doneDay, "16:00"), issue = doneDay, paidDay = notAfterToday(addDaysStr_(issue, rnd.int(5, 15)));
    T.IncidentsV4.push({ incidentId: incId, organizationId: orgId, propertyId: prop.propertyId, reservationId: "", category: x[1], priority: ht > 1000 ? "HIGH" : "NORMAL", description: x[2],
      status: "CLOSED", photoFileIdsJson: [], createdAt: iso(created), createdBy: P.guard.email, updatedAt: iso(plusMin(completed, 60 * 24)), updatedBy: mgr, title: x[2], severity: ht > 1000 ? "HIGH" : "MEDIUM",
      reportedByUserId: P.guard.userId, assignedToUserId: provU.userId, contractorId: art.artisanId, estimatedCost: split.amountTTC, finalCost: split.amountTTC, resolvedAt: iso(completed),
      closedAt: iso(plusMin(completed, 60 * 24)), source: "MANUAL" });
    T.Quotes.push({ quoteId: qid, organizationId: orgId, propertyId: prop.propertyId, incidentId: incId, artisanId: art.artisanId, status: "APPROVED", currency: "MAD", totalAmount: split.amountTTC,
      validUntil: addDaysStr_(createdDay, 30), linesJson: demoQuoteLines_(x[2], ht), decisionAt: decided + "T10:00:00.000Z",
      decisionBy: mgr, decisionNote: "Devis accepté.", createdAt: iso(created), createdBy: mgr, requestNote: "Merci de chiffrer l'intervention.", requestedAt: iso(created), requestedBy: mgr,
      submittedAt: addDaysStr_(createdDay, 1) + "T15:00:00.000Z", amountHT: ht, vatRate: 20, amountTTC: split.amountTTC, estimatedDays: 1, commissionRateEst: 15, commissionEstimate: split.commissionAmount });
    T.WorkOrders.push({ workOrderId: woId, organizationId: orgId, propertyId: prop.propertyId, incidentId: incId, quoteId: qid, artisanId: art.artisanId, status: "VERIFIED", scheduledAt: desired + "T09:00:00.000Z",
      description: x[2], report: "Intervention réalisée, essais concluants.", invoiceFileId: "", createdAt: decided + "T10:05:00.000Z", createdBy: mgr, updatedAt: iso(plusMin(completed, 60 * 20)),
      updatedBy: mgr, title: x[2], desiredDate: desired, acceptedAt: decided + "T12:00:00.000Z", startedAt: iso(plusMin(completed, -120)), completedAt: iso(completed),
      verifiedAt: iso(plusMin(completed, 60 * 20)), verifiedBy: mgr, commissionRate: 15, photoDocIdsJson: [], invoiceId: ivId });
    T.Invoices.push({ invoiceId: ivId, organizationId: orgId, propertyId: prop.propertyId, workOrderId: woId, incidentId: incId, artisanId: art.artisanId, invoiceNumber: "DEMO-MZ-" + ("00" + (i + 1)).slice(-3),
      issueDate: issue, dueDate: addDaysStr_(issue, 30), amountHT: split.amountHT, vatRate: 20, vatAmount: split.vatAmount, amountTTC: split.amountTTC, commissionRate: 15, commissionBase: split.commissionBase,
      commissionAmount: split.commissionAmount, commissionVatRate: 20, commissionVatAmount: split.commissionVatAmount, commissionBeneficiaryOrgId: byAgency ? agencyOrg.organizationId : orgId,
      commissionLocked: true, netToContractor: split.netToContractor, currency: "MAD", status: "PAID", documentId: "", approvedAt: issue + "T18:00:00.000Z", approvedBy: mgr,
      paidAmount: split.netToContractor, paidAt: paidDay + "T10:00:00.000Z", createdAt: issue + "T17:00:00.000Z", createdBy: provU.email, notes: "Donnée de démonstration" });
    expense({ propertyId: prop.propertyId, category: "MAINTENANCE", description: "Facture DEMO-MZ-" + ("00" + (i + 1)).slice(-3) + " — " + x[2], supplier: S.provider.name, amount: split.amountTTC,
      vatAmount: split.vatAmount, expenseDate: issue, refType: "INVOICE", refId: ivId, uniqueKey: "invoice:" + ivId, createdBy: mgr, paidAt: paidDay + "T10:00:00.000Z" });
    pay({ propertyId: prop.propertyId, kind: "INVOICE", refType: "INVOICE", refId: ivId, direction: "OUT", amount: split.netToContractor, method: "TRANSFER", paidAt: paidDay, reference: "Virement facture", recordedBy: mgr });
  });
  // Deux incidents encore ouverts (à traiter pendant la démo)
  const openInc = function (key, cat, text, est, daysAgo, status) {
    const P = props[key], at = localToDate_(addDaysStr_(today, -daysAgo), "10:00");
    T.IncidentsV4.push({ incidentId: newId_("inc"), organizationId: orgId, propertyId: P.prop.propertyId, reservationId: "", category: cat, priority: "NORMAL", description: text, status: status,
      photoFileIdsJson: [], createdAt: iso(at), createdBy: P.guard.email, updatedAt: iso(at), updatedBy: P.guard.email, title: text, severity: "MEDIUM", reportedByUserId: P.guard.userId,
      estimatedCost: est, source: "MANUAL" });
  };
  openInc("duplex", "AC", "Bruit anormal du climatiseur du séjour", 600, 3, "OPEN");
  openInc("deux", "FURNITURE", "Pied de lit cassé (chambre 2)", 300, 1, "OPEN");

  /* ---------- 3. Autres dépenses : eau et électricité, consommables, assurance, taxe ---------- */
  for (let m = 5; m >= 0; m--) {
    const month = addMonthsStr_(today.slice(0, 8) + "01", -m);
    const d = addDaysStr_(month, 9);
    if (d > today) continue;
    expense({ propertyId: props.duplex.prop.propertyId, category: "UTILITIES", description: "Électricité et eau " + month.slice(0, 7), supplier: "Régie (démo)", amount: rnd.int(60, 90) * 10, expenseDate: d });
    expense({ propertyId: props.deux.prop.propertyId, category: "UTILITIES", description: "Électricité et eau " + month.slice(0, 7), supplier: "Régie (démo)", amount: rnd.int(40, 65) * 10, expenseDate: d });
    expense({ propertyId: props.duplex.prop.propertyId, category: "SUPPLIES", description: "Linge et consommables " + month.slice(0, 7), supplier: "Fournisseur (démo)", amount: rnd.int(25, 45) * 10, expenseDate: addDaysStr_(d, 3) > today ? d : addDaysStr_(d, 3) });
    expense({ propertyId: props.deux.prop.propertyId, category: "SUPPLIES", description: "Linge et consommables " + month.slice(0, 7), supplier: "Fournisseur (démo)", amount: rnd.int(15, 30) * 10, expenseDate: addDaysStr_(d, 3) > today ? d : addDaysStr_(d, 3) });
  }
  [["duplex", 1400], ["deux", 1000], ["long", 900]].forEach(function (x, i) {
    expense({ propertyId: props[x[0]].prop.propertyId, category: "INSURANCE", description: "Assurance habitation annuelle", supplier: "Assureur (démo)", amount: x[1], expenseDate: addDaysStr_(start, 20 + i) });
    expense({ propertyId: props[x[0]].prop.propertyId, category: "TAXES", description: "Taxe de services communaux", supplier: "Commune (démo)", amount: Math.round(x[1] * 1.2), expenseDate: addDaysStr_(start, 60 + i) });
  });

  /* ---------- 4. Écriture en une fois par table ---------- */
  const counts = {};
  Object.keys(T).forEach(function (name) { counts[name] = T[name].length; });
  withLock_(function () { Object.keys(T).forEach(function (name) { dbInsertMany_(name, T[name]); }); }, 30000);

  /* ---------- 5. Bail et loyers (bien en longue durée) : créés par les fonctions de l'application ---------- */
  const L = props.long, op = buildPrincipal_(ownerU);
  demoAs_(op);
  const leaseStart = addMonthsStr_(today.slice(0, 8) + "01", -6);
  const tenantId = tenantCreate_(op, { propertyId: L.prop.propertyId, fullName: "Karim Benali (locataire démo)", phone: DEMO_PHONE_ }).tenantId;
  const leaseId = leaseCreate_(op, { propertyId: L.prop.propertyId, tenantId: tenantId, startDate: leaseStart, endDate: addDaysStr_(addMonthsStr_(leaseStart, 12), -1), monthlyRent: 7000, charges: 300,
    deposit: 14000, dueDay: 5, terms: "Bail de démonstration." }).leaseId;
  leaseActivate_(op, { leaseId: leaseId });
  dbUpdate_("Properties", L.prop.propertyId, { monthlyRent: 7000, charges: 300, updatedAt: nowIso_() });
  const rent = [];
  rent.push({ paymentId: newId_("pay"), organizationId: orgId, propertyId: L.prop.propertyId, kind: "DEPOSIT", refType: "LEASE", refId: leaseId, direction: "IN", amount: 14000, currency: "MAD",
    method: "TRANSFER", paidAt: leaseStart, reference: "Caution", status: "RECORDED", reconciled: true, recordedBy: ownEmail, createdAt: leaseStart + "T10:00:00.000Z", note: "Donnée de démonstration" });
  const due = dbAll_("RentSchedules").filter(function (s) { return String(s.leaseId) === String(leaseId) && s.dueDate <= today; }).sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; });
  due.forEach(function (s, i) {
    const last = i === due.length - 1, beforeLast = i === due.length - 2;
    if (last && diffDays_(s.dueDate, today) <= 25) return; // échéance du mois en cours : pas encore payée
    const amount = beforeLast ? Math.round(num_(s.amountDue) / 2) : num_(s.amountDue);      // mois précédent : payé à moitié (retard)
    const paidAt = notAfterToday(addDaysStr_(s.dueDate, i === 2 ? 14 : rnd.int(0, 3)));      // un loyer réglé avec 14 jours de retard
    rent.push({ paymentId: newId_("pay"), organizationId: orgId, propertyId: L.prop.propertyId, kind: "RENT", refType: "RENT_SCHEDULE", refId: s.scheduleId, direction: "IN", amount: amount, currency: "MAD",
      method: "TRANSFER", paidAt: paidAt, reference: "Loyer " + s.period, status: "RECORDED", reconciled: true, recordedBy: ownEmail, createdAt: paidAt + "T10:00:00.000Z", note: "Donnée de démonstration" });
  });
  dbInsertMany_("Payments", rent);
  dbUpdate_("Leases", leaseId, { depositStatus: "HELD", updatedAt: nowIso_() });
  counts.Payments += rent.length; counts.Leases = 1; counts.RentSchedules = dbAll_("RentSchedules").filter(function (s) { return String(s.leaseId) === String(leaseId); }).length;
  demoAs_(sp);
  counts.extras = demoExtras_(sp, ownerOrg, agencyOrg, props, provU, start, today);
  audit_("DEMO_HISTORY_BUILT", "System", "demo-history", orgId, counts);
  return { ok: true, already: false, from: start, to: today, counts: counts };
}

/* ---------- Compléments : abonnements avec historique, listes de tâches et photos avant / après des ménages ---------- */
var DEMO_PHOTOS_ = {"sejour_avant": "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", "sejour_apres": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAwICQsJCAwLCgsODQwOEh4UEhEREiUbHBYeLCcuLisnKyoxN0Y7MTRCNCorPVM+QkhKTk9OLztWXFVMW0ZNTkv/2wBDAQ0ODhIQEiQUFCRLMisyS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0v/wAARCAFAAeADASIAAhEBAxEB/8QAGwABAAIDAQEAAAAAAAAAAAAAAAYHAwQFAQL/xABQEAABAgMBCQsJBgMGBQUAAAAAAQIDBAURBhIUFRYhMVTREzVBUVJTk6GjstIiNGFxc4KRorEyVWSBkuIzNkIHdIPB4fAjJERywkNWYnWl/8QAGgEBAAMBAQEAAAAAAAAAAAAAAAEDBAIFBv/EACwRAQABAwIGAQUAAQUAAAAAAAABAhETAxIEFCExUWEyBUFSkbEiM3GBocH/2gAMAwEAAhEDEQA/ALFAPl72sY573I1rUtVVWxEQ4dPoEZmrsYEOKrZeVdGYn9bn3lvqSxcxhy0/Adt+0M88TpR90sBE8tPwHbftGWn4Dtv2g5rR8/1LARPLT8B237Rlp+A7b9oOa0fP9SwETy0/Adt+0ZafgO2/aDmtHz/UsBE8tPwHbftGWn4Dtv2g5rR8/wBSwETy0/Adt+0ZafgO2/aDmtHz/UsBE8tPwHbftGWn4Dtv2g5rR8/1LARPLT8B237Rlp+A7b9oOa0fP9SwGlTKnLVSCsSXcvkrY5jszm+tDdC+JiqLwAAJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIzdxMxIctLS7VsZFc5z/Te2WJ6s/UhJiJ3d/9D/if+IZ+Jm2lKKAHeuLkcMrTIjkthy6bovr4OvP+QeRRTNdUUw4ILMrbIVbo89BgLfRJd6onoe3PZ/l+ZCLlv5gkv+//ACUWW16OyuKb93KBYN1F0U1RpyDCgQoL2Ph3zr9Ft0qnAphuskpaaoLKm2C2DHRGPzJYqo6zMvHp6hZ1Vw8RutPWEEBY8tORKfcbBmoKNdEhQGqiPS1NNh5SZiFdPR4zqhLQmqjlYrmpozItqW500k2Ty0TaN3WYurk3pyHTllIMWSjRUjLmiwIudU9KORESzrOpcLv6nsnf5EgrdYrUnUHwZGnbvAREVH7g91ubPnRbCLOaNKJ090z/ANK9B2JyLM1ivwGVGFg8WI9kJ7UarbEVeJc+hSV1ydj0CFBh0unQ1gK3yn3iqiehbPqosinSiqJm/SPSvAdqt1xlXlYTXSjIMwx9rns0OSz4nFCqqIiek3AAQ5dCgTMSWq8q6Gv24iQ3JwKjlsXb60QscrOkb6yXt2d5CzCXp8FP+MwAANwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABE7u/8Aof8AE/8AElhFruoT1hScVE8hrnNVbdCrZZ9FDPxX+lKIlgXGyzKfQ3zkd7IKzC3yviLYiNTM2387fiV+defuim56mskHQ4EOAy9RNzaqLYmhM6qIeZo106czVP8Awl1zUtLU+PHZDrMvOvmVvrxqtR18lqquZy2/6HBgyOLrt4UFEshrFv2f9qoqps/Ij8lNRJGbhTMGzdITkcluhfQp0Zq6SamqjLTz4MukaXtRt611ip6c/rJuszUTTEWtaUquorErTZyC2PTIM29Yd8171S1udc2dqkXrt0kzWGNguY2DAatt41bbV9KmrWaxMVmOyLMshNcxt6iQ0VEstt4VU55Ey51deqqZiJ6LHlpiHKXGwY8aA2YhsgNVYT9Ds/qU+ZeLDr9z0WHTFwF+dqwmIiIi8S5tC8aWESfdHNvpGLFhwNwvEZfXq31iLbx2dRgo1ZmqNFiPlkY7dG2ObERVReJcypn2k3W8xTeI+1rS6VxDHQ7oFY9Fa5sN6Ki8C5jduor9SkKxFl5WZ3OE1rVRu5tXSnpQ4kGvzECrxKlDgwEjREVHNvVvc+lbLbbc3GdLLmpcxKfod4g5p1KY09m6Y6uFFmJup1BsV71iTUVzWoqIjVVcyJosTiJHAutqsg5sCoSe6Obm8pqsev8Al1HDqNamqhUIU89IcOPCRt4sNuZLFtRbFVeE6UO7aqMbY5svEXjcxbepUIcUVxTMzul2bsJaWmaEyoLASFMLeOS1LHeVpav++AgZ0atXJ2r3qTURLxq2thsSxqLxnOEudauK67wAAhS26RvrJe3Z3kLMKvkZd03NwoDMyvdp4k4V+B38mvxfZ/6nUUzPZ6HB1U00zdMQQqYue3CXixcJvtzYrrNzstsT1nXuN3si+3XutExMd3oU1RV2d4AEJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADHMQIUzBfBjsR8N6WOavCZAET1Q6auOmEirgsxCdCXRutqOT0ZkW315vUaU9c1OSMq+YixICsZZajXLbnWzi9JPjl3TbyTPu95AzcppTPZEJSgzU3Lsjw4kFGvtsRyrbmWziM2TE5zsD9Tth3KDvVA97vKb5fGnTMXZatCiJmEUyYnOdgfqdsGTE5zsD9TthKwTjpc4aUUyYnOdgfqdsGTE5zsD9TthKwMdJhpRTJic52B+p2wZMTnOwP1O2ErAx0mGlFMmJznYH6nbBkxOc7A/U7YSsDHSYaUUyYnOdgfqdsGTE5zsD9TthKwMdJhpRTJic52B+p2wZMTnOwP1O2ErAx0mGloUqlQqaxb1d0iu+1EVLM3EnEhvgHcREdIWxERFoYKh5hM+yd9FMVxu9kX2691plqHmEz7J30UxXG72Rfbr3WlOr3hq0O0u8ACpeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcu6beSZ93vIdQ5d028kz7veQDSoO9UD3u8pvmhQd6oHvd5TfNVPxhhr+UgAOnIAAAAAAAAAAAAAAADBUPMJn2TvopiuN3si+3XutMtQ8wmfZO+imK43eyL7de60o1e8NOh2l3gAVLwAAAAAAAAAAAAAAAAAAAAAAAAAAAAACZ9APWW36Xq2LbmANarlsalqnhsPVHNckJUt/qs4TXAAAAAAAAAAAAAAAAAHLum3kmfd7yHUOXdNvJM+73kA0qDvVA97vKb5oUHeqB73eU3zVT8YYa/lIADpyAAAAAAAAAAAAAAAAwVDzCZ9k76KYrjd7Ivt17rTLUPMJn2TvopiuN3si+3XutKNXvDTodpd4AFS8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0AAAAAAAAAAAAAAAAAAAcu6beSZ93vIdQ5d028kz7veQDSoO9UD3u8pvmhQd6oHvd5TfNVPxhhr+UgAOnIAAAAAAAAAAAAAAADBUPMJn2TvopiuN3si+3XutMtQ8wmfZO+imK43eyL7de60o1e8NOh2l3gAVLwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADl3TbyTPu95DqHLum3kmfd7yAaVB3qge93lN80KDvVA97vKb5qp+MMNfykAB05AAAAAAAAAAAAAAAAYKh5hM+yd9FMVxu9kX2691plqHmEz7J30UxXG72Rfbr3WlGr3hp0O0u8ACpeAAAAAAK3qu+k57d/eU1TTHD3i91OX0tIFWgnlvZl9LSBVoHLezL6WkCrQOW9mX0tIFWgct7MvpaQKtA5b2ZfS0gVaBy3sy+lpAq0DlvZl9LSBVoHLezL6WkCrQOW9mX0tIFWgct7MvpaQKtA5b2ZfS0gAZVwAAAAAAAAAABy7pt5Jn3e8h1Dl3TbyTPu95ANKg71QPe7ym+aFB3qge93lN81U/GGGv5SAA6cgBnk79Y7UYxH25lRUzWcJEpiLzZhRFW2xNGk8N+ZRIUuuC2bk5VR7kW1fV6v8Afr0BE3KosAAlAAAAAAAADBUPMJn2TvopiuN3si+3XutMtQ8wmfZO+imK43eyL7de60o1e8NOh2l3gAVLwAAAABW9V30nPbv7ymqbVV30nPbv7ymqenT2hjnuG/TKfhiq97lbCatmbSqmgSWkb3Qvz+qmH6hr16OjejvM2aOG041K7VGKpPmfmdtGKpPmfmdtNwHznM6/5z+5epi0/wAY/TTxVJ8z8ztoxVJ8z8ztpuAczr/nP7kxaf4x+mk6kyaoqJCVFVNKOXMcaoyTpOKiW30N32V4fUpJjm1/zNntE+im3geL1s0U1VTMT5UcRo0Y5mItZwAAfSvKDfplPwxVe9ythNWzNpVTQJLSN7oX5/VTB9Q169HRvR3mbNHDacaldqjFUnzPzO2jFUnzPzO2m4D5zmdf85/cvUxaf4x+mniqT5n5nbRiqT5n5nbTcA5nX/Of3Ji0/wAY/TSdSZNUVEhKiqmlHLmONUZJ0nFRLb6G77K8PqUkxza/5mz2ifRTbwPF62aKaqpmJ8qOI0aMczEWs4AAPpXlAAAtIAHltgAAAAAAAAAABzboYUSNR5hkJjnvW9sa1LVXyk4DpACFykxVpSXZAh0+IrWW2K6C+3OtpmxhWfu53QP2kuB1uq8uZopn7IjjCs/dzugftGMKz93O6B+0lwG6ryjZT4RHGFZ+7ndA/aEqNaTRT3J/gP2kuA3VeTZT4RNtUrjEcjZB6I5LFRID8/WfOMKz93O6B+0lwG6rynZT4RHGFZ+7ndA/aMYVn7ud0D9pLgN1XlGynwiOMKz93O6B+0YwrP3c7oH7SXAbqvJsp8IjjCs/dzugftGMKz93O6B+0lwG6rybKfCI4wrP3c7oH7RjCs/dzugftJcBuq8mynwh0acrEaC+E6nvRr2q1bID7bFOvcnAiy9OiNjwnwnLGVUR7VRbLG8Z2gRMzPd1ERHYABCQAADFHmIMsxHzEaHCaq2I57kalvFnNWsVWBSZXdYy3z3ZocNFzvXZxqV1UJ6PUZp0xMuvnuzIiaGpxJ6C3T0pr6/ZXVXtbU/FZHnpmLDW+ZEiuc1bLLUVVVDXPGfYb6j03x0hnCS0je6F+f1U4DZSO+VfNNhPWBDcjXRETMir/vrTjQkNLgxoFMl3TCNhpFc7cWqtjnt022cWdf8Aapb5f1WmatDp9p/8lr4OYjU6+G0AD5l6oAABza/5mz2ifRTpHErk2yIrZdiot46168S8X1N3AUVVcRTb7KOJqiNKbuSAD6x4wSWkb3Qvz+qkaO5RJtjoKSzlRHtVVb6U0/E8z6pRVVodPtN/61cHVEanV1QAfMPWAD1qK5yNaiqqrYiJwkjw5tf8zZ7RPop1YUKJGcrYTFe5EVbE4jg1ybZEVsuxUW8da9eJeL6m3gNOqriKZiGfiaojTmJckAH1jxwAAWVKTstOsvpaPDipYireutVLdFqaU/M2Cp5aYiysdkaA9WRGLa1ycBYVArcKrwLFsZMsT/iQ+P0p6Pp8FXDqaU09Y7NFFe7o6wAKVgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACA3aTTo1YWCtqNl2I1EvrUVVS1Vs4NKJ+RwTr3WfzBNe53GnIPQo+MMlXyl7fO5S/EXzuUvxPAdod+5qegU2DOTczMq9FbuaSSZ93VUX7VqWXqZ8+2xy6lcLiQ6rAnFjy8z5LWPciPgqmll7xJbpTjz6UVeADnb1um/SzPh03rUbpFGHTetRukUwA5xUfjCd9Xlnw6b1qN0ijDpvWo3SKYAMVH4wb6vLM6cmXIrXTMZUVLFRXrnMV87lL8TwHcUxT2hzMzPd7fO5S/EXzuUvxPASPb53KX4i+dyl+J4AM+HTetRukUYdN61G6RTACvFR+MOt9Xlnw6b1qN0im1S5moxqjLw5WceyM56Ixz4tjUX026fVw6LFOcBjo+0Qb6vKeVaaWqSE7L0OYY+ZY62bbDaqLHbYiKsPOvk26UTTx5/Kgl87lL8Qx7oa2scrVVFS1FszKlip+aLYeE0URRFoRVVu6y9vncpfiL53KX4ngO0Pb53KX4i+dyl+J4AB0rm5p0rWpVzbVSI9IbkR1lqOzZ/Uti/kc026PvvI/3iH3kOausSmO60QAec1gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAK6us/mCa9zuNOQde6z+YJr3O405B6NHxhkq7yAA6QAAAAAAAAAAAAAAAAAAAAAAAAAAAAABt0ffeR/vEPvIaht0ffeR/vEPvIRPYjutEAHmtgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACurrP5gmvc7jTkHXus/mCa9zuNOQejR8YZKu8gAOkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAbdH33kf7xD7yGobdH33kf7xD7yET2I7rRAB5rYAAAAANDCIvK6kGEReV1IYgV3l3ZlwiLyupBhEXldSGIC8lmXCIvK6kGEReV1IYgLyWZcIi8rqQYRF5XUhiAvJZlwiLyupBhEXldSGIC8lmXCIvK6kGEReV1IYgLyWZcIi8rqQYRF5XUhiAvJZlwiLyupBhEXldSGIC8lmXCIvK6kGEReV1IYgLyWZcIi8rqQYRF5XUhiAvJZlwiLyupBhEXldSGIC8lmXCIvK6kGEReV1IYgLyWZcIi8rqQYRF5XUhiAvJZCrpXK+tzLnLaq3vdQ5h0ro9+Zj3e6hzT1NP4R/sw1/KQAHaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANmlqqVOUVNKRmd5DWNmmb5Sntmd5CKu0pjusTCIvK6kGEReV1IYgeTeW6zLhEXldSDCIvK6kMQF5LMuEReV1IMIi8rqQxAXksAAhIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACI3VyywqgkZEW9jNttVeFMy9VnxOKWFOSkGdl3QY7bWroXhavGnpITUqZHp0VWxGq6Hb5MRE8l2xfQb9DViqNs92TVomJu0wAaVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHRufllmarBSxb2Gu6OVF0WaOuw1pKSjz0VIcBiuz2K7+lvrXgJrTKdBp0vucLO5c73qmdy7PQUa2rFMW+6zTomqbtsAHnNgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANbF0lqcv0TdgxdJanL9E3YbIJ3T5RaGti6S1OX6JuwYuktTl+ibsNkj9UqU3Lz8WFCi3rG2WJeovAnoImuY+6YoiXXxdJanL9E3YMXSWpy/RN2EexxPc/wDI3YMcT3P/ACN2HOV1iSHF0lqcv0TdgxdJanL9E3YR7HE9z/yN2DHE9z/yN2DKYkhxdJanL9E3YMXSWpy/RN2EexxPc/8AI3YMcT3P/I3YMpiSHF0lqcv0TdgxdJanL9E3YR7HE9z/AMjdgxxPc/8AI3YMpiSHF0lqcv0TdgxdJanL9E3YR7HE9z/yN2DHE9z/AMjdgymJIcXSWpy/RN2DF0lqcv0TdhHscT3P/I3YMcT3P/I3YMpiSHF0lqcv0TdgxdJanL9E3YR7HE9z/wAjdgxxPc/8jdgymJIcXSWpy/RN2DF0lqcv0TdhHscT3P8AyN2DHE9z/wAjdgymJIcXSWpy/RN2DF0lqcv0Tdhw5SqzkSagsfGta6I1FS9bnS31ElOormfu5miIa2LpLU5fom7Bi6S1OX6Juw2QTunyi0PGtaxqNaiNa1LEREsREPQCAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABFa3vpG93uoSojVYlZiJUYzocCK5q2WK1iqi5kOK+zuju5gM+BTWrRujUYFNatG6NSq0rbwwAz4FNatG6NRgU1q0bo1FpLwwAz4FNatG6NRgU1q0bo1FpLwwAz4FNatG6NRgU1q0bo1FpLwwAz4FNatG6NRgU1q0bo1FpLwwAz4FNatG6NRgU1q0bo1FpLwwAz4FNatG6NRgU1q0bo1FpLwwAz4FNatG6NRgU1q0bo1FpLwSHn0v7Vv1QmJFJKUmWzkBzpeKjUiNVVVi5s5KyyhVWAAscAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4eWFD17sX+EZYUPXuxf4Sqzr0u52PUaVNVJJqWl5WVcjYjoyvtS2zQjWrxoa8NLPkqT3LCh692L/CMsKHr3Yv8ACQpbkKhh1PlmxJd7Kiiul5hr1WG5ES3itTN6DjTss+SnI8rEVqvgRHQ3K3Qqoti2fAYaPKclSzssKHr3Yv8ACMsKHr3Yv8JVZ0pSiTM3Rp2qw3wkgSbmtiNcq3y2qiJYllnDxjBSjJUsLLCh692L/CMsKHr3Yv8ACVWBgpMsrUywoevdi/wjLCh692L/AAlWNarnI1NKrYdCv0WYoNQdJTb4T4qNR1sJVVti+tEGCkyVLDywoevdi/wjLCh692L/AAlVgYKTLK1MsKHr3Yv8Iywoevdi/wAJXs5RJmUo0lVIj4SwJxzmw2tVb5LFVFtSyzg4zC2TgJS3zcWbY2MsS8hS7URzncbnZ/JTi4xhpTkqWRlhQ9e7F/hGWFD17sX+EqsDBSjLK1MsKHr3Yv8ACMsKHr3Yv8JVYGCkyytTLCh692L/AAjLCh692L/CVWbVKkItUqECSgOY2LHdetV6qjUX02IowUmSVlZYUPXuxf4RlhQ9e7F/hKyqEnEp89MScZWuiS8R0NysW1FVFsWwwDBSZJWplhQ9e7F/hGWFD17sX+Eq6BCdHjw4LFRHRHI1FXRaq2HTnLn48jXlpE1NSkKKllsZ8RWwm2tvs7lT/LSMNJkqT7LCh692L/CMsKHr3Yv8JV8xC3CYiwd0ZE3N6tv4brWusWy1F4UMYwUmWVqZYUPXuxf4RlhQ9e7F/hKrAwUmWVqZYUPXuxf4RlhQ9e7F/hKrAwUmWVqZYUPXuxf4RlhQ9e7F/hK+fQpllz8OtK+Dg0SLuSNRVv7c/BZZZm4zmDBSZKlqZYUPXuxf4RlhQ9e7F/hKrAwUmWVqZYUPXuxf4RlhQ9e7F/hKrAwUmWVqZYUPXuxf4RlhQ9e7F/hIW25KYwSnzEWfkYKVHzdsR0S1y5sy2MVE0ppU1Y1z0zLR5+BOR5WUjyTL90ONFsWLmtRGcpbPqhGGjynJUn2WFD17sX+EZYUPXuxf4SvapRJmlyVPm474Toc/DWJCRiqqoiWabUTjTRac0nBSjJUtTLCh692L/CMsKHr3Yv8ACV7XKJM0OLLw5p8J6zEFsZu5qq2NW3TaiZ8xzRgpMlS1MsKHr3Yv8Iywoevdi/wlVgYKTLK1MsKHr3Yv8Iywoevdi/wlVgYKTLK1MsKHr3Yv8Iywoevdi/wlVgYKTLK1MsKHr3Yv8Iywoevdi/wlVgYKTLK1MsKHr3Yv8Iywoevdi/wlVgYKTLK1MsKHr3Yv8Iywoevdi/wlVgYKTLK1MsKHr3Yv8Iywoevdi/wlVgYKTLK1MsKHr3Yv8Iywoevdi/wlVgYKTLK1MsKHr3Yv8Iywoevdi/wlVgYKTLITi5d0Fv8AZ9XlmIcSJCSKy+bDejHLnboVUWz4EHBdMXVxNk6ueugdVrpbn5KFLpLScjfNhMv79y+QudXWJbo4kNt8xEqFKu1hzS7rDlo9sFqpmhrfu+zxaEK6BG1N1nSu7W3M4ksxVuaYdeWXlua/3X02W6eHQfMtMuiUe6iWufjxnLDmGrKQ5Z63zWq5L7c0TOiW32grMEbS6wZZZ5bmKctCWItQWbdjFWfxb6+X+Jw3vHbm4zgXf4BlPM4t3PcrG3+5WXt/Znsszf62kdBMRaS6eyW75GUrEdm6YUuH3llulbN0/wDjZZpzWWEjqeDY/rl61X1TBIWDNY9GRFSxb7c3Ki2O0cFugp8EbS6SXWzr5qXkWTNLjSkzCRzVjTEZHxoqZvtpetXNxqnH6TcuFsxZXMDsxvuCYNZ9uzPfXnp0aPQQ8E26WL9VkVW9xDcnjuy8wpcJvuK3Pfenj4dPCfV0U7Elo1ThPpMebp0WFZCiPmWJLMSzM6Gl5YipxI620rUEbS60oM3GgLcPBhPVkONCVIiJ/Wl63Mvoz6DXjPSap12EvNIjpaTmG7jDREshIjlTyU4NHAVqBtLrZS3KSDuW5ZK4Gt9owey9XTwX1tnpOBS5nBLgq/FkHqxqTrdydwtarmWL6Fs4SCgbS60pubZLVKjzkWSiTceapKJEfBvUjI5b3y226XZ10Z85qRIbKZdRQJllSnP+acrYsKdciR2NtSxHqmdUVeBeIrgDaXWjRVqKf2iT6T6zSwdzmFlkjK69vL5PsW5rNGgi1yDJmtVZ6RqpNwHy8u5YTYEW8e5E/wDTZwInoT4EXBO0usitOfBucoVRi4TLzkOfvFizEa/jtYt9ajnojV0JoVMyG3PuqDv7TJJYjplaa6IiwLVcsFXbktt7wW6dBVgI2l1ieXiy6HE1uOcZxL/cv425X/8ATZns06PSbD8Gy7udvdzw/cEw3c7P4l4umzh09RWYG0usV8xEqFKu1hzS7rDlo9sFqpmhrfu+zxaEIRR5qQlI731GnYwhKyxsPd3Qr1bdNqafV6TRBMRYukuOrmv/AGn/APpRdhxKnHlZmcfFkZPAoCol7B3VYl7mz+UudbVzmqCbIusKl/yLRP8A7iH3lOxFm4r7obrIL1R8GXk2xIcNzUVqPSGio6xeG3hKlBztTdYE4901RrjpyYVYs0+avXRXZ3ORImZFXh0HaizcV90N1kF6o+DLybYkOG5qK1HpDRUdYvDbwlSgbS6fzr5eaolyM5V1SKj5hzY8WJnVzEdocvCmY6cfdMPr+N73EODLgt9ZuVtiXm5cFtlujhKtA2l1hVmblJK5i5SYmpWJMrCYr4bWxkhttS9XyvJVVTRosPmi1ePXJa6+fmGta+JI2I1uhqI1yIhX4J2l1mswG/uIxlueD4M/+J9m+vW3ttvpsNabfNwqFXYlfc5kVkwjqc562OR6KueEum9+zozWWldgjaXTv+0SPUJiXp0aDFmYlNiSUPdXNc5YTn2qvlcFujTnIIAdRFoRM3AASAAAAAAAAAAAAAAAAAAAAAD/2Q==", "cuisine_avant": "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", "cuisine_apres": "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"};

/** Chaque étape ne s'exécute que si elle n'a pas déjà été faite (relance sans doublon). */
function demoExtras_(sp, ownerOrg, agencyOrg, props, provU, start, today) {
  const out = { subscriptions: 0, subscriptionPayments: 0, checklists: 0, photos: 0 };
  // 1. Abonnements Pro depuis 6 mois : 6 mensualités puis un règlement semestriel anticipé.
  const plan = dbGet_("SubscriptionPlans", "PRO");
  [ownerOrg, agencyOrg].forEach(function (org) {
    if (!plan || dbAll_("Subscriptions").some(function (x) { return String(x.organizationId) === String(org.organizationId); })) return;
    const price = num_(plan.price), subId = newId_("sub"), paidThrough = addMonthsStr_(start, 12);
    dbInsert_("Subscriptions", { subscriptionId: subId, organizationId: org.organizationId, planCode: "PRO", status: "ACTIVE", startDate: start, nextDueDate: paidThrough, periodEnd: paidThrough,
      trialEnd: "", cancelAtPeriodEnd: false, price: price, currency: plan.currency || "MAD", periodicity: plan.periodicity || "MONTHLY", paidThrough: paidThrough,
      createdAt: start + "T09:00:00.000Z", createdBy: sp.email, updatedAt: nowIso_(), updatedBy: sp.email });
    dbUpdate_("Organizations", org.organizationId, { planCode: "PRO", updatedAt: nowIso_() });
    const rows = [];
    for (let k = 0; k < 6; k++) {
      const d = addMonthsStr_(start, k); if (d > today) break;
      rows.push({ paymentId: newId_("pay"), organizationId: org.organizationId, propertyId: "", kind: "SUBSCRIPTION", refType: "SUBSCRIPTION", refId: subId, direction: "IN", amount: price, currency: "MAD",
        method: "TRANSFER", paidAt: d, reference: "Abonnement Pro " + d.slice(0, 7), status: "RECORDED", reconciled: true, note: "1 période — donnée de démonstration", recordedBy: sp.email, createdAt: d + "T10:00:00.000Z" });
    }
    const semi = addMonthsStr_(start, 6) > today ? today : addMonthsStr_(start, 6);
    rows.push({ paymentId: newId_("pay"), organizationId: org.organizationId, propertyId: "", kind: "SUBSCRIPTION", refType: "SUBSCRIPTION", refId: subId, direction: "IN", amount: price * 6, currency: "MAD",
      method: "TRANSFER", paidAt: semi, reference: "Abonnement Pro — règlement semestriel", status: "RECORDED", reconciled: true, note: "6 périodes — donnée de démonstration", recordedBy: sp.email, createdAt: semi + "T10:00:00.000Z" });
    dbInsertMany_("Payments", rows);
    audit_("SUBSCRIPTION_ASSIGNED", "Subscription", subId, org.organizationId, { planCode: "PRO", demo: true });
    out.subscriptions++; out.subscriptionPayments += rows.length;
  });
  // 1 bis. Identité du prestataire sur ses devis et factures ; un devis en attente et une intervention planifiée (hors ménage).
  const art = dbAll_("Artisans").find(function (c) { return String(c.organizationId) === platformOrgId_() && normalizeEmail_(c.email) === normalizeEmail_(DEMO_SPEC_.provider.email); });
  if (art && !art.legalName) dbUpdate_("Artisans", art.artisanId, { legalName: "Mohamed Zetounie — Multiservices (démo)", taxId: "ICE / IF / RC : à compléter",
    billingInfo: "Règlement par virement à réception de facture — RIB à compléter.", updatedAt: nowIso_() });
  const openIncident = function (title) { return dbAll_("IncidentsV4").find(function (i) { return i.title === title && ["OPEN", "QUOTE_PENDING", "ASSIGNED"].indexOf(i.status) >= 0; }); };
  const ac = openIncident("Bruit anormal du climatiseur du séjour"), bed = openIncident("Pied de lit cassé (chambre 2)");
  const agEmail = normalizeEmail_(DEMO_SPEC_.agency.email);
  out.pendingQuote = 0; out.scheduledWorkOrder = 0;
  if (art && ac && !dbAll_("Quotes").some(function (q) { return String(q.incidentId) === String(ac.incidentId); })) {
    const lines = [{ description: "Diagnostic et démontage du ventilateur intérieur", quantity: 2, unitPrice: 150, amount: 300 }, { description: "Roulement de ventilateur (pièce)", quantity: 1, unitPrice: 280, amount: 280 },
      { description: "Nettoyage complet de l'unité intérieure", quantity: 1, unitPrice: 200, amount: 200 }, { description: "Déplacement", quantity: 1, unitPrice: 100, amount: 100 }];
    const split = computeInvoiceSplit_(880, 20, 15, 20), at = addDaysStr_(today, -2);
    dbInsert_("Quotes", { organizationId: ac.organizationId, propertyId: ac.propertyId, incidentId: ac.incidentId, artisanId: art.artisanId, status: "PENDING", currency: "MAD", totalAmount: split.amountTTC,
      validUntil: addDaysStr_(today, 28), linesJson: lines, createdAt: at + "T09:00:00.000Z", createdBy: agEmail, requestNote: "Bruit fort au démarrage, merci de chiffrer la réparation.",
      requestedAt: at + "T09:00:00.000Z", requestedBy: agEmail, submittedAt: addDaysStr_(today, -1) + "T16:00:00.000Z", amountHT: 880, vatRate: 20, amountTTC: split.amountTTC, estimatedDays: 1,
      commissionRateEst: 15, commissionEstimate: split.commissionAmount });
    dbUpdate_("IncidentsV4", ac.incidentId, { status: "AWAITING_OWNER", contractorId: art.artisanId, estimatedCost: split.amountTTC, updatedAt: nowIso_() });
    out.pendingQuote = 1;
  }
  if (art && bed && !dbAll_("WorkOrders").some(function (w) { return String(w.incidentId) === String(bed.incidentId); })) {
    const day = addDaysStr_(today, 2);
    dbInsert_("WorkOrders", { organizationId: bed.organizationId, propertyId: bed.propertyId, incidentId: bed.incidentId, quoteId: "", artisanId: art.artisanId, status: "SCHEDULED",
      scheduledAt: localToDate_(day, "10:00").toISOString(), description: "Remplacer le pied de lit cassé et vérifier la stabilité du sommier.", report: "", invoiceFileId: "", createdAt: nowIso_(), createdBy: agEmail,
      updatedAt: nowIso_(), updatedBy: agEmail, title: "Réparation du lit (chambre 2)", desiredDate: day, acceptedAt: nowIso_(), commissionRate: 15, photoDocIdsJson: [] });
    dbUpdate_("IncidentsV4", bed.incidentId, { status: "ASSIGNED", contractorId: art.artisanId, assignedToUserId: art.userId || "", updatedAt: nowIso_() });
    out.scheduledWorkOrder = 1;
  }
  // 2. Listes de tâches par pièce pour chaque ménage validé de la démonstration.
  const ids = Object.keys(props).map(function (k) { return String(props[k].prop.propertyId); });
  const missions = dbAll_("CleaningMissions").filter(function (m) { return ids.indexOf(String(m.propertyId)) >= 0 && m.status === "VALIDATED" && /démonstration/.test(String(m.notes || "")); })
    .sort(function (a, b) { return String(b.completedAt).localeCompare(String(a.completedAt)); });
  const hasList = {}; dbAll_("CleaningChecklists").forEach(function (c) { hasList[c.missionId] = true; });
  const tasks = ["Sols", "Surfaces", "Linge changé", "Sanitaires", "Poubelles", "Consommables"], lists = [];
  missions.forEach(function (m) {
    if (hasList[m.missionId]) return;
    const prop = dbGet_("Properties", m.propertyId), rooms = parseJson_(prop.roomsJson, []);
    rooms.forEach(function (room, i) {
      const items = {}; tasks.forEach(function (x) { items[x] = true; });
      const done = new Date(parseTs_(m.startedAt).getTime() + Math.round((i + 1) * num_(m.actualMinutes) / rooms.length) * 60000).toISOString();
      lists.push({ checklistId: newId_("clc"), organizationId: m.organizationId, missionId: m.missionId, room: room, itemsJson: items, doneAt: done, updatedAt: done });
    });
  });
  dbInsertMany_("CleaningChecklists", lists); out.checklists = lists.length;
  // 3. Photos avant / après (illustrations marquées « Photo de démonstration ») sur les 6 ménages les plus récents.
  const hasPhoto = {}; dbAll_("CleaningPhotos").forEach(function (c) { hasPhoto[c.missionId] = true; });
  const pics = [];
  missions.slice(0, 6).forEach(function (m) {
    if (hasPhoto[m.missionId]) return;
    [["Séjour", "sejour"], ["Cuisine", "cuisine"]].forEach(function (r) {
      [["BEFORE", "avant", m.startedAt], ["AFTER", "apres", m.completedAt]].forEach(function (ph) {
        const d = storeFile_({ propertyId: m.propertyId, organizationId: m.organizationId }, "CLEANING", m.missionId, "PHOTO",
          { mimeType: "image/jpeg", fileName: "Demo_" + r[1] + "_" + ph[1], base64: DEMO_PHOTOS_[r[1] + "_" + ph[1]] }, provU.email);
        pics.push({ photoId: newId_("clp"), organizationId: m.organizationId, missionId: m.missionId, propertyId: m.propertyId, room: r[0], phase: ph[0], documentId: d.documentId, takenAt: ph[2], takenBy: provU.email });
      });
    });
  });
  dbInsertMany_("CleaningPhotos", pics); out.photos = pics.length;
  return out;
}
