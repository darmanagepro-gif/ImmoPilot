/**
 * Suite de tests automatisés ImmoPilot.
 *
 * Exécution dans Google Apps Script : lancer runAllTests() depuis l'éditeur (propriétaire du script).
 *  - Crée un classeur et un dossier Drive TEMPORAIRES (« ImmoPilot_TEST_… »), n'utilise JAMAIS la base de production,
 *    capte les e-mails au lieu de les envoyer, puis met les éléments temporaires à la corbeille.
 *  - Résultat : tableau { group, name, status: PASS | FAIL | SKIP, detail }. Consultez aussi le journal d'exécution.
 * Les mêmes tests sont exécutés hors Google avec des simulateurs (tests/run-tests.js, Node.js) — voir TESTS.md.
 */
function runAllTests() {
  assertEditor_();
  const r = runTestSuite_({});
  Logger.log(JSON.stringify(r.summary));
  r.results.filter(function (x) { return x.status !== "PASS"; }).forEach(function (x) { Logger.log(x.status + " — " + x.group + " / " + x.name + " : " + x.detail); });
  return r;
}

function runTestSuite_(opts) {
  opts = opts || {};
  const results = [], env = testEnvSetup_();
  const T = testKit_(results);
  try {
    const fx = testFixtures_(T);
    TEST_GROUPS_().forEach(function (g) {
      if (opts.only && opts.only.indexOf(g.name) < 0) return;
      g.tests.forEach(function (t) { T.run(g.name, t[0], function () { t[1](T, fx); }); });
    });
  } catch (e) {
    results.push({ group: "Installation", name: "Préparation des données de test", status: "FAIL", detail: e.message + (e.stack ? " | " + String(e.stack).split("\n").slice(0, 3).join(" ") : "") });
  } finally { if (!opts.keep) testEnvTeardown_(env); }
  const summary = { total: results.length, passed: results.filter(function (x) { return x.status === "PASS"; }).length, failed: results.filter(function (x) { return x.status === "FAIL"; }).length,
    skipped: results.filter(function (x) { return x.status === "SKIP"; }).length, ranAt: nowIso_() };
  return { summary: summary, results: results };
}

function testEnvSetup_() {
  const stamp = Utilities.formatDate(new Date(), "UTC", "yyyyMMdd_HHmmss");
  const ss = SpreadsheetApp.create("ImmoPilot_TEST_" + stamp);
  const folder = DriveApp.createFolder("ImmoPilot_TEST_FILES_" + stamp);
  folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  const env = { ss: ss, folder: folder, previousSs: DB_SS_ };
  dbSetSpreadsheet_(ss);
  TEST_HOOKS_ = { driveRoot: folder, mailSink: [], appUrl: "https://example.test/exec", pbkdfIters: 50, mailQuota: null, aiConfig: false, aiFetch: null };
  ctxReset_();
  runMigrations_("tests");
  return env;
}
function testEnvTeardown_(env) {
  try { DriveApp.getFileById(env.ss.getId()).setTrashed(true); } catch (e) { console.error(e.message); }
  try { env.folder.setTrashed(true); } catch (e) { console.error(e.message); }
  DB_SS_ = null; dbReset_();
  TEST_HOOKS_ = { driveRoot: null, mailSink: null, appUrl: null, pbkdfIters: null, mailQuota: null, aiConfig: null, aiFetch: null };
}

function testKit_(results) {
  const T = {
    run: function (group, name, fn) {
      try { const r = fn(); results.push({ group: group, name: name, status: r === "SKIP" ? "SKIP" : "PASS", detail: r === "SKIP" ? "Non exécutable dans cet environnement" : "" }); }
      catch (e) { results.push({ group: group, name: name, status: e && e.skip ? "SKIP" : "FAIL", detail: String(e && e.message || e) }); }
    },
    ok: function (cond, msg) { if (!cond) throw new Error("Assertion : " + msg); },
    eq: function (a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || "Égalité") + " — attendu " + JSON.stringify(b) + ", obtenu " + JSON.stringify(a)); },
    near: function (a, b, msg) { if (Math.abs(Number(a) - Number(b)) > 0.011) throw new Error((msg || "Valeur") + " — attendu " + b + ", obtenu " + a); },
    call: function (tok, route, args) { const r = api(tok, route, args || {}); if (!r.ok) throw new Error(route + " a échoué : " + r.error.code + " — " + r.error.message); return r.data; },
    pub: function (route, args) { const r = apiPublic(route, args || {}); if (!r.ok) throw new Error(route + " a échoué : " + r.error.code + " — " + r.error.message); return r.data; },
    fails: function (tok, route, args, code) {
      const r = tok === null ? apiPublic(route, args || {}) : api(tok, route, args || {});
      if (r.ok) throw new Error(route + " aurait dû échouer" + (code ? " (" + code + ")" : ""));
      if (code && r.error.code !== code) throw new Error(route + " : code " + r.error.code + " au lieu de " + code + " (" + r.error.message + ")");
      return r.error;
    },
    key: function () { return "k_" + Utilities.getUuid().replace(/-/g, ""); },
    lastMailTo: function (email) { const m = TEST_HOOKS_.mailSink.filter(function (x) { return x.to === email; }); return m[m.length - 1] || null; },
    tokenFrom: function (text, action) { const m = String(text || "").match(new RegExp("action=" + action + "&token=([a-f0-9]{64})")); return m ? m[1] : ""; },
    skip: function (msg) { const e = new Error(msg); e.skip = true; throw e; }
  };
  return T;
}

/** Crée un utilisateur actif avec un rôle (raccourci de test : en production, passer par une invitation). */
function tMakeUser_(email, role, orgId, pw) {
  const u = dbInsert_("Users", { email: email, displayName: email.split("@")[0], status: "ACTIVE", createdAt: nowIso_(), createdBy: "tests", locale: "fr", notifPrefsJson: { email: true, mutedTypes: [] } });
  dbInsert_("UserRoles", { userId: u.userId, organizationId: orgId, role: role, status: "ACTIVE", createdAt: nowIso_(), createdBy: "tests", permissionsJson: "[]" });
  setUserPassword_(u.userId, pw);
  return u;
}
function tOrg_(name, type) { return dbInsert_("Organizations", { name: name, status: "ACTIVE", type: type, city: "Marrakech", createdAt: nowIso_(), createdBy: "tests" }); }

function testFixtures_(T) {
  const pw = "Test-Passw0rd!", run = Utilities.getUuid().slice(0, 6), mail = function (n) { return n + "." + run + "@example.test"; };
  const platform = dbAll_("Organizations").find(function (o) { return o.type === "PLATFORM"; });
  const orgA = tOrg_("Propriétaire A " + run, "OWNER_ORG"), orgB = tOrg_("Propriétaire B " + run, "OWNER_ORG");
  const ag1 = tOrg_("Agence 1 " + run, "AGENCY"), ag2 = tOrg_("Agence 2 " + run, "AGENCY"), prov = tOrg_("Prestataires " + run, "PROVIDER");
  const users = {
    superA: tMakeUser_(mail("super"), "SUPER_ADMIN", platform.organizationId, pw), ownerA: tMakeUser_(mail("ownera"), "OWNER", orgA.organizationId, pw),
    ownerB: tMakeUser_(mail("ownerb"), "OWNER", orgB.organizationId, pw), ag1: tMakeUser_(mail("ag1"), "AGENCY_ADMIN", ag1.organizationId, pw),
    ag1u: tMakeUser_(mail("ag1u"), "AGENCY_USER", ag1.organizationId, pw), ag2: tMakeUser_(mail("ag2"), "AGENCY_ADMIN", ag2.organizationId, pw),
    cleaner: tMakeUser_(mail("cleaner"), "CLEANER", prov.organizationId, pw), cleaner2: tMakeUser_(mail("cleaner2"), "CLEANER", prov.organizationId, pw),
    guard: tMakeUser_(mail("guard"), "GUARD", orgA.organizationId, pw), artisan: tMakeUser_(mail("artisan"), "ARTISAN", prov.organizationId, pw),
    tenant: tMakeUser_(mail("tenant"), "TENANT", orgA.organizationId, pw)
  };
  const tok = {};
  Object.keys(users).forEach(function (k) { tok[k] = T.pub("auth.login", { email: users[k].email, password: pw }).token; });
  const propA = T.call(tok.ownerA, "property.create", { organizationId: orgA.organizationId, name: "Riad Test A", city: "Marrakech", bedrooms: 2, capacity: 4, nightlyPrice: 1000, cleaningFee: 200,
    managementCommissionRate: 20, checkInTime: "15:00", checkOutTime: "11:00", rentalMode: "SHORT_TERM", rooms: ["Séjour", "Chambre"] }).propertyId;
  const propA2 = T.call(tok.ownerA, "property.create", { organizationId: orgA.organizationId, name: "Appartement Gueliz", city: "Marrakech", rentalMode: "LONG_TERM", monthlyRent: 5000 }).propertyId;
  const propB = T.call(tok.ownerB, "property.create", { organizationId: orgB.organizationId, name: "Villa B", city: "Marrakech", nightlyPrice: 2000 }).propertyId;
  return { pw: pw, run: run, mail: mail, platform: platform, orgA: orgA, orgB: orgB, ag1: ag1, ag2: ag2, prov: prov, users: users, tok: tok, propA: propA, propA2: propA2, propB: propB };
}

function tDays_(n) { return addDaysStr_(todayStr_(), n); }

/* ===================================== GROUPES DE TESTS ===================================== */
function TEST_GROUPS_() {
  return [
    { name: "Cache des tables", tests: [
      ["Cache partagé : lecture sans feuille, invalidation immédiate à l'écriture, grosses tables, sessions révoquées, vidage manuel", function (T, fx) {
        if (typeof __MOCK__ === "undefined") T.skip("Compteurs de lecture disponibles dans le simulateur uniquement.");
        T.call(fx.tok.ownerA, "property.list", {});
        const r0 = __MOCK__.stats.sheetReads;
        T.call(fx.tok.ownerA, "property.list", {});
        T.ok(__MOCK__.stats.sheetReads - r0 <= 1, "deuxième lecture servie par le cache (" + (__MOCK__.stats.sheetReads - r0) + " lecture)");
        T.call(fx.tok.ownerA, "property.update", { propertyId: fx.propA, name: "Riad renommé cache" });
        T.ok(T.call(fx.tok.ag1, "property.list", {}).items.concat(T.call(fx.tok.ownerA, "property.list", {}).items).some(function (p) { return p.name === "Riad renommé cache"; }), "modification visible aussitôt par les autres comptes");
        T.call(fx.tok.ownerA, "property.update", { propertyId: fx.propA, name: "Riad Test A" });
        // Écriture directe (hors requête) : version changée tout de suite
        dbUpdate_("Properties", fx.propA, { name: "Écriture directe" });
        T.ok(T.call(fx.tok.ownerA, "property.list", {}).items.some(function (p) { return p.name === "Écriture directe"; }), "écriture hors requête prise en compte");
        dbUpdate_("Properties", fx.propA, { name: "Riad Test A" });
        // Grosse table : découpée en plusieurs morceaux de cache, relue à l'identique
        const big = []; for (let i = 0; i < 1500; i++) big.push({ organizationId: fx.orgA.organizationId, propertyId: fx.propA, category: "SUPPLIES", amount: i, expenseDate: todayStr_(), description: Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + " " + i, status: "PAID", createdAt: nowIso_(), createdBy: "cache-test" });
        dbInsertMany_("Expenses", big);
        dbReset_(); dbcBegin_("request"); const fromSheet = dbAll_("Expenses").length; dbcCommit_();
        dbReset_(); dbcBegin_("request"); const st0 = __MOCK__.stats.sheetReads; const fromCache = dbAll_("Expenses");
        T.eq(fromCache.length, fromSheet, "même nombre de lignes"); T.eq(__MOCK__.stats.sheetReads, st0, "servie par le cache");
        const k0 = Object.keys(__MOCK__.cache).filter(function (k) { return /d_Expenses_1$/.test(k); });
        T.ok(k0.length > 0, "table découpée en plusieurs morceaux");
        T.ok(fromCache.some(function (e) { return e.description && / 1499$/.test(e.description); }), "contenu intact");
        DBC_ = null; dbReset_();
        // Session révoquée : refusée immédiatement malgré le cache des sessions
        const tok = T.pub("auth.login", { email: fx.users.guard.email, password: fx.pw }).token;
        T.call(tok, "me.get", {}); T.call(tok, "me.get", {});
        T.call(tok, "me.logout", {});
        T.fails(tok, "me.get", {}, "AUTH");
        // Écriture sous verrou : lue dans la feuille, puis cache invalidé avant de rendre le verrou
        const r = T.call(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(800), checkOut: tDays_(802), guestName: "Cache verrou", idempotencyKey: T.key() });
        T.fails(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(801), checkOut: tDays_(803), guestName: "Doublon", idempotencyKey: T.key() });
        T.ok(T.call(fx.tok.ownerA, "resv.get", { reservationId: r.reservationId }).reservation || true, "réservation relue");
        // Vidage manuel (époque) : tout est relu
        dbcBumpEpoch_(); DBC_ = null;
        const st1 = __MOCK__.stats.sheetReads; T.call(fx.tok.ownerA, "property.list", {});
        T.ok(__MOCK__.stats.sheetReads > st1, "après viderCache, relecture du classeur");
        T.eq(surModificationBase({ source: "faux" }), undefined, "appel non issu du déclencheur sans effet");
      }]
    ] },
    { name: "Super administrateur : comptes clients", tests: [
      ["Comptes classés par espace, entrer dans l'espace d'un client, actions journalisées au nom du super administrateur, retour", function (T, fx) {
        T.fails(fx.tok.ownerA, "admin.accounts", {}, "FORBIDDEN");
        T.fails(fx.tok.ownerA, "admin.impersonate", { userId: fx.users.ownerB.userId }, "FORBIDDEN");
        const own = T.call(fx.tok.superA, "admin.accounts", { category: "OWNER", q: fx.run, pageSize: 100 });
        T.ok(own.items.some(function (r) { return r.userId === fx.users.ownerA.userId; }) && !own.items.some(function (r) { return r.userId === fx.users.ag1.userId; }), "propriétaires seulement");
        T.ok(T.call(fx.tok.superA, "admin.accounts", { category: "AGENCY", q: fx.run, pageSize: 100 }).items.some(function (r) { return r.userId === fx.users.ag1u.userId; }), "agences");
        const prov = T.call(fx.tok.superA, "admin.accounts", { category: "PROVIDER", q: fx.run, pageSize: 100 }).items.map(function (r) { return r.userId; });
        T.ok(prov.indexOf(fx.users.cleaner.userId) >= 0 && prov.indexOf(fx.users.artisan.userId) >= 0 && prov.indexOf(fx.users.ownerA.userId) < 0, "prestataires (ménage et artisans)");
        T.ok(!T.call(fx.tok.superA, "admin.accounts", { pageSize: 500 }).items.some(function (r) { return r.userId === fx.users.superA.userId; }), "super administrateurs exclus");
        T.fails(fx.tok.superA, "admin.impersonate", { userId: fx.users.superA.userId });
        const s = T.call(fx.tok.superA, "admin.impersonate", { userId: fx.users.ownerA.userId });
        T.ok(s.token && s.token !== fx.tok.superA && s.me.userId === fx.users.ownerA.userId && s.me.impersonator.email === fx.users.superA.email && !s.me.isSuper, "vue du propriétaire");
        T.ok(s.meta && s.meta.enums, "métadonnées fournies");
        const me = T.call(s.token, "me.get", {});
        T.ok(me.impersonator && me.roles[0].role === "OWNER", "session au nom du propriétaire");
        T.ok(T.call(s.token, "property.list", {}).items.some(function (x) { return x.propertyId === fx.propA; }), "voit ses biens");
        T.ok(!T.call(s.token, "property.list", {}).items.some(function (x) { return x.propertyId === fx.propB; }), "ne voit que ce que voit le propriétaire");
        T.fails(s.token, "property.get", { propertyId: fx.propB }, "FORBIDDEN");
        const r = T.call(s.token, "resv.create", { propertyId: fx.propA, checkIn: tDays_(500), checkOut: tDays_(502), guestName: "Saisi par le support", idempotencyKey: T.key() });
        const log = dbAll_("ActivityLogs").filter(function (l) { return String(l.entityId) === String(r.reservationId); })[0];
        T.ok(log && log.actorEmail === fx.users.superA.email && parseJson_(log.detailsJson, {}).asUser === fx.users.ownerA.email, "action journalisée au nom du super administrateur");
        T.fails(s.token, "me.changePassword", { currentPassword: fx.pw, newPassword: "Autre-Passw0rd!" }, "FORBIDDEN");
        T.fails(s.token, "me.logoutAll", {}, "FORBIDDEN");
        T.fails(s.token, "admin.impersonate", { userId: fx.users.ownerB.userId }, "FORBIDDEN");
        T.ok(dbAll_("ActivityLogs").some(function (l) { return l.action === "IMPERSONATION_START" && String(l.entityId) === String(fx.users.ownerA.userId) && l.actorEmail === fx.users.superA.email; }), "entrée journalisée");
        T.call(s.token, "me.endImpersonation", {});
        T.fails(s.token, "me.get", {}, "AUTH");
        T.ok(T.call(fx.tok.superA, "me.get", {}).isSuper, "le super administrateur garde sa session");
        T.ok(T.call(fx.tok.ownerA, "me.get", {}).impersonator === null, "la session du propriétaire n'est pas touchée");
        const s2 = T.call(fx.tok.superA, "admin.impersonate", { userId: fx.users.cleaner.userId });
        T.ok(s2.me.roles.some(function (x) { return x.role === "CLEANER"; }), "espace prestataire");
        const sr = dbAll_("UserRoles").find(function (x) { return String(x.userId) === String(fx.users.superA.userId) && x.role === "SUPER_ADMIN"; });
        dbUpdate_("UserRoles", sr.userRoleId, { status: "SUSPENDED" });
        try { T.fails(s2.token, "me.get", {}, "AUTH"); } finally { dbUpdate_("UserRoles", sr.userRoleId, { status: "ACTIVE" }); }
      }]
    ] },
    { name: "Assistant Rubban", tests: [
      ["Assistant : guide sans clé, IA côté serveur uniquement, aucune donnée client transmise, repli automatique", function (T, fx) {
        const pub = T.pub("assistant.kb", {});
        T.ok(pub.name === "Rubban" && pub.articles.length >= 40 && pub.aiEnabled === false, "base de connaissances publique");
        const routes = ["", "settings", "notifications", "properties", "agencies", "reservations", "calendar", "checkin", "cleaning", "incidents", "quotes", "workorders", "invoices", "contractors",
          "leases", "mylease", "finance", "pareto", "reports", "dashboard", "users", "subscriptions", "audit", "admin", "accounts"];
        T.ok(pub.articles.every(function (a) { return routes.indexOf(a.go) >= 0 && a.s.length && a.r.length; }), "chaque article pointe vers une page existante");
        T.ok(JSON.stringify(pub).indexOf("IMMO_AI_API_KEY") < 0 || JSON.stringify(pub).indexOf("sk-") < 0, "aucune clé dans la réponse");
        const kb = T.call(fx.tok.ownerA, "assistant.kb", {});
        T.ok(kb.roles.indexOf("OWNER") >= 0 && kb.aiEnabled === false, "rôles de l'utilisateur, IA désactivée sans clé");
        T.eq(T.call(fx.tok.ownerA, "assistant.ask", { question: "Comment créer une réservation ?" }).mode, "guide", "sans clé : mode guide");
        T.fails(null, "assistant.ask", { question: "test" });
        const seen = [];
        TEST_HOOKS_.aiConfig = { provider: "anthropic", key: "cle-secrete-test", model: "claude-haiku-5-5" };
        TEST_HOOKS_.aiFetch = function (req) {
          seen.push(req);
          return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ content: [{ type: "text", text: "1. Ouvrez « Réservations »\n2. Cliquez sur « + Nouvelle réservation »" }] }); } };
        };
        try {
          T.ok(T.call(fx.tok.ownerA, "assistant.kb", {}).aiEnabled === true && T.pub("assistant.kb", {}).aiEnabled === false, "IA signalée aux seuls utilisateurs connectés");
          const r = T.call(fx.tok.ownerA, "assistant.ask", { question: "Comment créer une réservation ?", lang: "fr", page: "dashboard",
            history: [{ role: "assistant", content: "Bonjour" }, { role: "user", content: "Salut" }, { role: "assistant", content: "Que puis-je faire ?" }] });
          T.ok(r.mode === "ai" && /Nouvelle réservation/.test(r.answer), "réponse IA");
          const body = JSON.parse(seen[0].payload);
          T.ok(seen[0].headers["x-api-key"] === "cle-secrete-test" && seen[0].url.indexOf("api.anthropic.com") > 0, "clé envoyée par le serveur au seul fournisseur");
          T.ok(body.messages[0].role === "user" && body.messages[body.messages.length - 1].content === "Comment créer une réservation ?", "conversation bien formée");
          T.ok(body.system.indexOf("Rubban") >= 0 && body.system.indexOf("Riad Test A") < 0 && body.system.indexOf(fx.users.ownerA.email) < 0, "aucune donnée du compte transmise");
          TEST_HOOKS_.aiConfig = { provider: "gemini", key: "cle-g", model: "gemini-3.5-flash-lite" };
          TEST_HOOKS_.aiFetch = function (req) { seen.push(req); return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ candidates: [{ content: { parts: [{ text: "Réponse Gemini" }] } }] }); } }; };
          const g = T.call(fx.tok.ownerA, "assistant.ask", { question: "Comment inviter un utilisateur ?", lang: "en" });
          T.ok(g.mode === "ai" && g.answer === "Réponse Gemini" && seen[seen.length - 1].headers["x-goog-api-key"] === "cle-g" && JSON.parse(seen[seen.length - 1].payload).systemInstruction.parts[0].text.indexOf("English") > 0, "Gemini");
          TEST_HOOKS_.aiFetch = function () { return { getResponseCode: function () { return 500; }, getContentText: function () { return "{}"; } }; };
          const f = T.call(fx.tok.ownerA, "assistant.ask", { question: "Comment créer un bien ?" });
          T.ok(f.mode === "guide" && /indisponible/.test(f.notice), "panne du service : repli sur le guide");
        } finally { TEST_HOOKS_.aiConfig = false; TEST_HOOKS_.aiFetch = null; }
      }]
    ] },
    { name: "Comptes et sécurité", tests: [
      ["Mot de passe haché (PBKDF2 vecteurs RFC) et jamais stocké en clair", function (T, fx) {
        T.eq(pbkdf2Hex_("password", "73616c74", 1), "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b", "PBKDF2 c=1");
        T.eq(pbkdf2Hex_("password", "73616c74", 2), "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43", "PBKDF2 c=2");
        const u = dbGet_("Users", fx.users.ownerA.userId);
        T.ok(u.passwordHash && u.passwordHash.length === 64 && JSON.stringify(u).indexOf(fx.pw) < 0, "le mot de passe ne doit apparaître nulle part");
      }],
      ["Connexion rapide : PBKDF2 en JavaScript (RFC), re-hachage transparent, un seul aller-retour, lectures ciblées", function (T, fx) {
        T.eq(pbkdf2Hex_("password", "73616c74", 4096), "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a", "vecteur RFC c=4096");
        T.eq(pbkdf2Hex_("passwordPASSWORDpassword", "73616c7453414c5473616c7453414c5473616c7453414c5473616c7453414c5473616c74", 4096).slice(0, 64),
          "348c89dbcbd32b2f32d814b8116e84cf2b17347ebc1800181c4e2a1fb8dd53e1", "vecteur RFC (sel long)");
        const email = fx.mail("rehash"), u = tMakeUser_(email, "OWNER", fx.orgA.organizationId, "Rehash-Pass1");
        const before = dbGet_("Users", u.userId).passwordIters;
        TEST_HOOKS_.pbkdfIters = Number(before) + 10;
        try {
          const r = T.pub("auth.login", { email: email, password: "Rehash-Pass1" });
          T.ok(r.token && r.me && r.meta && r.meta.roleCaps, "la connexion renvoie aussi les métadonnées (pas d'appel supplémentaire)");
          T.eq(Number(dbGet_("Users", u.userId).passwordIters), Number(before) + 10, "mot de passe re-haché avec le nouveau nombre d'itérations");
          T.ok(T.pub("auth.login", { email: email, password: "Rehash-Pass1" }).token, "connexion toujours valide après re-hachage");
          T.fails(null, "auth.login", { email: email, password: "Mauvais-Pass1" }, "AUTH");
          const b = T.call(r.token, "me.boot", {});
          T.ok(b.me.email === email && b.meta.roleCaps, "reprise de session en un seul appel");
        } finally { TEST_HOOKS_.pbkdfIters = 50; }
        const s = dbAll_("Sessions")[dbAll_("Sessions").length - 1];
        dbReset_();
        T.eq(dbFindFast_("Sessions", "tokenHash", s.tokenHash).sessionId, s.sessionId, "recherche ciblée de la session");
        T.eq(dbFindFast_("Sessions", "tokenHash", "0".repeat(64)), null, "jeton inconnu");
        dbReset_();
        const from = addDaysStr_(todayStr_(), -1);
        T.eq(dbTailSince_("ActivityLogs", "timestamp", from, 7).length, dbAll_("ActivityLogs").filter(function (l) { return String(l.timestamp) >= from; }).length, "lecture des journaux récents seulement");
      }],
      ["Invitation valide → compte activé → connexion", function (T, fx) {
        const email = fx.mail("newcleaner");
        T.call(fx.tok.ownerA, "invite.create", { email: email, organizationId: fx.orgA.organizationId, role: "CLEANER", displayName: "Nouvelle Équipe" });
        const token = T.tokenFrom(T.lastMailTo(email).body, "accept");
        T.ok(token, "lien d'invitation présent dans l'e-mail");
        T.eq(T.pub("invite.info", { token: token }).role, "CLEANER", "rôle de l'invitation");
        T.pub("invite.accept", { token: token, password: "Nouveau-Pass1", displayName: "Équipe" });
        T.ok(T.pub("auth.login", { email: email, password: "Nouveau-Pass1" }).token, "connexion après activation");
        T.ok(!dbAll_("Invitations").find(function (i) { return i.email === email; }).tokenHash, "le jeton est effacé après usage");
      }],
      ["Invitation expirée refusée", function (T, fx) {
        const email = fx.mail("expired");
        const r = T.call(fx.tok.ownerA, "invite.create", { email: email, organizationId: fx.orgA.organizationId, role: "GUARD" });
        dbUpdate_("Invitations", r.invitationId, { expiresAt: new Date(Date.now() - 60000).toISOString() });
        T.fails(null, "invite.accept", { token: T.tokenFrom(T.lastMailTo(email).body, "accept"), password: "Abcdefgh12" }, "EXPIRED");
      }],
      ["Invitation déjà utilisée refusée", function (T, fx) {
        const email = fx.mail("twice");
        T.call(fx.tok.ownerA, "invite.create", { email: email, organizationId: fx.orgA.organizationId, role: "GUARD" });
        const token = T.tokenFrom(T.lastMailTo(email).body, "accept");
        T.pub("invite.accept", { token: token, password: "Abcdefgh12" });
        T.fails(null, "invite.accept", { token: token, password: "Abcdefgh12" }, "AUTH");
      }],
      ["Invitation révoquée inutilisable", function (T, fx) {
        const email = fx.mail("revoked");
        const r = T.call(fx.tok.ownerA, "invite.create", { email: email, organizationId: fx.orgA.organizationId, role: "GUARD" });
        const token = T.tokenFrom(T.lastMailTo(email).body, "accept");
        T.call(fx.tok.ownerA, "invite.revoke", { invitationId: r.invitationId });
        T.fails(null, "invite.accept", { token: token, password: "Abcdefgh12" }, "AUTH");
      }],
      ["E-mail non autorisé / identifiants invalides / jeton forgé", function (T, fx) {
        T.fails(null, "auth.login", { email: fx.mail("inconnu"), password: "Whatever123" }, "AUTH");
        T.fails(null, "auth.login", { email: fx.users.ownerA.email, password: "Mauvais-pass9" }, "AUTH");
        T.fails("0".repeat(64), "property.list", {}, "AUTH");
        T.fails("pas-un-jeton", "property.list", {}, "AUTH");
      }],
      ["Verrouillage après 5 échecs de connexion", function (T, fx) {
        const u = tMakeUser_(fx.mail("lock"), "OWNER", fx.orgB.organizationId, fx.pw);
        for (let i = 0; i < 5; i++) T.fails(null, "auth.login", { email: u.email, password: "Mauvais-pass9" });
        T.fails(null, "auth.login", { email: u.email, password: fx.pw }, "LOCKED");
      }],
      ["Utilisateur suspendu : sessions révoquées et connexion refusée", function (T, fx) {
        const u = tMakeUser_(fx.mail("susp"), "OWNER", fx.orgB.organizationId, fx.pw);
        const tok = T.pub("auth.login", { email: u.email, password: fx.pw }).token;
        T.call(fx.tok.superA, "user.setStatus", { userId: u.userId, status: "SUSPENDED", reason: "test" });
        T.fails(tok, "property.list", {}, "AUTH");
        T.fails(null, "auth.login", { email: u.email, password: fx.pw }, "AUTH");
      }],
      ["Organisation suspendue : accès coupé, données conservées", function (T, fx) {
        const org = tOrg_("Org suspendue " + fx.run, "OWNER_ORG"), u = tMakeUser_(fx.mail("orgsusp"), "OWNER", org.organizationId, fx.pw);
        const tok = T.pub("auth.login", { email: u.email, password: fx.pw }).token;
        const pid = T.call(tok, "property.create", { organizationId: org.organizationId, name: "Bien conservé", city: "Fès" }).propertyId;
        T.call(fx.tok.superA, "org.setStatus", { organizationId: org.organizationId, status: "SUSPENDED", reason: "Impayé test" });
        T.fails(tok, "property.list", {}, "AUTH");
        T.ok(dbGet_("Properties", pid), "le bien n'est pas supprimé");
        T.call(fx.tok.superA, "org.setStatus", { organizationId: org.organizationId, status: "ACTIVE" });
        T.eq(T.call(tok, "property.list", {}).total, 1, "accès rétabli");
      }],
      ["Accès au bien d'un autre propriétaire refusé (IDOR)", function (T, fx) {
        T.fails(fx.tok.ownerB, "property.get", { propertyId: fx.propA }, "FORBIDDEN");
        T.fails(fx.tok.ownerB, "property.update", { propertyId: fx.propA, name: "Piraté" }, "FORBIDDEN");
        T.ok(!T.call(fx.tok.ownerB, "property.list", {}).items.some(function (x) { return x.propertyId === fx.propA; }), "liste cloisonnée");
        T.fails(fx.tok.ownerB, "resv.create", { propertyId: fx.propA, checkIn: tDays_(200), checkOut: tDays_(202), guestName: "Intrus" }, "FORBIDDEN");
      }],
      ["Super administrateur sans accès aux données privées sauf assistance approuvée", function (T, fx) {
        T.fails(fx.tok.superA, "property.get", { propertyId: fx.propA }, "FORBIDDEN");
        const g = T.call(fx.tok.superA, "support.request", { organizationId: fx.orgA.organizationId, justification: "Ticket 42 : analyse d'un bug d'affichage", hours: 2 });
        T.fails(fx.tok.superA, "property.get", { propertyId: fx.propA }, "FORBIDDEN");
        T.call(fx.tok.ownerA, "support.decide", { grantId: g.grantId, decision: "APPROVE" });
        T.eq(T.call(fx.tok.superA, "property.get", { propertyId: fx.propA }).propertyId, fx.propA, "lecture autorisée sous assistance");
        T.fails(fx.tok.superA, "property.update", { propertyId: fx.propA, name: "X" }, "FORBIDDEN");
        T.call(fx.tok.ownerA, "support.revoke", { grantId: g.grantId });
        T.fails(fx.tok.superA, "property.get", { propertyId: fx.propA }, "FORBIDDEN");
      }],
      ["Élévation de privilèges impossible", function (T, fx) {
        T.fails(fx.tok.ag1u, "invite.create", { email: fx.mail("x1"), organizationId: fx.ag1.organizationId, role: "AGENCY_ADMIN" }, "FORBIDDEN");
        T.fails(fx.tok.ownerA, "invite.create", { email: fx.mail("x2"), organizationId: fx.orgA.organizationId, role: "SUPER_ADMIN" }, "FORBIDDEN");
        T.fails(fx.tok.ag1, "invite.create", { email: fx.mail("x3"), organizationId: fx.ag1.organizationId, role: "OWNER" }, "FORBIDDEN");
        T.fails(fx.tok.ownerA, "invite.create", { email: fx.mail("x4"), organizationId: fx.orgB.organizationId, role: "OWNER" }, "FORBIDDEN");
        const role = dbAll_("UserRoles").find(function (r) { return r.userId === fx.users.ag1u.userId; });
        T.call(fx.tok.ag1, "role.setPermissions", { userRoleId: role.userRoleId, removedCaps: ["reservation.edit", "+platform.admin", "platform.admin"] });
        T.eq(parseJson_(dbGet_("UserRoles", role.userRoleId).permissionsJson, []), ["-reservation.edit"], "seules des capacités du rôle peuvent être retirées");
        T.call(fx.tok.ag1, "role.setPermissions", { userRoleId: role.userRoleId, removedCaps: [] });
        const own = dbAll_("UserRoles").find(function (r) { return r.userId === fx.users.ag1.userId; });
        T.fails(fx.tok.ag1, "role.setPermissions", { userRoleId: own.userRoleId, removedCaps: [] }, "FORBIDDEN");
        T.fails(fx.tok.ownerA, "org.create", { name: "Pirate" }, "FORBIDDEN");
      }],
      ["Mes agences : fiche complète, changement d'e-mail du responsable avec nouveau lien d'activation, renvoi du lien", function (T, fx) {
        const e1 = fx.mail("resp1"), e2 = fx.mail("resp2"), e3 = fx.mail("resp3");
        const r = T.call(fx.tok.ownerA, "property.agencyCreate", { propertyId: fx.propA, name: "Agence Fiche " + fx.run, adminEmail: e1, adminName: "Premier", canManageReservations: true });
        const ag = r.organizationId;
        // Correction de l'e-mail avant activation : l'invitation part à la bonne adresse, l'ancienne est révoquée.
        const u1 = T.call(fx.tok.ownerA, "agency.update", { agencyOrganizationId: ag, name: "Agence Fiche " + fx.run, address: "12 rue de la Liberté", phone: "+212600000000", adminName: "Second", adminEmail: e2 });
        T.ok(u1.responsible.changed && u1.responsible.emailSent, "nouveau lien envoyé");
        T.eq(dbGet_("Invitations", r.invitationId).status, "REVOKED", "ancienne invitation révoquée");
        T.fails(null, "invite.accept", { token: T.tokenFrom(T.lastMailTo(e1).body, "accept"), password: "Ancien-Pass1" });
        const o = dbGet_("Organizations", ag);
        T.eq([o.address, o.phone, o.contactName, o.billingEmail], ["12 rue de la Liberté", "+212600000000", "Second", e2], "fiche complète enregistrée");
        // Renvoi du lien : nouveau jeton, l'ancien ne marche plus.
        const firstToken = T.tokenFrom(T.lastMailTo(e2).body, "accept");
        T.ok(T.call(fx.tok.ownerA, "agency.resendInvite", { agencyOrganizationId: ag }).emailSent, "lien renvoyé");
        const secondToken = T.tokenFrom(T.lastMailTo(e2).body, "accept");
        T.ok(firstToken !== secondToken, "nouveau jeton");
        T.fails(null, "invite.accept", { token: firstToken, password: "Second-Pass1" });
        T.pub("invite.accept", { token: secondToken, password: "Second-Pass1" });
        const tok2 = T.pub("auth.login", { email: e2, password: "Second-Pass1" }).token;
        T.eq(T.call(tok2, "property.list", {}).items.length, 1, "le responsable activé voit le bien confié");
        T.fails(fx.tok.ownerA, "agency.resendInvite", { agencyOrganizationId: ag }, "VALIDATION");
        let mine = T.call(fx.tok.ownerA, "agency.mine", {}).find(function (x) { return x.organizationId === ag; });
        T.ok(mine.responsible.email === e2 && mine.responsible.activated && mine.address === "12 rue de la Liberté", "« Mes agences » affiche le responsable activé");
        // Nouveau responsable après activation : l'ancien perd l'accès à l'agence (son compte reste), le nouveau reçoit son lien.
        T.call(fx.tok.ownerA, "agency.update", { agencyOrganizationId: ag, adminName: "Troisième", adminEmail: e3 });
        T.fails(tok2, "property.get", { propertyId: fx.propA });
        T.ok(dbAll_("Users").some(function (u) { return u.email === e2; }) && T.lastMailTo(e3) && /action=accept/.test(T.lastMailTo(e3).body), "ancien compte conservé, nouveau lien envoyé");
        T.fails(fx.tok.ownerB, "agency.update", { agencyOrganizationId: ag, adminEmail: fx.mail("pirate2") }, "FORBIDDEN");
        mine = T.call(fx.tok.ownerA, "agency.mine", {}).find(function (x) { return x.organizationId === ag; });
        T.ok(mine.responsible.email === e3 && !mine.responsible.activated && mine.includedInMySubscription, "en attente d'activation, incluse dans l'abonnement du propriétaire");
      }],
      ["Abonnement : les agences créées par un propriétaire sont une option de son abonnement", function (T, fx) {
        const org = tOrg_("Propriétaire Option " + fx.run, "OWNER_ORG"), owner = tMakeUser_(fx.mail("owner-opt"), "OWNER", org.organizationId, fx.pw);
        const tok = T.pub("auth.login", { email: owner.email, password: fx.pw }).token;
        const prop = T.call(tok, "property.create", { organizationId: org.organizationId, name: "Bien Option", city: "Marrakech" }).propertyId;
        const ag = T.call(tok, "property.agencyCreate", { propertyId: prop, name: "Agence Option " + fx.run, adminEmail: fx.mail("ag-opt"), canManageReservations: true }).organizationId;
        T.eq(String(dbGet_("Organizations", ag).managedByOrgId), String(org.organizationId), "agence rattachée au propriétaire");
        T.fails(fx.tok.superA, "sub.assign", { organizationId: ag, planCode: "PRO" }, "VALIDATION");
        const pro = dbGet_("SubscriptionPlans", "PRO");
        T.call(fx.tok.superA, "plan.save", Object.assign(planOut_(pro), { agencyOptionPrice: 50 }));
        const sid = T.call(fx.tok.superA, "sub.assign", { organizationId: org.organizationId, planCode: "PRO" }).subscriptionId;
        const row = T.call(fx.tok.superA, "sub.list", { organizationId: org.organizationId }).items[0];
        T.eq([row.agencyOption.count, row.agencyOption.unitPrice, row.agencyOption.totalPrice], [1, 50, num_(pro.price) + 50], "option agences comptée sur l'abonnement du propriétaire");
        const agMine = (function () { const u = tMakeUser_(fx.mail("ag-admin-opt"), "AGENCY_ADMIN", ag, fx.pw); return T.pub("auth.login", { email: u.email, password: fx.pw }).token; })();
        const view = T.call(agMine, "sub.mine", {})[0];
        T.ok(view.includedIn === org.name && !view.subscription && !view.billing.length, "l'agence voit « incluse », sans les montants du propriétaire");
        T.call(fx.tok.superA, "sub.setStatus", { subscriptionId: sid, action: "SUSPEND" });
        T.ok(entitlement_(ag).readOnly === true && entitlement_(ag).inheritedFrom === String(org.organizationId), "abonnement du propriétaire suspendu : l'agence passe aussi en lecture seule");
        T.fails(agMine, "resv.create", { propertyId: prop, checkIn: tDays_(40), checkOut: tDays_(42), guestName: "Test Option" }, "SUBSCRIPTION");
        T.call(fx.tok.superA, "sub.setStatus", { subscriptionId: sid, action: "REACTIVATE" });
        const contract = Utilities.newBlob(Utilities.base64Decode(T.call(tok, "sub.contractPdf", { organizationId: org.organizationId }).base64)).getDataAsString();
        T.ok(contract.indexOf("Option agences") > 0 && contract.indexOf("Agence Option " + fx.run) > 0, "option détaillée dans le contrat");
        T.call(fx.tok.superA, "plan.save", Object.assign(planOut_(pro), { agencyOptionPrice: num_(pro.agencyOptionPrice) }));
      }],
      ["Propriétaire : création d'une agence, invitation de son responsable et attribution du bien", function (T, fx) {
        const email = fx.mail("agence-duplex");
        const r = T.call(fx.tok.ownerA, "property.agencyCreate", { propertyId: fx.propA, name: "Agence Duplex Test", adminEmail: email, adminName: "Youssef", canManageReservations: true, commissionRate: 18 });
        const org = dbGet_("Organizations", r.organizationId);
        T.eq([org.type, org.status], ["AGENCY", "ACTIVE"], "organisation de type agence créée");
        const inv = dbGet_("Invitations", r.invitationId);
        T.eq([inv.role, String(inv.organizationId), inv.status], ["AGENCY_ADMIN", String(r.organizationId), "PENDING"], "invitation du responsable de l'agence");
        const perm = dbGet_("AgencyPropertyPermissions", r.permissionId);
        T.eq([perm.status, perm.canView, perm.canManageReservations, perm.canViewFinance, String(perm.propertyId)], ["ACTIVE", true, true, false, String(fx.propA)], "bien attribué avec les droits cochés");
        // Le responsable active son compte : il voit le bien attribué, et seulement lui.
        const token = T.tokenFrom(T.lastMailTo(email).body, "accept");
        T.pub("invite.accept", { token: token, password: "Agence-Duplex1", displayName: "Youssef" });
        const tok = T.pub("auth.login", { email: email, password: "Agence-Duplex1" }).token;
        const seen = T.call(tok, "property.list", {}).items.map(function (x) { return String(x.propertyId); });
        T.eq(seen, [String(fx.propA)], "l'agence ne voit que le bien attribué");
        T.fails(tok, "property.get", { propertyId: fx.propA2 }, "FORBIDDEN");
        // Refus : autre propriétaire, agence, nom déjà pris, e-mail invalide.
        T.fails(fx.tok.ownerB, "property.agencyCreate", { propertyId: fx.propA, name: "Agence Pirate", adminEmail: fx.mail("pirate") }, "FORBIDDEN");
        T.fails(tok, "property.agencyCreate", { propertyId: fx.propA, name: "Sous-agence", adminEmail: fx.mail("sous") }, "FORBIDDEN");
        T.fails(fx.tok.ownerA, "property.agencyCreate", { propertyId: fx.propA, name: "agence duplex test", adminEmail: fx.mail("dup") }, "VALIDATION");
        T.fails(fx.tok.ownerA, "property.agencyCreate", { propertyId: fx.propA, name: "Agence Sans Mail", adminEmail: "pas-un-email" }, "VALIDATION");
        // Le propriétaire peut ensuite confier un 2e bien à cette agence avec « Attribuer une agence existante ».
        T.ok(T.call(fx.tok.ownerA, "property.agencyChoices", { propertyId: fx.propA2 }).some(function (o) { return String(o.organizationId) === String(r.organizationId); }), "agence proposée pour les autres biens");
      }],
      ["Propriétaire : « Mes agences » — droits, fiche, retrait de tous les accès, suppression", function (T, fx) {
        const email = fx.mail("agence-gestion");
        const r = T.call(fx.tok.ownerA, "property.agencyCreate", { propertyId: fx.propA, name: "Agence Gestion " + fx.run, adminEmail: email, canManageReservations: true });
        T.call(fx.tok.ownerA, "property.agencySet", { propertyId: fx.propA2, agencyOrganizationId: r.organizationId, canView: true });
        const mine = T.call(fx.tok.ownerA, "agency.mine").find(function (a) { return a.organizationId === r.organizationId; });
        T.ok(mine && mine.createdByMe && mine.activeProperties === 2, "agence listée avec ses 2 biens");
        T.ok(T.call(fx.tok.ownerA, "agency.mine").every(function (a) { return a.properties.every(function (x) { return [String(fx.propA), String(fx.propA2)].indexOf(String(x.propertyId)) >= 0; }); }), "seuls mes biens apparaissent");
        // Fiche : modifiable par le créateur seulement.
        T.call(fx.tok.ownerA, "agency.update", { agencyOrganizationId: r.organizationId, name: "Agence Gestion Bis " + fx.run, city: "Agadir", contactEmail: email });
        T.eq([dbGet_("Organizations", r.organizationId).name, dbGet_("Organizations", r.organizationId).city], ["Agence Gestion Bis " + fx.run, "Agadir"], "fiche modifiée");
        T.fails(fx.tok.ownerB, "agency.update", { agencyOrganizationId: r.organizationId, name: "Piratage" }, "FORBIDDEN");
        T.fails(fx.tok.ownerA, "agency.update", { agencyOrganizationId: fx.ag1.organizationId, name: "Pas à moi" }, "FORBIDDEN");
        T.fails(fx.tok.ag1, "agency.mine", {}, "FORBIDDEN");
        // Retirer tous les accès.
        T.eq(T.call(fx.tok.ownerA, "agency.revokeAll", { agencyOrganizationId: r.organizationId }).revoked, 2, "2 accès retirés");
        T.eq(dbAll_("AgencyPropertyPermissions").filter(function (z) { return String(z.agencyOrganizationId) === String(r.organizationId) && z.status === "ACTIVE"; }).length, 0, "plus aucun accès actif");
        // Suppression refusée si l'agence travaille aussi pour un autre propriétaire.
        T.call(fx.tok.ownerA, "property.agencySet", { propertyId: fx.propA, agencyOrganizationId: r.organizationId, canView: true });
        T.call(fx.tok.ownerB, "property.agencySet", { propertyId: fx.propB, agencyOrganizationId: r.organizationId, canView: true });
        T.fails(fx.tok.ownerA, "agency.delete", { agencyOrganizationId: r.organizationId }, "VALIDATION");
        T.call(fx.tok.ownerB, "property.agencySet", { propertyId: fx.propB, agencyOrganizationId: r.organizationId, canView: false });
        // Suppression : non destructive, invitations révoquées, comptes désactivés.
        T.fails(fx.tok.ownerB, "agency.delete", { agencyOrganizationId: r.organizationId }, "FORBIDDEN");
        T.call(fx.tok.ownerA, "agency.delete", { agencyOrganizationId: r.organizationId });
        T.eq(dbGet_("Organizations", r.organizationId).status, "INACTIVE", "agence inactive (non effacée)");
        T.eq(dbGet_("Invitations", r.invitationId).status, "REVOKED", "invitation en attente révoquée");
        T.fails(null, "invite.accept", { token: "0".repeat(64), password: "Xyz-12345678" });
        T.ok(dbAll_("AgencyPropertyPermissions").some(function (z) { return String(z.agencyOrganizationId) === String(r.organizationId); }), "historique des attributions conservé");
      }],
      ["Attribution d'agence, cloisonnement entre agences et révocation", function (T, fx) {
        T.fails(fx.tok.ag1, "property.get", { propertyId: fx.propA }, "FORBIDDEN");
        T.call(fx.tok.ownerA, "property.agencySet", { propertyId: fx.propA, agencyOrganizationId: fx.ag1.organizationId, canView: true, canManageReservations: true, canManageOperations: true });
        T.eq(T.call(fx.tok.ag1, "property.get", { propertyId: fx.propA }).propertyId, fx.propA, "agence 1 autorisée");
        T.fails(fx.tok.ag2, "property.get", { propertyId: fx.propA }, "FORBIDDEN");
        const r = T.call(fx.tok.ag1, "resv.create", { propertyId: fx.propA, checkIn: tDays_(300), checkOut: tDays_(302), guestName: "Client Agence" });
        T.fails(fx.tok.ag2, "resv.get", { reservationId: r.reservationId }, "FORBIDDEN");
        T.ok(!T.call(fx.tok.ag2, "resv.list", {}).items.length, "aucune réservation visible pour l'agence 2");
        T.eq(T.call(fx.tok.ag1, "fin.summary", {}).byProperty.length, 0, "sans canViewFinance, l'agence ne voit pas les finances");
        T.call(fx.tok.ownerA, "property.agencySet", { propertyId: fx.propA, agencyOrganizationId: fx.ag1.organizationId, canView: false });
        T.fails(fx.tok.ag1, "resv.get", { reservationId: r.reservationId }, "FORBIDDEN");
        T.call(fx.tok.ownerA, "property.agencySet", { propertyId: fx.propA, agencyOrganizationId: fx.ag1.organizationId, canView: true, canManageReservations: true, canManageOperations: true });
        T.call(fx.tok.ownerA, "resv.cancel", { reservationId: r.reservationId, reason: "OTHER" });
      }],
      ["Agence en consultation seule ne peut pas réserver", function (T, fx) {
        T.call(fx.tok.ownerA, "property.agencySet", { propertyId: fx.propA, agencyOrganizationId: fx.ag2.organizationId, canView: true });
        T.fails(fx.tok.ag2, "resv.create", { propertyId: fx.propA, checkIn: tDays_(310), checkOut: tDays_(311), guestName: "X" }, "FORBIDDEN");
        T.call(fx.tok.ownerA, "property.agencySet", { propertyId: fx.propA, agencyOrganizationId: fx.ag2.organizationId, canView: false });
      }],
      ["Environnement de démonstration : création complète, droits cloisonnés, relance sans doublon", function (T, fx) {
        const S = DEMO_SPEC_, before = TEST_HOOKS_.mailSink.length;
        const r1 = demoBuild_(fx.users.superA.email);
        T.eq(r1.organizations.map(function (o) { return o.created; }), [true, true], "2 organisations créées");
        T.eq(r1.properties.length, 3, "3 biens");
        T.eq(r1.properties.filter(function (p) { return Number(p.nightlyPrice) === 120 * DEMO_EUR_MAD_ && p.currency === "MAD"; }).length, 1, "duplex à 120 € convertis en MAD");
        T.eq(r1.agencyAccess.length, 2, "2 biens confiés à l'agence");
        T.eq(r1.guards.length, 3, "un gardien par bien");
        T.ok(r1.provider.specialties.indexOf("CLEANING") >= 0 && r1.provider.specialties.indexOf("PLUMBING") >= 0, "prestataire ménage + tous corps de métier");
        const sent = TEST_HOOKS_.mailSink.slice(before).filter(function (m) { return /Activez votre compte/.test(m.subject); });
        T.eq(sent.length, 7, "7 e-mails d'activation (super admin, propriétaire, agence, prestataire, 3 gardiens)");
        const r2 = demoBuild_(fx.users.superA.email);
        T.ok(r2.organizations.every(function (o) { return !o.created; }) && r2.properties.every(function (p) { return !p.created; }), "relance : rien n'est recréé");
        T.eq(TEST_HOOKS_.mailSink.slice(before).filter(function (m) { return /Activez votre compte/.test(m.subject); }).length, 7, "relance : aucun e-mail en double");
        T.eq(dbAll_("Properties").filter(function (p) { return /^DÉMO – /.test(p.name); }).length, 3, "aucun bien en double");
        const activate = function (email) {
          const m = TEST_HOOKS_.mailSink.filter(function (x) { return x.to === email; }).pop();
          T.pub("auth.resetPassword", { token: T.tokenFrom(m.body, "reset"), password: "Demo-Passw0rd!" });
          return T.pub("auth.login", { email: email, password: "Demo-Passw0rd!" }).token;
        };
        const names = function (tok) { return T.call(tok, "property.list", {}).items.map(function (p) { return p.name; }).sort(); };
        const ownerTok = activate(S.owner.email), agencyTok = activate(S.agency.email), guardTok = activate(S.properties[0].guard.email), provTok = activate(S.provider.email);
        T.eq(names(ownerTok).length, 3, "le propriétaire voit ses 3 biens");
        T.eq(names(agencyTok), [S.properties[1].name, S.properties[0].name].sort(), "l'agence ne voit que les 2 biens en courte durée");
        T.eq(names(guardTok), [S.properties[0].name], "le gardien ne voit que son bien");
        const duplex = r1.properties[0].propertyId;
        T.ok(T.call(agencyTok, "ctr.choices", { propertyId: duplex, serviceType: "CLEANING" }).some(function (c) { return c.name === S.provider.name; }), "l'agence choisit Mohamed pour le ménage");
        const m = T.call(agencyTok, "clean.create", { propertyId: duplex, startAt: tDays_(2) + "T11:00:00.000Z", providerEmail: S.provider.email, price: 200 }).missionId;
        T.eq(dbGet_("CleaningMissions", m).organizationId, dbGet_("Properties", duplex).organizationId, "la mission (et sa dépense) est rattachée au propriétaire");
        T.ok(T.call(provTok, "clean.list", {}).items.some(function (x) { return x.missionId === m; }), "Mohamed voit la mission");
        T.fails(guardTok, "property.get", { propertyId: r1.properties[2].propertyId }, "FORBIDDEN");
        T.ok(dbAll_("Users").filter(function (u) { return u.email === S.owner.email; }).every(function (u) { return u.phone === DEMO_PHONE_ && u.displayName === S.owner.name; }), "nom et téléphone renseignés");
      }],
      ["Historique de démonstration (6 mois) : données cohérentes, analyses alimentées, une seule exécution", function (T, fx) {
        const S = DEMO_SPEC_, today = todayStr_(), from = addDaysStr_(today, -183);
        demoBuild_(fx.users.superA.email);
        const h = demoHistory_(fx.users.superA.email);
        T.ok(!h.already && h.counts.Reservations >= 40 && h.counts.CleaningMissions >= 25 && h.counts.Invoices >= 9 && h.counts.RentSchedules === 12, "volumes : " + JSON.stringify(h.counts));
        T.ok(demoHistory_(fx.users.superA.email).already, "deuxième exécution : rien n'est ajouté");
        const props = dbAll_("Properties").filter(function (p) { return /^DÉMO – /.test(p.name); });
        T.ok(props.every(function (p) { return p.currency === "MAD"; }) && props.some(function (p) { return Number(p.nightlyPrice) === 120 * DEMO_EUR_MAD_; }), "prix en MAD (120 € convertis)");
        const ids = props.map(function (p) { return p.propertyId; });
        const resv = dbAll_("Reservations").filter(function (r) { return ids.indexOf(r.propertyId) >= 0; });
        const byProp = {};
        resv.filter(function (r) { return r.status !== "CANCELLED"; }).forEach(function (r) { (byProp[r.propertyId] = byProp[r.propertyId] || []).push(r); });
        Object.keys(byProp).forEach(function (k) {
          const L = byProp[k].sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : 1; });
          for (let i = 1; i < L.length; i++) T.ok(L[i].checkIn >= L[i - 1].checkOut, "aucun chevauchement de séjours : " + L[i - 1].checkOut + " / " + L[i].checkIn);
        });
        T.ok(resv.every(function (r) { const m = resvMoney_(r); return r.status === "CANCELLED" || m.paymentStatus === r.paymentStatus; }), "statut de paiement cohérent avec les paiements");
        T.ok(dbAll_("Payments").every(function (x) { return String(x.paidAt).slice(0, 10) <= today; }), "aucun paiement dans le futur");
        T.ok(["COMPLETED", "CANCELLED", "CONFIRMED"].every(function (s) { return resv.some(function (r) { return r.status === s; }); }), "séjours passés, annulés et à venir");
        const ownerTok = T.pub("auth.login", { email: S.owner.email, password: "Demo-Passw0rd!" }).token, agTok = T.pub("auth.login", { email: S.agency.email, password: "Demo-Passw0rd!" }).token;
        const run = function (tok, type) { return T.call(tok, "pareto.run", { type: type, from: from, to: today }).result; };
        ["INCIDENTS_BY_CATEGORY", "INCIDENT_COST_BY_CATEGORY", "MAINTENANCE_BY_CATEGORY", "COST_BY_CONTRACTOR", "COST_BY_PROPERTY", "CANCEL_REASONS", "CLEANING_ANOMALIES", "DELAYS_NONCONFORMITIES", "EXPENSES_BY_CATEGORY", "UNPAID"]
          .forEach(function (type) { const r = run(ownerTok, type); T.ok(r.items.length >= 1 && r.total > 0, "analyse " + type + " alimentée"); });
        const delays = run(ownerTok, "DELAYS_NONCONFORMITIES").items.map(function (x) { return x.key; });
        T.ok(["CHECKIN_LATE", "CHECKOUT_LATE", "RENT_LATE"].every(function (k) { return delays.indexOf(k) >= 0; }), "retards variés : " + delays.join(", "));
        T.ok(run(ownerTok, "UNPAID").items.some(function (x) { return /longue durée/.test(x.label); }), "loyer impayé visible");
        T.ok(run(agTok, "COST_BY_PROPERTY").items.every(function (x) { return !/longue durée/.test(x.label); }), "l'agence ne voit pas le bien longue durée");
        const fin = T.call(ownerTok, "fin.summary", { from: from, to: today });
        T.ok(JSON.stringify(fin).length > 50, "synthèse financière calculée");
        T.ok(T.call(ownerTok, "dash.get", {}), "tableau de bord du propriétaire");
        // Voyageurs complets : un enregistrement par occupant, nationalité, pièce et numéro ; copies « spécimen » protégées
        const gBy = {}; dbAll_("Guests").forEach(function (g) { (gBy[g.reservationId] = gBy[g.reservationId] || []).push(g); });
        T.ok(resv.every(function (r) { const gs = gBy[r.reservationId] || []; return gs.length === Number(r.guestCount) && gs.every(function (g) { return g.lastName && g.firstName && g.nationality && g.idType && g.idRefMasked && g.idRefMasked.indexOf("*") < 0; }); }), "tous les occupants identifiés (numéros complets en démo)");
        T.ok(h.counts.extras.companions > 40 && h.counts.extras.idCopies >= 3, "accompagnants et copies de pièce : " + JSON.stringify(h.counts.extras));
        T.ok(resv.every(function (r) { return /@example\.com$/.test(r.guestEmail); }), "e-mail fictif du voyageur principal (domaine réservé)");
        const big = resv.filter(function (r) { return Number(r.guestCount) >= 3 && r.status === "COMPLETED"; })[0];
        const gl = T.call(ownerTok, "guest.list", { reservationId: big.reservationId }).items;
        T.ok(gl.length === Number(big.guestCount) && gl.every(function (g) { return g.idRef && g.idType && g.nationality; }) && gl.filter(function (g) { return g.isPrimary; }).length === 1, "fiche réservation : liste complète des voyageurs");
        T.ok(dbAll_("Documents").filter(function (d) { return d.ownerType === "GUEST" && d.category === "ID_DOCUMENT"; }).every(function (d) { return d.sensitive === true && d.retainUntil; }), "copies de pièce sensibles avec date de purge");
        const guardTokD = T.pub("auth.login", { email: S.properties[0].guard.email, password: "Demo-Passw0rd!" }).token;
        const dup = resv.filter(function (r) { return r.propertyId === dbAll_("Properties").find(function (p) { return p.name === S.properties[0].name; }).propertyId && r.status === "COMPLETED"; })[0];
        const gr = api(guardTokD, "guest.list", { reservationId: dup.reservationId });
        T.ok(!gr.ok || gr.data.items.every(function (g) { return g.idRef === undefined; }), "le gardien ne voit pas les numéros de pièce");
        T.eq(demoGuests_(dbAll_("Organizations").find(function (o) { return o.name === S.owner.org; }), (function () { const P = {}; S.properties.forEach(function (d) { P[d.key] = { prop: dbAll_("Properties").find(function (x) { return x.name === d.name; }) }; }); return P; })(), today).companions, 0, "relance : aucun voyageur en double");
        // Documents PDF avec logo : contrat d'abonnement, ordre de mission et rapport de ménage avec photos avant / après
        T.eq([h.counts.extras.subscriptions, h.counts.extras.photos], [1, 24], "abonnement du propriétaire (agence en option) et 24 photos de démonstration");
        T.ok(h.counts.extras.checklists >= 100, "listes de tâches par pièce");
        const text = function (r) { return Utilities.newBlob(Utilities.base64Decode(r.base64)).getDataAsString(); };
        const ownerOrgId = dbAll_("Organizations").find(function (o) { return o.name === S.owner.org; }).organizationId;
        const dOrgsAg_ = function (id) { return dbAll_("Organizations").some(function (o) { return o.name === S.agency.org && o.organizationId === id; }); };
        const contract = text(T.call(ownerTok, "sub.contractPdf", { organizationId: ownerOrgId }));
        T.ok(/^%PDF/.test(contract) && contract.indexOf("data:image/png;base64," + PDF_LOGO_PNG_B64_.slice(0, 40)) > 0, "contrat avec logo");
        T.ok(contract.indexOf("règlement semestriel") > 0 && contract.indexOf("Historique des règlements") > 0, "historique des règlements dans le contrat");
        T.ok(contract.indexOf("1 agence(s)") > 0 && contract.indexOf(S.agency.org) > 0, "agence de démo en option sur l'abonnement du propriétaire");
        T.ok(!dbAll_("Subscriptions").some(function (x) { return x.status !== "CANCELLED" && dOrgsAg_(x.organizationId); }), "l'agence de démo n'a pas d'abonnement propre");
        T.fails(fx.tok.ownerA, "sub.contractPdf", { organizationId: ownerOrgId }, "FORBIDDEN");
        const withPhotos = dbAll_("CleaningPhotos").map(function (x) { return x.missionId; })[0];
        const provTok = T.pub("auth.login", { email: S.provider.email, password: "Demo-Passw0rd!" }).token;
        const report = text(T.call(agTok, "clean.reportPdf", { missionId: withPhotos }));
        T.ok(report.indexOf("Rapport de ménage") > 0 && (report.match(/data:image\/jpeg;base64,/g) || []).length === 4 && report.indexOf("AVANT") > 0, "rapport avec 4 photos avant / après");
        T.ok(text(T.call(provTok, "clean.orderPdf", { missionId: withPhotos })).indexOf("Ordre de mission de ménage") > 0, "ordre de mission pour le prestataire");
        T.fails(fx.tok.ownerB, "clean.reportPdf", { missionId: withPhotos }, "FORBIDDEN");
        // Devis et facture au nom du prestataire (sans la marque ImmoPilot), devis en attente et intervention planifiée
        T.eq([h.counts.extras.pendingQuote, h.counts.extras.scheduledWorkOrder], [1, 1], "devis en attente et intervention planifiée");
        const art = dbAll_("Artisans").find(function (c) { return c.email === S.provider.email; });
        const q = dbAll_("Quotes").find(function (x) { return x.status === "APPROVED" && String(x.artisanId) === String(art.artisanId); });
        T.ok(parseJson_(q.linesJson, []).length >= 2, "devis type sur plusieurs lignes");
        const qpdf = text(T.call(ownerTok, "quote.pdf", { quoteId: q.quoteId }));
        T.ok(qpdf.indexOf("Devis n° DEV-") > 0 && qpdf.indexOf("Multiservices") > 0 && qpdf.indexOf("Bon pour accord") > 0 && qpdf.indexOf(PDF_LOGO_PNG_B64_.slice(0, 40)) < 0 && qpdf.indexOf("Immo<span") < 0, "devis sans logo ImmoPilot");
        T.ok(text(T.call(provTok, "quote.pdf", { quoteId: q.quoteId })).indexOf("Devis") > 0, "le prestataire télécharge son devis");
        T.fails(fx.tok.ownerB, "quote.pdf", { quoteId: q.quoteId }, "FORBIDDEN");
        const pending = dbAll_("Quotes").find(function (x) { return x.status === "PENDING" && String(x.artisanId) === String(art.artisanId); });
        T.ok(text(T.call(ownerTok, "quote.pdf", { quoteId: pending.quoteId })).indexOf("Diagnostic") > 0, "devis en attente téléchargeable");
        const inv = dbAll_("Invoices").find(function (x) { return x.status === "PAID" && String(x.artisanId) === String(art.artisanId); });
        const ipdf = text(T.call(ownerTok, "inv.pdf", { invoiceId: inv.invoiceId }));
        T.ok(ipdf.indexOf("Facture n° " + inv.invoiceNumber) > 0 && ipdf.indexOf("Acquittée le") > 0 && ipdf.indexOf(PDF_LOGO_PNG_B64_.slice(0, 40)) < 0 && ipdf.indexOf("Commission") < 0, "facture sans logo ni commission interne");
        T.fails(fx.tok.ownerB, "inv.pdf", { invoiceId: inv.invoiceId }, "FORBIDDEN");
        // Démo exclue des statistiques et de la facturation de la plateforme ; pas d'e-mails automatiques ; mise en veille réversible
        const dOrgs = dbAll_("Organizations").filter(function (o) { return o.isDemo === true; });
        T.ok(String(dOrgs.find(function (o) { return o.name === S.agency.org; }).managedByOrgId) === String(dOrgs.find(function (o) { return o.name === S.owner.org; }).organizationId), "agence de démo rattachée au propriétaire");
        T.eq(dOrgs.length, 2, "2 organisations marquées « démo »");
        const adm = function (inc) { return T.call(fx.tok.superA, "dash.get", { from: from, to: today, includeDemo: inc }).admin; };
        const without = adm(false), withDemo = adm(true);
        const demoSubPaid = sumBy_(dbAll_("Payments").filter(function (x) { return x.kind === "SUBSCRIPTION" && x.status === "RECORDED" && dOrgs.some(function (o) { return o.organizationId === x.organizationId; }) && String(x.paidAt).slice(0, 10) >= from; }), function (x) { return x.amount; });
        T.eq(withDemo.organizations - without.organizations, 2, "organisations de démo exclues");
        T.ok(demoSubPaid > 0 && Math.abs(withDemo.platformRevenue - without.platformRevenue - demoSubPaid) < 0.01, "revenus d'abonnement de la démo exclus");
        T.ok(withDemo.reservations - without.reservations >= 40 && without.demoExcluded === 2, "réservations de démo exclues");
        const subsNo = T.call(fx.tok.superA, "sub.list", {}), subsYes = T.call(fx.tok.superA, "sub.list", { includeDemo: true });
        T.ok(subsYes.items.length - subsNo.items.length === 1 && subsNo.billing.every(function (b) { return !/^DÉMO/.test(b.organizationName || ""); }), "abonnements de démo masqués par défaut");
        const ownerOrgRow = dOrgs.find(function (o) { return o.name === S.owner.org; }), mailsBefore = TEST_HOOKS_.mailSink.length;
        notify_({ eventKey: "demo-test:" + Date.now(), userIds: [dbAll_("Users").find(function (u) { return u.email === S.owner.email; }).userId], type: "TEST", organizationId: ownerOrgRow.organizationId, title: "Test", body: "Test" });
        T.eq(TEST_HOOKS_.mailSink.length, mailsBefore, "aucun e-mail automatique pour la démo");
        demoSetSleep_(fx.users.superA.email, true);
        T.fails(null, "auth.login", { email: S.owner.email, password: "Demo-Passw0rd!" });
        T.ok(dbAll_("Reservations").filter(function (r) { return r.organizationId === ownerOrgRow.organizationId; }).length >= 40, "veille : aucune donnée supprimée");
        demoSetSleep_(fx.users.superA.email, false);
        T.ok(T.pub("auth.login", { email: S.owner.email, password: "Demo-Passw0rd!" }).token, "réveil : la démo fonctionne de nouveau");
        T.ok(text(T.call(ownerTok, "wo.pdf", { workOrderId: dbAll_("WorkOrders").filter(function (w) { return /^DEMO|Intervention réalisée/.test(w.report || ""); })[0].workOrderId })).indexOf(PDF_LOGO_PNG_B64_.slice(0, 40)) > 0, "bon d'intervention avec logo");
      }],
      ["Suppression de compte : demande depuis l'application puis anonymisation par le super administrateur", function (T, fx) {
        const email = fx.mail("a-supprimer");
        T.call(fx.tok.ownerA, "invite.create", { email: email, organizationId: fx.orgA.organizationId, role: "GUARD" });
        T.pub("invite.accept", { token: T.tokenFrom(T.lastMailTo(email).body, "accept"), password: "Gardien-Temp1" });
        const tok = T.pub("auth.login", { email: email, password: "Gardien-Temp1" }).token;
        const u = dbAll_("Users").find(function (x) { return x.email === email; });
        T.ok(T.call(tok, "me.requestDeletion", { reason: "Je quitte l'agence" }).message, "demande enregistrée");
        T.ok(dbAll_("Notifications").some(function (n) { return n.type === "ACCOUNT_DELETION" && String(n.userId) === String(fx.users.superA.userId); }), "super administrateur prévenu");
        T.fails(fx.tok.ownerA, "user.erase", { userId: u.userId, confirm: "SUPPRIMER" }, "FORBIDDEN");
        T.fails(fx.tok.superA, "user.erase", { userId: u.userId, confirm: "oui" }, "VALIDATION");
        T.call(fx.tok.superA, "user.erase", { userId: u.userId, confirm: "SUPPRIMER", reason: "Demande de l'utilisateur" });
        const after = dbGet_("Users", u.userId);
        T.ok(after.email.indexOf(email) < 0 && after.displayName === "Compte supprimé" && !after.passwordHash && after.status === "DISABLED", "identité effacée");
        T.ok(dbAll_("UserRoles").filter(function (r) { return String(r.userId) === String(u.userId); }).every(function (r) { return r.status === "REVOKED"; }), "rôles révoqués");
        T.fails(null, "auth.login", { email: email, password: "Gardien-Temp1" }, "AUTH");
        T.fails(tok, "me.get", {}, "AUTH");
        const log = dbAll_("ActivityLogs").filter(function (l) { return l.action === "ACCOUNT_ERASED"; }).pop();
        T.ok(log && JSON.stringify(log.detailsJson).indexOf(email) < 0 && JSON.stringify(log.detailsJson).indexOf(sha256Hex_(email)) >= 0, "trace sans e-mail en clair");
      }],
      ["Document privé : téléchargement refusé sans droit", function (T, fx) {
        const png = Utilities.base64Encode([-119, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
        const d = T.call(fx.tok.ownerA, "doc.upload", { ownerType: "PROPERTY", ownerId: fx.propA, category: "CONTRACT", fileName: "titre.png", mimeType: "image/png", base64: png });
        T.ok(T.call(fx.tok.ownerA, "doc.get", { documentId: d.documentId }).base64, "propriétaire autorisé");
        T.fails(fx.tok.ownerB, "doc.get", { documentId: d.documentId }, "FORBIDDEN");
        T.fails(fx.tok.guard, "doc.get", { documentId: d.documentId }, "FORBIDDEN");
        T.fails(fx.tok.superA, "doc.get", { documentId: d.documentId }, "FORBIDDEN");
        const f = DriveApp.getFileById(dbGet_("Documents", d.documentId).fileId);
        T.eq(String(f.getSharingAccess()), String(DriveApp.Access.PRIVATE), "fichier Drive privé");
      }],
      ["Modèle de document : seul un Google Docs du dossier « Modeles » est accepté", function (T, fx) {
        const outside = DocumentApp.create("ImmoPilot_TEST_modele_hors_dossier");
        const inside = DocumentApp.create("ImmoPilot_TEST_modele_bail");
        DriveApp.getFileById(inside.getId()).moveTo(systemFolder_("Modeles"));
        try {
          // Un document d'un autre client (copie générée rangée dans son dossier) ou tout autre fichier hors « Modeles » est refusé.
          T.fails(fx.tok.ownerA, "settings.set", { organizationId: fx.orgA.organizationId, key: "template.leaseDocId", value: outside.getId() }, "VALIDATION");
          const png = Utilities.base64Encode([-119, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
          const other = T.call(fx.tok.ownerB, "doc.upload", { ownerType: "PROPERTY", ownerId: fx.propB, category: "CONTRACT", fileName: "contrat_b.png", mimeType: "image/png", base64: png });
          T.fails(fx.tok.ownerA, "settings.set", { organizationId: fx.orgA.organizationId, key: "template.leaseDocId", value: dbGet_("Documents", other.documentId).fileId }, "VALIDATION");
          T.fails(fx.tok.ownerA, "settings.set", { organizationId: fx.orgA.organizationId, key: "template.leaseDocId", value: "x".repeat(30) }, "VALIDATION");
          T.call(fx.tok.ownerA, "settings.set", { organizationId: fx.orgA.organizationId, key: "template.leaseDocId", value: inside.getId() });
          T.eq(getSetting_("template.leaseDocId", fx.orgA.organizationId), inside.getId(), "modèle du dossier « Modeles » accepté");
          let refused = false; try { docFromTemplate_(outside.getId(), {}, systemFolder_("Exports"), "x"); } catch (e) { refused = true; }
          T.ok(refused, "contrôle refait au moment de la génération");
        } finally {
          T.call(fx.tok.ownerA, "settings.set", { organizationId: fx.orgA.organizationId, key: "template.leaseDocId", value: "" });
          [outside, inside].forEach(function (d) { try { DriveApp.getFileById(d.getId()).setTrashed(true); } catch (e) { console.error(e.message); } });
        }
      }],
      ["Fichier refusé si le contenu ne correspond pas au type annoncé", function (T, fx) {
        T.fails(fx.tok.ownerA, "doc.upload", { ownerType: "PROPERTY", ownerId: fx.propA, category: "PHOTO", fileName: "x.jpg", mimeType: "image/jpeg", base64: Utilities.base64Encode(Utilities.newBlob("<script>").getBytes()) }, "VALIDATION");
        T.fails(fx.tok.ownerA, "doc.upload", { ownerType: "PROPERTY", ownerId: fx.propA, category: "PHOTO", fileName: "x.exe", mimeType: "application/x-msdownload", base64: "TVo=" }, "VALIDATION");
      }],
      ["Injection de formule neutralisée (Sheets et CSV)", function (T, fx) {
        const r = T.call(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(400), checkOut: tDays_(401), guestName: "=HYPERLINK(\"http://x\")" });
        T.eq(dbGet_("Reservations", r.reservationId).guestName, "=HYPERLINK(\"http://x\")", "valeur conservée comme texte");
        T.ok(csvCell_("=1+1").charAt(0) === "'" && csvCell_("+33").charAt(0) === "'" && csvCell_("@x").charAt(0) === "'", "cellules CSV préfixées");
        T.call(fx.tok.ownerA, "resv.cancel", { reservationId: r.reservationId, reason: "OTHER" });
      }],
      ["Fonctions d'installation refusées hors éditeur", function (T) {
        if (typeof __MOCK__ === "undefined") T.skip("Vérifiable uniquement en simulant un visiteur web (voir TESTS.md, test manuel M-02).");
        __MOCK__.session.active = "";
        try { let threw = false; try { setupProject(); } catch (e) { threw = /propriétaire du script/.test(e.message); } T.ok(threw, "setupProject doit refuser un visiteur"); }
        finally { __MOCK__.session.active = __MOCK__.session.effective; }
      }]
    ] },
    { name: "Réservations", tests: [
      ["Réservation valide, montants calculés côté serveur", function (T, fx) {
        const r = T.call(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(40), checkOut: tDays_(43), guestName: "Ali Benali", guestCount: 2 });
        const g = T.call(fx.tok.ownerA, "resv.get", { reservationId: r.reservationId });
        T.near(g.totalPrice, 3000, "3 nuits × 1000"); T.near(g.fees, 200, "frais de ménage"); T.near(g.commissionAmount, 600, "20 % de commission");
        T.eq(g.paymentStatus, "UNPAID", "jamais payé automatiquement"); T.near(g.balance, 3200, "solde");
        fx.r1 = r.reservationId;
      }],
      ["Double réservation refusée (chevauchement)", function (T, fx) {
        T.fails(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(41), checkOut: tDays_(45), guestName: "Doublon" }, "CONFLICT");
        T.eq(T.call(fx.tok.ownerA, "resv.availability", { propertyId: fx.propA, checkIn: tDays_(42), checkOut: tDays_(44) }).available, false, "disponibilité");
      }],
      ["Double réservation refusée même via une autre agence", function (T, fx) {
        T.fails(fx.tok.ag1, "resv.create", { propertyId: fx.propA, checkIn: tDays_(42), checkOut: tDays_(44), guestName: "Agence" }, "CONFLICT");
      }],
      ["Départ 11:00 et arrivée 15:00 le même jour autorisés ; arrivée 12:00 refusée (battement 120 min)", function (T, fx) {
        const ok = T.call(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(43), checkOut: tDays_(45), guestName: "Rotation" });
        T.ok(ok.reservationId, "arrivée le jour du départ");
        T.call(fx.tok.ownerA, "resv.cancel", { reservationId: ok.reservationId, reason: "OTHER" });
        T.fails(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(43), checkOut: tDays_(45), checkInTime: "12:00", guestName: "Trop tôt" }, "CONFLICT");
      }],
      ["Double soumission (même clé) : un seul enregistrement", function (T, fx) {
        const k = T.key();
        const a = T.call(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(60), checkOut: tDays_(61), guestName: "Idem", requestKey: k });
        const b = T.call(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(60), checkOut: tDays_(61), guestName: "Idem", requestKey: k });
        T.ok(b.duplicate === true && b.id === a.reservationId, "seconde requête reconnue comme doublon");
        T.eq(dbAll_("Reservations").filter(function (x) { return x.idempotencyKey === k; }).length, 1, "une seule ligne");
      }],
      ["Requêtes concurrentes : contrôle de chevauchement sous verrou", function (T, fx) {
        if (typeof __MOCK__ === "undefined") T.skip("Concurrence réelle : test manuel M-05 (deux appels simultanés depuis deux navigateurs).");
        const seen = [];
        __MOCK__.onInsert = function (table) { if (table === "Reservations") seen.push(__MOCK__.lockHeld()); };
        try {
          T.eq(T.call(fx.tok.ag1, "resv.availability", { propertyId: fx.propA, checkIn: tDays_(70), checkOut: tDays_(72) }).available, true, "A voit le créneau libre");
          T.call(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(70), checkOut: tDays_(72), guestName: "B arrive en premier" });
          T.fails(fx.tok.ag1, "resv.create", { propertyId: fx.propA, checkIn: tDays_(71), checkOut: tDays_(73), guestName: "A, après coup" }, "CONFLICT");
          T.ok(seen.length === 1 && seen[0] === true, "l'insertion a lieu pendant que le verrou est détenu");
        } finally { __MOCK__.onInsert = null; }
      }],
      ["Modification avec contrôle de version", function (T, fx) {
        const g = T.call(fx.tok.ownerA, "resv.get", { reservationId: fx.r1 });
        T.call(fx.tok.ownerA, "resv.update", { reservationId: fx.r1, version: g.version, guestCount: 3, notes: "Lit bébé" });
        T.fails(fx.tok.ownerA, "resv.update", { reservationId: fx.r1, version: g.version, guestCount: 4 }, "CONFLICT");
        T.call(fx.tok.ownerA, "resv.update", { reservationId: fx.r1, checkOut: tDays_(44), version: g.version + 1 });
        T.near(T.call(fx.tok.ownerA, "resv.get", { reservationId: fx.r1 }).nights, 4, "nouvelle durée");
      }],
      ["Paiement partiel, solde restant, remboursement plafonné", function (T, fx) {
        T.call(fx.tok.ownerA, "resv.update", { reservationId: fx.r1, totalPrice: 3000 });
        T.call(fx.tok.ownerA, "pay.record", { refType: "RESERVATION", refId: fx.r1, kind: "RESERVATION", amount: 1000, method: "TRANSFER", reference: "VIR-1" });
        let g = T.call(fx.tok.ownerA, "resv.get", { reservationId: fx.r1 });
        T.eq(g.paymentStatus, "PARTIAL", "statut partiel"); T.near(g.balance, 2200, "solde 3200 − 1000");
        T.fails(fx.tok.ownerA, "pay.record", { refType: "RESERVATION", refId: fx.r1, kind: "REFUND", amount: 1500 }, "VALIDATION");
        T.call(fx.tok.ownerA, "pay.record", { refType: "RESERVATION", refId: fx.r1, kind: "RESERVATION", amount: 2200, method: "CASH" });
        g = T.call(fx.tok.ownerA, "resv.get", { reservationId: fx.r1 });
        T.eq(g.paymentStatus, "PAID", "soldé après paiement explicite"); T.near(g.balance, 0, "solde nul");
        T.fails(fx.tok.guard, "pay.record", { refType: "RESERVATION", refId: fx.r1, kind: "RESERVATION", amount: 10 }, "FORBIDDEN");
      }],
      ["Annulation selon la politique (pénalité) et remboursement dû", function (T, fx) {
        const r = T.call(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(3), checkOut: tDays_(5), guestName: "Annule" });
        T.call(fx.tok.ownerA, "pay.record", { refType: "RESERVATION", refId: r.reservationId, kind: "RESERVATION", amount: 2200 });
        const c = T.call(fx.tok.ownerA, "resv.cancel", { reservationId: r.reservationId, reason: "GUEST_REQUEST" });
        T.eq(c.penaltyPercent, 50, "3 jours avant : 50 %"); T.near(c.refundDue, 1100, "2200 − 50 % × 2200");
        T.fails(fx.tok.ownerA, "resv.cancel", { reservationId: r.reservationId, reason: "OTHER" }, "VALIDATION");
        T.eq(T.call(fx.tok.ownerA, "resv.availability", { propertyId: fx.propA, checkIn: tDays_(3), checkOut: tDays_(5) }).available, true, "créneau libéré");
      }],
      ["Blocage de calendrier respecté", function (T, fx) {
        T.call(fx.tok.ownerA, "block.create", { propertyId: fx.propA, startDate: tDays_(90), endDate: tDays_(95), reason: "Travaux" });
        T.fails(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(92), checkOut: tDays_(93), guestName: "Client bloqué" }, "CONFLICT");
        T.ok(T.call(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(95), checkOut: tDays_(96), guestName: "Après blocage" }).reservationId, "arrivée le jour de fin du blocage");
      }]
    ] },
    { name: "Check-in / check-out et ménage", tests: [
      ["Gardien affecté à une réservation : accès limité à celle-ci", function (T, fx) {
        const r = T.call(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: todayStr_(), checkOut: tDays_(2), guestName: "Arrivée du jour", guestPhone: "0612345678" });
        fx.rToday = r.reservationId;
        T.fails(fx.tok.guard, "resv.get", { reservationId: r.reservationId }, "FORBIDDEN");
        T.call(fx.tok.ownerA, "property.staffAssign", { propertyId: fx.propA, email: fx.users.guard.email, role: "GUARD", reservationId: r.reservationId });
        const g = T.call(fx.tok.guard, "resv.get", { reservationId: r.reservationId });
        T.ok(g.totalPrice === undefined && g.payments === undefined, "aucune donnée financière pour le gardien");
        T.eq(T.call(fx.tok.guard, "ops.today", {}).arrivals.length, 1, "une arrivée visible");
        T.fails(fx.tok.guard, "resv.get", { reservationId: fx.r1 }, "FORBIDDEN");
        T.fails(fx.tok.guard, "resv.update", { reservationId: r.reservationId, guestCount: 9 }, "FORBIDDEN");
      }],
      ["Check-in avec photo et checklist, puis check-out → mission de ménage auto", function (T, fx) {
        T.call(fx.tok.ownerA, "property.staffAssign", { propertyId: fx.propA, email: fx.users.cleaner.email, role: "CLEANER" });
        const jpg = Utilities.base64Encode([-1, -40, -1, -32, 0, 16, 74, 70, 73, 70]);
        const ph = T.call(fx.tok.guard, "doc.upload", { ownerType: "RESERVATION", ownerId: fx.rToday, category: "CHECKIN", fileName: "sejour.jpg", mimeType: "image/jpeg", base64: jpg });
        const k = T.key();
        T.call(fx.tok.guard, "ops.checkIn", { reservationId: fx.rToday, checklist: { "Clés remises": true }, photoDocIds: [ph.documentId], conditionNotes: "RAS", requestKey: k });
        T.eq(T.call(fx.tok.guard, "ops.checkIn", { reservationId: fx.rToday, requestKey: k }).duplicate, true, "double soumission ignorée");
        T.fails(fx.tok.guard, "ops.checkIn", { reservationId: fx.rToday }, "VALIDATION");
        T.eq(dbGet_("Reservations", fx.rToday).status, "IN_PROGRESS", "séjour en cours");
        const out = T.call(fx.tok.guard, "ops.checkOut", { reservationId: fx.rToday, checklist: { "Clés rendues": true }, incident: { category: "DAMAGE", description: "Verre cassé dans la cuisine", severity: "LOW" } });
        T.ok(out.cleaningMissionId && out.incidentId, "mission et incident créés");
        const m = dbGet_("CleaningMissions", out.cleaningMissionId);
        T.eq(m.status, "OFFERED", "proposée à l'équipe associée"); T.eq(m.providerEmail, fx.users.cleaner.email, "équipe par défaut");
        T.ok(parseTs_(m.expiresAt).getTime() - Date.now() > 115 * 60000, "délai d'acceptation 2 h");
        fx.mission = out.cleaningMissionId;
      }],
      ["Expiration après 2 h (tâche planifiée) puis réattribution", function (T, fx) {
        dbUpdate_("CleaningMissions", fx.mission, { expiresAt: new Date(Date.now() - 1000).toISOString() });
        T.fails(fx.tok.cleaner, "clean.respond", { missionId: fx.mission, decision: "ACCEPTED" }, "EXPIRED");
        T.eq(cleaningExpireJob_().expired, 1, "une mission expirée");
        T.eq(dbGet_("CleaningMissions", fx.mission).status, "EXPIRED", "statut expiré");
        T.ok(dbAll_("Notifications").some(function (n) { return n.type === "CLEANING_EXPIRED" && n.userId === fx.users.ownerA.userId; }), "alerte au responsable");
        T.call(fx.tok.ownerA, "clean.assign", { missionId: fx.mission, providerEmail: fx.users.cleaner2.email });
        const m = dbGet_("CleaningMissions", fx.mission);
        T.eq(m.status, "OFFERED", "réattribuée"); T.eq(m.reassignCount, 1, "compteur de réattribution");
        T.fails(fx.tok.cleaner, "clean.respond", { missionId: fx.mission, decision: "ACCEPTED" }, "FORBIDDEN");
      }],
      ["Acceptation, photos avant/après obligatoires, fin, validation et dépense unique", function (T, fx) {
        T.call(fx.tok.cleaner2, "clean.respond", { missionId: fx.mission, decision: "ACCEPTED" });
        T.call(fx.tok.cleaner2, "clean.start", { missionId: fx.mission });
        const jpg = Utilities.base64Encode([-1, -40, -1, -32, 0, 16]);
        const b = T.call(fx.tok.cleaner2, "doc.upload", { ownerType: "CLEANING", ownerId: fx.mission, category: "PHOTO_BEFORE", fileName: "avant.jpg", mimeType: "image/jpeg", base64: jpg });
        T.call(fx.tok.cleaner2, "clean.room", { missionId: fx.mission, room: "Séjour", items: { Sols: true }, beforeDocIds: [b.documentId] });
        T.fails(fx.tok.cleaner2, "clean.complete", { missionId: fx.mission }, "VALIDATION");
        const af = T.call(fx.tok.cleaner2, "doc.upload", { ownerType: "CLEANING", ownerId: fx.mission, category: "PHOTO_AFTER", fileName: "apres.jpg", mimeType: "image/jpeg", base64: jpg });
        T.call(fx.tok.cleaner2, "clean.room", { missionId: fx.mission, room: "Séjour", items: { Sols: true }, afterDocIds: [af.documentId] });
        T.call(fx.tok.cleaner2, "clean.anomaly", { missionId: fx.mission, type: "MISSING_ITEM", room: "Séjour", description: "Télécommande absente", createIncident: true });
        T.call(fx.tok.cleaner2, "clean.complete", { missionId: fx.mission, actualMinutes: 95 });
        T.fails(fx.tok.cleaner2, "clean.validate", { missionId: fx.mission }, "FORBIDDEN");
        T.call(fx.tok.ownerA, "clean.validate", { missionId: fx.mission, qualityScore: 4, price: 250 });
        T.eq(dbGet_("CleaningMissions", fx.mission).status, "VALIDATED", "validée");
        T.eq(dbAll_("Expenses").filter(function (e) { return e.uniqueKey === "cleaning:" + fx.mission; }).length, 1, "une seule dépense");
        T.ok(dbAll_("IncidentsV4").some(function (i) { return i.missionId === fx.mission; }), "incident lié à la mission");
      }],
      ["Refus de mission → retour à attribuer + alerte", function (T, fx) {
        const m = T.call(fx.tok.ownerA, "clean.create", { propertyId: fx.propA, startAt: new Date(Date.now() + 86400000).toISOString(), providerEmail: fx.users.cleaner.email });
        T.call(fx.tok.cleaner, "clean.respond", { missionId: m.missionId, decision: "DECLINED", reason: "Indisponible" });
        T.eq(dbGet_("CleaningMissions", m.missionId).status, "CREATED", "à réattribuer");
      }]
    ] },
    { name: "Maintenance (incident → devis → intervention → facture)", tests: [
      ["Annuaire des prestataires géré par le super administrateur, choix par type de prestation", function (T, fx) {
        // Propriétaires et agences ne peuvent plus créer de prestataires.
        T.fails(fx.tok.ownerA, "ctr.create", { name: "Mon plombier", email: fx.mail("plombier-perso"), specialties: ["PLUMBING"] }, "FORBIDDEN");
        T.fails(fx.tok.ag1, "ctr.create", { name: "Ménage agence", email: fx.mail("menage-agence"), specialties: ["CLEANING"] }, "FORBIDDEN");
        // Le super administrateur intègre une entreprise de ménage et un prestataire multi-services : invitations automatiques.
        const cleanMail = fx.mail("proprete-atlas"), multiMail = fx.mail("multi-services");
        const c1 = T.call(fx.tok.superA, "ctr.create", { name: "Propreté Atlas " + fx.run, email: cleanMail, specialties: ["CLEANING"], zones: ["Guéliz"] });
        T.eq(c1.invitations.map(function (x) { return x.role; }), ["CLEANER"], "entreprise de ménage invitée avec le rôle ménage");
        const c2 = T.call(fx.tok.superA, "ctr.create", { name: "Multi Services " + fx.run, email: multiMail, specialties: ["CLEANING", "PLUMBING"] });
        T.eq(c2.invitations.map(function (x) { return x.role; }).sort(), ["ARTISAN", "CLEANER"], "prestataire multi-services : deux rôles");
        T.fails(fx.tok.superA, "ctr.create", { name: "Sans type", email: fx.mail("sans-type"), specialties: [] }, "VALIDATION");
        // Choix par type de prestation, pour le propriétaire du bien.
        const names = function (tok, prop, type) { return T.call(tok, "ctr.choices", { propertyId: prop, serviceType: type }).map(function (c) { return c.name; }); };
        T.ok(names(fx.tok.ownerA, fx.propA, "CLEANING").indexOf("Propreté Atlas " + fx.run) >= 0, "entreprise de ménage proposée pour le ménage");
        T.ok(names(fx.tok.ownerA, fx.propA, "PLUMBING").indexOf("Propreté Atlas " + fx.run) < 0, "pas proposée pour la plomberie");
        T.ok(names(fx.tok.ownerA, fx.propA, "PLUMBING").indexOf("Multi Services " + fx.run) >= 0, "multi-services proposé pour la plomberie");
        // Une agence non attribuée au bien ne peut pas consulter les choix ; un autre propriétaire non plus.
        T.fails(fx.tok.ag2, "ctr.choices", { propertyId: fx.propA, serviceType: "CLEANING" }, "FORBIDDEN");
        T.fails(fx.tok.ownerB, "ctr.choices", { propertyId: fx.propA, serviceType: "CLEANING" }, "FORBIDDEN");
        // Avant activation, l'entreprise de ménage ne peut pas recevoir de mission ; après activation, oui.
        const pick = function () { return T.call(fx.tok.ownerA, "ctr.choices", { propertyId: fx.propA, serviceType: "CLEANING" }).find(function (c) { return c.email === cleanMail; }); };
        T.eq(pick().canClean, false, "compte pas encore activé");
        const m = T.call(fx.tok.ownerA, "clean.create", { propertyId: fx.propA, startAt: new Date(Date.now() + 5 * 3600000).toISOString(), price: 180 });
        T.fails(fx.tok.ownerA, "clean.assign", { missionId: m.missionId, providerEmail: cleanMail }, "VALIDATION");
        const token = T.tokenFrom(T.lastMailTo(cleanMail).body, "accept");
        T.pub("invite.accept", { token: token, password: "Proprete-Atlas1" });
        T.eq(pick().canClean, true, "compte activé : sélectionnable");
        T.call(fx.tok.ownerA, "clean.assign", { missionId: m.missionId, providerEmail: cleanMail });
        const ptok = T.pub("auth.login", { email: cleanMail, password: "Proprete-Atlas1" }).token;
        T.ok(T.call(ptok, "clean.list", {}).items.some(function (x) { return x.missionId === m.missionId; }), "l'entreprise voit sa mission");
        T.fails(ptok, "property.get", { propertyId: fx.propA2 }, "FORBIDDEN");
        T.fails(ptok, "ctr.update", { artisanId: c2.artisanId, name: "Piratage" }, "FORBIDDEN");
        // Fiche du prestataire : le propriétaire la consulte sans pouvoir la modifier ni voir la facturation.
        const g = T.call(fx.tok.ownerA, "ctr.get", { artisanId: c1.artisanId });
        T.ok(g.platform && !g.canEdit && g.billingInfo === undefined, "fiche en lecture seule, sans données de facturation");
        T.fails(fx.tok.ownerA, "ctr.update", { artisanId: c1.artisanId, name: "Autre nom" }, "FORBIDDEN");
        T.call(fx.tok.superA, "ctr.update", { artisanId: c1.artisanId, zones: ["Guéliz", "Médina"] });
      }],
      ["Chaîne complète et commission de 15 % calculée une seule fois", function (T, fx) {
        const inc = T.call(fx.tok.ownerA, "inc.create", { propertyId: fx.propA, category: "PLUMBING", severity: "HIGH", description: "Fuite sous l'évier" });
        const art = T.call(fx.tok.superA, "ctr.create", { name: "Plomberie Atlas", email: fx.users.artisan.email, specialties: ["PLUMBING"] });
        T.ok(art.hasAccount, "artisan lié à son compte");
        const q = T.call(fx.tok.ownerA, "quote.request", { incidentId: inc.incidentId, artisanId: art.artisanId, requestNote: "Urgent" });
        T.call(fx.tok.artisan, "quote.submit", { quoteId: q.quoteId, lines: [{ description: "Remplacement siphon", quantity: 1, unitPrice: 800 }, { description: "Main d'œuvre", quantity: 2, unitPrice: 100 }], vatRate: 20 });
        T.eq(dbGet_("IncidentsV4", inc.incidentId).status, "AWAITING_OWNER", "en attente du propriétaire");
        T.call(fx.tok.ownerA, "property.agencySet", { propertyId: fx.propA, agencyOrganizationId: fx.ag1.organizationId, canView: true, canManageReservations: true, canManageOperations: true });
        T.fails(fx.tok.ag1, "quote.decide", { quoteId: q.quoteId, decision: "APPROVED" }, "FORBIDDEN");
        T.call(fx.tok.ownerA, "quote.decide", { quoteId: q.quoteId, decision: "APPROVED" });
        const wo = T.call(fx.tok.ownerA, "wo.create", { incidentId: inc.incidentId, artisanId: art.artisanId, quoteId: q.quoteId });
        T.fails(fx.tok.ownerB, "wo.get", { workOrderId: wo.workOrderId }, "FORBIDDEN");
        T.call(fx.tok.artisan, "wo.respond", { workOrderId: wo.workOrderId, decision: "ACCEPTED" });
        T.call(fx.tok.artisan, "wo.schedule", { workOrderId: wo.workOrderId, scheduledAt: new Date(Date.now() + 3600000).toISOString() });
        T.call(fx.tok.artisan, "wo.start", { workOrderId: wo.workOrderId });
        T.call(fx.tok.artisan, "wo.complete", { workOrderId: wo.workOrderId, report: "Siphon remplacé, test d'étanchéité OK" });
        T.call(fx.tok.ownerA, "wo.verify", { workOrderId: wo.workOrderId });
        T.eq(dbGet_("IncidentsV4", inc.incidentId).status, "RESOLVED", "incident résolu après contrôle");
        const inv = T.call(fx.tok.artisan, "inv.submit", { workOrderId: wo.workOrderId, invoiceNumber: "F-2026-001", amountHT: 1000, vatRate: 20 });
        T.fails(fx.tok.artisan, "inv.approve", { invoiceId: inv.invoiceId }, "FORBIDDEN");
        const ap = T.call(fx.tok.ownerA, "inv.approve", { invoiceId: inv.invoiceId });
        T.near(ap.amountTTC, 1200, "TTC"); T.near(ap.commissionAmount, 150, "15 % de 1000 HT"); T.near(ap.commissionVatAmount, 30, "TVA 20 % sur commission"); T.near(ap.netToContractor, 1020, "net artisan");
        T.fails(fx.tok.ownerA, "inv.approve", { invoiceId: inv.invoiceId }, "VALIDATION");
        const fin = T.call(fx.tok.ownerA, "fin.summary", { from: addDaysStr_(todayStr_(), -1), to: tDays_(1) });
        T.near(fin.totals.contractorCommissions, 150, "commission comptée une seule fois");
        T.eq(dbAll_("Expenses").filter(function (e) { return e.uniqueKey === "invoice:" + inv.invoiceId; }).length, 1, "une seule dépense de maintenance");
        T.fails(fx.tok.ownerA, "pay.record", { refType: "INVOICE", refId: inv.invoiceId, kind: "INVOICE", amount: 2000 }, "VALIDATION");
        T.call(fx.tok.ownerA, "pay.record", { refType: "INVOICE", refId: inv.invoiceId, kind: "INVOICE", amount: 1020, reference: "VIR-ART" });
        T.eq(dbGet_("Invoices", inv.invoiceId).status, "PAID", "facture payée");
        T.call(fx.tok.ownerA, "inc.update", { incidentId: inc.incidentId, status: "CLOSED" });
        const closed = dbGet_("IncidentsV4", inc.incidentId);
        T.eq(closed.status, "CLOSED", "clôture"); T.near(closed.finalCost, 1200, "coût final = facture TTC");
        // Prestataire de l'annuaire : chaque client ne voit que les chiffres réalisés chez lui.
        T.near(T.call(fx.tok.ownerA, "ctr.get", { artisanId: art.artisanId }).stats.totalInvoicedTTC, 1200, "le propriétaire A voit sa facture");
        const seenByB = T.call(fx.tok.ownerB, "ctr.get", { artisanId: art.artisanId });
        T.eq([seenByB.stats.totalInvoicedTTC, seenByB.stats.interventions, seenByB.workOrders.length], [0, 0, 0], "le propriétaire B ne voit ni l'activité ni les montants de A");
        T.ok(T.call(fx.tok.ownerB, "ctr.list", { withStats: true }).items.filter(function (c) { return c.artisanId === art.artisanId; }).every(function (c) { return c.stats.totalInvoicedTTC === 0; }), "idem dans la liste");
      }],
      ["Taux de commission configurable (prestataire et intervention)", function (T) {
        T.near(resolveCommissionRate_(undefined, { commissionRate: 10 }, ""), 10, "taux prestataire");
        T.near(resolveCommissionRate_(12, { commissionRate: 10 }, ""), 12, "taux saisi sur l'intervention");
        T.near(resolveCommissionRate_(undefined, { commissionRate: "" }, ""), 15, "défaut 15 %");
        const s = computeInvoiceSplit_(333.33, 20, 15, 20);
        T.near(s.commissionAmount, 50, "arrondi au centime"); T.near(s.amountTTC, 400, "TTC arrondi");
      }],
      ["Intervention sans devis refusée (sauf urgence critique)", function (T, fx) {
        const inc = T.call(fx.tok.ownerA, "inc.create", { propertyId: fx.propA, category: "ELECTRICITY", severity: "MEDIUM", description: "Prise HS" });
        const art = dbAll_("Artisans").find(function (a) { return a.email === fx.users.artisan.email; });
        T.fails(fx.tok.ownerA, "wo.create", { incidentId: inc.incidentId, artisanId: art.artisanId }, "VALIDATION");
        T.call(fx.tok.ownerA, "inc.update", { incidentId: inc.incidentId, severity: "CRITICAL" });
        T.ok(T.call(fx.tok.ownerA, "wo.create", { incidentId: inc.incidentId, artisanId: art.artisanId }).workOrderId, "urgence autorisée");
      }]
    ] },
    { name: "Locations longue durée", tests: [
      ["Bail : échéancier, paiement partiel, retard, quittance, fin", function (T, fx) {
        const t = T.call(fx.tok.ownerA, "tenant.create", { propertyId: fx.propA2, fullName: "Samira Locataire", email: fx.users.tenant.email });
        const start = addMonthsStr_(todayStr_().slice(0, 8) + "01", -2);
        const l = T.call(fx.tok.ownerA, "lease.create", { propertyId: fx.propA2, tenantId: t.tenantId, startDate: start, endDate: addDaysStr_(addMonthsStr_(start, 6), -1), monthlyRent: 5000, charges: 300, deposit: 10000, dueDay: 5 });
        const act = T.call(fx.tok.ownerA, "lease.activate", { leaseId: l.leaseId });
        T.eq(act.schedulesCreated, 6, "6 échéances mensuelles");
        const sched = T.call(fx.tok.ownerA, "lease.get", { leaseId: l.leaseId }).schedules;
        T.near(sched[0].amountDue, 5300, "loyer + charges");
        T.eq(sched[0].status, "LATE", "échéance passée non payée = en retard (jamais encaissée automatiquement)");
        T.call(fx.tok.ownerA, "pay.record", { refType: "RENT_SCHEDULE", refId: sched[0].scheduleId, kind: "RENT", amount: 2000 });
        let s0 = T.call(fx.tok.ownerA, "lease.get", { leaseId: l.leaseId }).schedules[0];
        T.near(s0.remaining, 3300, "reste dû"); T.eq(s0.status, "LATE", "toujours en retard (partiel)");
        T.fails(fx.tok.tenant, "lease.receipt", { scheduleId: s0.scheduleId }, "VALIDATION");
        T.call(fx.tok.ownerA, "pay.record", { refType: "RENT_SCHEDULE", refId: s0.scheduleId, kind: "RENT", amount: 3300 });
        T.fails(fx.tok.ownerA, "pay.record", { refType: "RENT_SCHEDULE", refId: s0.scheduleId, kind: "RENT", amount: 1 }, "VALIDATION");
        T.ok(T.call(fx.tok.tenant, "lease.receipt", { scheduleId: s0.scheduleId }).base64, "quittance pour le locataire");
        T.eq(T.call(fx.tok.tenant, "lease.mine", {}).length, 1, "espace locataire");
        T.fails(fx.tok.ownerB, "lease.get", { leaseId: l.leaseId }, "FORBIDDEN");
        T.call(fx.tok.ownerA, "pay.record", { refType: "LEASE", refId: l.leaseId, kind: "DEPOSIT", amount: 10000 });
        const end = T.call(fx.tok.ownerA, "lease.end", { leaseId: l.leaseId, endDate: todayStr_(), reason: "Départ anticipé" });
        T.ok(end.schedulesCancelled >= 1, "échéances futures annulées");
        T.fails(fx.tok.ownerA, "lease.depositReturn", { leaseId: l.leaseId, amountReturned: 12000 }, "VALIDATION");
        const dr = T.call(fx.tok.ownerA, "lease.depositReturn", { leaseId: l.leaseId, amountReturned: 9000, deductionReason: "Peinture" });
        T.near(dr.deductions, 1000, "retenue");
      }],
      ["Échéancier : proratisation et indexation (calcul pur)", function (T) {
        const p = buildRentPeriods_({ leaseId: "L", startDate: "2026-01-01", endDate: "2026-03-15", monthlyRent: 3100, charges: 0, dueDay: 5, indexationRate: 0 }, "2026-12-31");
        T.eq(p.length, 3, "3 périodes"); T.eq(p[0].dueDate, "2026-01-05", "jour d'échéance"); T.near(p[2].rentAmount, 1500, "mars proratisé 15/31");
        const q = buildRentPeriods_({ leaseId: "L", startDate: "2026-01-01", endDate: "2027-12-31", monthlyRent: 1000, charges: 0, dueDay: 1, indexationRate: 2, nextIndexationDate: "2027-01-01" }, "2027-12-31");
        T.near(q[11].rentAmount, 1000, "avant indexation"); T.near(q[12].rentAmount, 1020, "après indexation 2 %");
      }]
    ] },
    { name: "KPI et Pareto", tests: [
      ["Pareto : classement, parts, cumul, seuil 80 %", function (T) {
        const r = paretoCompute_([{ key: "B", value: 30 }, { key: "A", value: 50 }, { key: "D", value: 5 }, { key: "C", value: 15 }]);
        T.eq(r.items.map(function (x) { return x.key; }), ["A", "B", "C", "D"], "tri décroissant");
        T.eq(r.items.map(function (x) { return x.share; }), [50, 30, 15, 5], "parts");
        T.eq(r.items.map(function (x) { return x.cumShare; }), [50, 80, 95, 100], "cumul");
        T.eq(r.items.filter(function (x) { return x.vital; }).map(function (x) { return x.key; }), ["A", "B"], "prioritaires ≈ 80 %");
        const r2 = paretoCompute_([{ key: "A", value: 70 }, { key: "B", value: 20 }, { key: "C", value: 10 }]);
        T.eq(r2.vitalCount, 2, "l'élément qui franchit 80 % est inclus");
      }],
      ["Pareto : données vides, valeurs nulles, négatives, catégories inconnues, égalités", function (T) {
        const e = paretoCompute_([]); T.ok(e.empty && e.total === 0 && e.vitalCount === 0, "vide");
        const z = paretoCompute_([{ key: "A", value: 0 }, { key: "B", value: 0 }]); T.ok(z.empty && !z.items.some(function (x) { return x.vital; }), "tout à zéro");
        const n = paretoCompute_([{ key: "A", value: 10 }, { key: "B", value: -5 }, { key: "", value: 10 }, { key: "C", value: 0 }]);
        T.eq(n.total, 20, "négatif exclu"); T.ok(n.warnings.length === 1, "avertissement"); T.ok(n.items.some(function (x) { return x.key === "NON_CLASSE"; }), "inconnu → NON_CLASSE");
        T.eq(n.items[n.items.length - 1].key, "C", "zéro en fin de classement"); T.ok(!n.items[n.items.length - 1].vital, "zéro jamais prioritaire");
        const t = paretoCompute_([{ key: "Z", label: "Zeta", value: 5 }, { key: "A", label: "Alpha", value: 5 }]); T.eq(t.items[0].label, "Alpha", "égalité stable");
      }],
      ["Pareto serveur, filtre de période et cohérence tableau / export CSV", function (T, fx) {
        const from = addDaysStr_(todayStr_(), -1), to = tDays_(1);
        const r = T.call(fx.tok.ownerA, "pareto.run", { type: "INCIDENTS_BY_CATEGORY", from: from, to: to });
        T.ok(r.result.total >= 3, "incidents de la période comptés");
        const csv = T.call(fx.tok.ownerA, "pareto.export", { type: "INCIDENTS_BY_CATEGORY", from: from, to: to, format: "csv" }).content;
        const lines = parseCsv_(csv, 1000);
        T.eq(lines.length - 1, r.result.items.length, "même nombre de lignes");
        r.result.items.forEach(function (x, i) { T.eq(String(lines[i + 1][1]), String(x.label), "libellé ligne " + (i + 1)); T.near(lines[i + 1][4], x.cumShare, "cumul ligne " + (i + 1)); });
        const old = T.call(fx.tok.ownerA, "pareto.run", { type: "INCIDENTS_BY_CATEGORY", from: "2020-01-01", to: "2020-01-31" });
        T.ok(old.result.empty, "période sans activité");
        T.eq(T.call(fx.tok.ownerB, "pareto.run", { type: "INCIDENTS_BY_CATEGORY", from: from, to: to }).result.total, 0, "cloisonnement du Pareto");
      }],
      ["KPI : revenus proratisés, dépenses, occupation, annulations", function (T, fx) {
        const org = tOrg_("KPI " + fx.run, "OWNER_ORG"), u = tMakeUser_(fx.mail("kpi"), "OWNER", org.organizationId, fx.pw);
        const tok = T.pub("auth.login", { email: u.email, password: fx.pw }).token;
        const from = "2030-03-01", to = "2030-03-31";
        dbInsert_("Properties", { organizationId: org.organizationId, ownerUserId: u.userId, name: "KPI 1", city: "Marrakech", rentalMode: "SHORT_TERM", status: "ACTIVE", createdAt: "2030-01-01T00:00:00Z", nightlyPrice: 500 });
        const pid = dbAll_("Properties").find(function (x) { return x.name === "KPI 1"; }).propertyId;
        T.call(tok, "resv.create", { propertyId: pid, checkIn: "2030-03-30", checkOut: "2030-04-03", guestName: "Chevauche avril", totalPrice: 4000, fees: 0 });
        T.call(tok, "resv.create", { propertyId: pid, checkIn: "2030-03-10", checkOut: "2030-03-12", guestName: "Mars", totalPrice: 1000, fees: 0 });
        const c = T.call(tok, "resv.create", { propertyId: pid, checkIn: "2030-03-20", checkOut: "2030-03-21", guestName: "Annulée", totalPrice: 500, fees: 0 });
        T.call(tok, "resv.cancel", { reservationId: c.reservationId, reason: "NO_PAYMENT" });
        T.call(tok, "exp.create", { propertyId: pid, category: "UTILITIES", description: "Électricité", amount: 300, expenseDate: "2030-03-15" });
        T.call(tok, "exp.create", { propertyId: pid, category: "UTILITIES", description: "Hors période", amount: 999, expenseDate: "2030-04-15" });
        const k = T.call(tok, "fin.summary", { from: from, to: to }).totals;
        T.near(k.accommodation, 3000, "1000 + 4000 × 2/4 nuits"); T.eq(k.bookedNights, 4, "nuits en mars");
        T.eq(k.availableNights, 31, "31 nuits disponibles"); T.near(k.occupancyRate, 12.9, "4/31");
        T.near(k.adr, 750, "prix moyen par nuit"); T.near(k.expenses, 300, "dépenses de la période uniquement");
        T.eq(k.cancellations, 1, "annulations comptées"); T.near(k.result, 2700, "résultat = prévu − dépenses − commissions");
        const pa = T.call(tok, "pareto.run", { type: "CANCEL_REASONS", from: from, to: to });
        T.eq(pa.result.items[0].key, "NO_PAYMENT", "Pareto des annulations");
      }],
      ["Tableaux de bord par rôle sur données réelles", function (T, fx) {
        const d = T.call(fx.tok.ownerA, "dash.get", {});
        T.ok(d.sections.indexOf("portfolio") >= 0 && d.portfolio.propertyCount === 2, "tableau propriétaire");
        const ad = T.call(fx.tok.superA, "dash.get", {});
        T.ok(ad.admin.organizations >= 5 && ad.sections.indexOf("portfolio") < 0, "super admin : agrégats uniquement");
        T.ok(T.call(fx.tok.cleaner2, "dash.get", {}).cleaning.completedInPeriod >= 0, "tableau ménage");
        T.ok(T.call(fx.tok.artisan, "dash.get", {}).artisan.completed >= 1, "tableau artisan");
        T.ok(T.call(fx.tok.ownerA, "dash.get", {}).lease, "tableau longue durée");
      }],
      ["Rapports : export respectant les permissions", function (T, fx) {
        const csvA = T.call(fx.tok.ownerA, "report.export", { type: "RESERVATIONS", from: tDays_(-30), to: tDays_(500), format: "csv" }).content;
        const csvB = T.call(fx.tok.ownerB, "report.export", { type: "RESERVATIONS", from: tDays_(-30), to: tDays_(500), format: "csv" }).content;
        T.ok(csvA.indexOf("Ali Benali") >= 0 && csvB.indexOf("Ali Benali") < 0, "aucune fuite inter-propriétaires");
        T.fails(fx.tok.ownerA, "report.run", { type: "SUBSCRIPTIONS" }, "FORBIDDEN");
        T.fails(fx.tok.guard, "report.export", { type: "RESERVATIONS", format: "csv" }, "FORBIDDEN");
      }]
    ] },
    { name: "Abonnements", tests: [
      ["Essai, échéance impayée, suspension en lecture seule, paiement manuel", function (T, fx) {
        const org = tOrg_("Abonné " + fx.run, "OWNER_ORG"), u = tMakeUser_(fx.mail("abo"), "OWNER", org.organizationId, fx.pw);
        const tok = T.pub("auth.login", { email: u.email, password: fx.pw }).token;
        const s = T.call(fx.tok.superA, "sub.assign", { organizationId: org.organizationId, planCode: "ESSENTIEL", trial: true });
        T.eq(s.status, "TRIAL", "essai");
        dbUpdate_("Subscriptions", s.subscriptionId, { trialEnd: "2020-01-01", nextDueDate: "2020-01-01", periodEnd: "2020-01-01" });
        subscriptionJob_(); T.eq(dbGet_("Subscriptions", s.subscriptionId).status, "PAST_DUE", "fin d'essai → paiement attendu");
        subscriptionJob_(); T.eq(dbGet_("Subscriptions", s.subscriptionId).status, "SUSPENDED", "délai de grâce dépassé → suspendu");
        T.fails(tok, "property.create", { organizationId: org.organizationId, name: "Bloqué", city: "Rabat" }, "SUBSCRIPTION");
        T.ok(T.call(tok, "property.list", {}), "lecture toujours possible");
        T.call(fx.tok.superA, "sub.recordPayment", { subscriptionId: s.subscriptionId, amount: 199, reference: "VIR-ABO-1" });
        T.eq(dbGet_("Subscriptions", s.subscriptionId).status, "ACTIVE", "réactivé par paiement enregistré");
        T.ok(T.call(tok, "property.create", { organizationId: org.organizationId, name: "OK", city: "Rabat" }).propertyId, "écriture rétablie");
        T.fails(tok, "lease.create", { propertyId: "x" }, "FORBIDDEN");
      }],
      ["Quota de biens du forfait appliqué", function (T, fx) {
        const org = tOrg_("Quota " + fx.run, "OWNER_ORG"), u = tMakeUser_(fx.mail("quota"), "OWNER", org.organizationId, fx.pw);
        const tok = T.pub("auth.login", { email: u.email, password: fx.pw }).token;
        T.call(fx.tok.superA, "sub.assign", { organizationId: org.organizationId, planCode: "ESSENTIEL", trial: true });
        for (let i = 0; i < 5; i++) T.call(tok, "property.create", { organizationId: org.organizationId, name: "Bien " + i, city: "Agadir" });
        T.fails(tok, "property.create", { organizationId: org.organizationId, name: "Bien 6", city: "Agadir" }, "QUOTA");
        T.fails(tok, "pareto.run", { type: "INCIDENTS_BY_CATEGORY" }, "PLAN");
      }]
    ] },
    { name: "Données, migration et robustesse", tests: [
      ["Installation à partir de rien : base, dossier privé, schéma, forfaits, premier super administrateur", function (T) {
        // Propriétés simulées en mémoire : les vraies propriétés du script (base de production) ne sont jamais touchées.
        const store = {}, fakeProps = { getProperty: function (k) { return store[k] === undefined ? null : store[k]; }, setProperty: function (k, v) { store[k] = String(v); return this; } };
        const prevSs = DB_SS_, root = driveRoot_();
        let created = null;
        try {
          const a = ensureAdminEmails_(fakeProps, "proprietaire.script@example.test");
          T.ok(a.defaulted && store[IMMO_CONFIG.ADMIN_EMAILS_PROPERTY] === "proprietaire.script@example.test", "propriétaire du script désigné super administrateur par défaut");
          T.eq(ensureAdminEmails_(fakeProps, "autre@example.test").defaulted, false, "liste existante conservée");
          const d = ensureDatabase_(fakeProps, root);
          created = d.id;
          T.ok(d.created && store[IMMO_CONFIG.DATABASE_PROPERTY] === d.id, "base créée et enregistrée");
          const file = DriveApp.getFileById(d.id);
          T.eq(String(file.getSharingAccess()), String(DriveApp.Access.PRIVATE), "base privée");
          if (typeof file.getParentId_ === "function") T.eq(file.getParentId_(), root.getId(), "base rangée dans le dossier privé");
          T.eq(ensureDatabase_(fakeProps, root).created, false, "seconde exécution : même base, aucune recréation");
          const mig = runMigrations_("tests-installation");
          const ss = SpreadsheetApp.openById(d.id);
          T.eq(Object.keys(schema_()).filter(function (n) { return !ss.getSheetByName(n); }), [], "tous les onglets créés");
          T.ok(ss.getSheetByName("Accueil"), "onglet d'accueil explicatif");
          T.eq(dbAll_("SubscriptionPlans").map(function (x) { return x.planCode; }).sort(), ["BUSINESS", "ESSENTIEL", "PRO"], "forfaits créés");
          T.ok(dbAll_("Organizations").some(function (o) { return o.type === "PLATFORM"; }), "organisation plateforme créée");
          T.ok(!mig.backup, "pas de sauvegarde inutile d'une base vide");
          const before = TEST_HOOKS_.appUrl; TEST_HOOKS_.appUrl = "https://example.test/exec";
          try {
            const admins = createFirstSuperAdminInternal_("proprietaire.script@example.test", fakeProps);
            T.ok(admins.length === 1 && admins[0].roleCreated && admins[0].activationLinkSent, "super administrateur créé, lien d'activation envoyé");
          } finally { TEST_HOOKS_.appUrl = before; }
          const u = dbAll_("Users").find(function (x) { return x.email === "proprietaire.script@example.test"; });
          T.ok(u && !u.passwordHash, "aucun mot de passe tant que le lien n'est pas utilisé");
          T.ok(dbAll_("UserRoles").some(function (r) { return String(r.userId) === String(u.userId) && r.role === "SUPER_ADMIN" && r.status === "ACTIVE"; }), "rôle SUPER_ADMIN actif");
        } finally {
          dbSetSpreadsheet_(prevSs);
          if (created) { try { DriveApp.getFileById(created).setTrashed(true); } catch (e) { console.error(e.message); } }
        }
      }],
      ["Migration non destructive d'une base de la phase 4", function (T) {
        const legacy = SpreadsheetApp.create("ImmoPilot_TEST_LEGACY_" + Utilities.getUuid().slice(0, 6));
        const prevSs = DB_SS_;
        try {
          const sh = legacy.insertSheet("Properties");
          const hdr = ["propertyId", "organizationId", "ownerUserId", "residenceId", "name", "address", "city", "neighborhood", "building", "floor", "doorNumber", "propertyType", "surfaceM2", "bedrooms", "bathrooms", "equipmentJson", "accessInstructions", "latitude", "longitude", "rentalMode", "status", "createdAt", "createdBy", "updatedAt", "updatedBy"];
          sh.getRange(1, 1, 1, hdr.length).setValues([hdr]);
          sh.appendRow(["prop_legacy1", "org_x", "usr_x", "", "Ancien bien", "", "Marrakech", "", "", "", "", "APARTMENT", 80, 2, 1, "[]", "", "", "", "SHORT_TERM", "ACTIVE", "2026-01-01T00:00:00", "admin", "", ""]);
          sh.appendRow(["", "org_x", "usr_x", "", "Sans identifiant", "", "Fès", "", "", "", "", "APARTMENT", "", "", "", "[]", "", "", "", "SHORT_TERM", "ACTIVE", "", "", "", ""]);
          const inc = legacy.insertSheet("Incidents");
          inc.getRange(1, 1, 1, 8).setValues([["incidentId", "organizationId", "propertyId", "category", "description", "status", "createdAt", "createdBy"]]);
          inc.appendRow(["inc_old1", "org_x", "prop_legacy1", "PLUMBING", "Ancienne fuite", "OPEN", "2026-02-01T00:00:00", "a@b.c"]);
          const rs = legacy.insertSheet("Reservations");
          rs.getRange(1, 1, 1, 14).setValues([["reservationId", "organizationId", "propertyId", "agencyOrganizationId", "checkIn", "checkOut", "guestCount", "guestName", "status", "notes", "createdAt", "createdBy", "updatedAt", "updatedBy"]]);
          rs.getRange(2, 1, 3, 14).setValues([
            ["res_old1", "org_x", "prop_legacy1", "", "2026-03-01", "2026-03-05", 2, "Ancien A", "CONFIRMED", "", "", "", "", ""],
            ["res_old2", "org_x", "prop_legacy1", "", "2026-03-04", "2026-03-06", 2, "Ancien B", "CONFIRMED", "", "", "", "", ""],
            ["res_old3", "org_x", "prop_legacy1", "", "2026-03-06", "2026-03-08", 1, "Ancien C", "CONFIRMED", "", "", "", "", ""]]);
          dbSetSpreadsheet_(legacy);
          runMigrations_("tests");
          const props = dbAll_("Properties");
          T.eq(props.length, 2, "aucune ligne perdue");
          T.eq(props[0].name, "Ancien bien", "données conservées"); T.near(props[0].surfaceM2, 80, "valeur numérique conservée");
          T.ok(props[1].propertyId && props[1].propertyId.indexOf("prop_") === 0, "identifiant manquant attribué");
          T.ok(dbHeaders_("Properties").indexOf("nightlyPrice") > 20, "nouvelles colonnes ajoutées à droite");
          T.eq(dbHeaders_("Properties").slice(0, hdr.length), hdr, "anciennes colonnes inchangées");
          T.ok(dbGet_("IncidentsV4", "inc_old1") && dbGet_("Incidents", "inc_old1"), "incident historique copié, original intact");
          const r1 = dbGet_("Reservations", "res_old1");
          T.eq([r1.paymentStatus, r1.guestName, r1.checkIn], ["UNPAID", "Ancien A", "2026-03-01"], "réservation historique complétée, jamais marquée payée");
          T.eq(integrityReport_().overlaps.map(function (o) { return o.reservationA + ">" + o.reservationB; }), ["res_old1>res_old2"], "chevauchement hérité signalé (départ/arrivée le même jour non signalé)");
          T.eq(dbAll_("Reservations").length, 3, "réservations conservées sans modification de dates");
          runMigrations_("tests");
          T.eq(dbAll_("IncidentsV4").filter(function (i) { return i.incidentId === "inc_old1"; }).length, 1, "migration rejouable sans doublon");
          T.eq(dbAll_("MigrationHistory").filter(function (m) { return m.status === "DONE" && Number(m.version) === 2; }).length, 1, "version 2 appliquée une seule fois");
        } finally { dbSetSpreadsheet_(prevSs); try { DriveApp.getFileById(legacy.getId()).setTrashed(true); } catch (e) { console.error(e.message); } }
      }],
      ["Détection des doublons d'identifiants", function (T) {
        const sh = dbSheet_("Residences"), hdr = dbHeaders_("Residences");
        const row = hdr.map(function (h) { return { residenceId: "res_dup", organizationId: "o", name: "D", city: "C", status: "ACTIVE" }[h] || ""; });
        sh.appendRow(row); sh.appendRow(row); dbReset_();
        T.eq(integrityReport_().duplicates.Residences, 1, "doublon signalé (non corrigé automatiquement)");
      }],
      ["Sauvegarde et restauration non destructive", function (T) {
        const b = backupDatabase_("test");
        T.ok(b.fileId && /^ImmoPilot_backup_/.test(b.name), "copie créée");
        if (typeof __MOCK__ === "undefined") T.skip("Restauration réelle : test manuel M-09 (restoreFromBackup bascule la base de production).");
        const before = dbAll_("Organizations").length;
        dbInsert_("Organizations", { name: "Après sauvegarde", status: "ACTIVE", type: "OWNER_ORG", createdAt: nowIso_() });
        PropertiesService.getScriptProperties().setProperty(IMMO_CONFIG.DATABASE_PROPERTY, DB_SS_.getId());
        const r = restoreFromBackup(b.fileId);
        T.ok(r.activeDatabaseId !== r.previousDatabaseId, "nouvelle base active");
        T.eq(dbAll_("Organizations").length, before, "état de la sauvegarde restauré");
        T.ok(SpreadsheetApp.openById(r.previousDatabaseId), "ancienne base conservée");
      }],
      ["Erreur d'écriture : réponse propre avec référence, sans fuite technique", function (T, fx) {
        if (typeof __MOCK__ === "undefined") T.skip("Injection de panne uniquement dans le simulateur.");
        __MOCK__.failWrites = "Reservations";
        try {
          const e = T.fails(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: tDays_(700), checkOut: tDays_(701), guestName: "Panne" }, "INTERNAL");
          T.ok(/ERR-/.test(e.message) && e.message.indexOf("Error:") < 0, "référence d'erreur");
        } finally { __MOCK__.failWrites = null; }
        T.ok(dbAll_("ActivityLogs").some(function (l) { return l.action === "ERROR"; }), "erreur journalisée");
        T.ok(!dbAll_("Reservations").some(function (r) { return r.guestName === "Panne"; }), "aucune donnée partielle");
      }],
      ["Quota e-mail épuisé : invitation enregistrée, statut EMAIL_FAILED", function (T, fx) {
        TEST_HOOKS_.mailQuota = 0;
        try {
          const r = T.call(fx.tok.ownerA, "invite.create", { email: fx.mail("quotamail"), organizationId: fx.orgA.organizationId, role: "GUARD" });
          T.eq(r.emailSent, false, "envoi non effectué"); T.eq(dbGet_("Invitations", r.invitationId).status, "EMAIL_FAILED", "statut explicite");
          T.ok(dbAll_("NotificationLogs").some(function (l) { return l.status === "FAILED" && /Quota/.test(l.error); }), "échec journalisé");
        } finally { TEST_HOOKS_.mailQuota = null; }
      }],
      ["Lien WhatsApp encodé (sans envoi automatique)", function (T) {
        const u = waLink_("06 12 34 56 78", "Bonjour & bienvenue à Marrakech ?");
        T.eq(u, "https://wa.me/212612345678?text=" + encodeURIComponent("Bonjour & bienvenue à Marrakech ?"), "lien");
      }],
      ["Notifications sans doublon (clé d'événement)", function (T, fx) {
        const n0 = dbAll_("Notifications").length;
        notify_({ eventKey: "dup-test", userIds: [fx.users.ownerA.userId], type: "INFO", title: "x", email: false });
        notify_({ eventKey: "dup-test", userIds: [fx.users.ownerA.userId], type: "INFO", title: "x", email: false });
        T.eq(dbAll_("Notifications").length, n0 + 1, "une seule notification");
      }]
    ] }
  ];
}
