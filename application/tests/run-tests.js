/**
 * Exécute la suite Tests.gs hors Google, avec le simulateur tests/gas-mock.js, et contrôle la cohérence
 * entre l'interface (appels api/apiPublic) et les routes déclarées côté serveur.
 * Usage : node tests/run-tests.js   (depuis la racine du projet). Résultats : tests/results.json
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { createMock } = require("./gas-mock");
const ROOT = path.resolve(__dirname, "..");

function loadProject(opts) {
  opts = opts || {};
  const BASE = opts.root || ROOT;
  const mock = createMock();
  const HtmlService = {
    XFrameOptionsMode: { DEFAULT: "DEFAULT", ALLOWALL: "ALLOWALL" },
    createHtmlOutputFromFile: function (n) { const c = fs.readFileSync(path.join(BASE, n + ".html"), "utf8").replace(/<!--[\s\S]*?-->/g, ""); /* Google peut retirer les commentaires HTML */ return { getContent: function () { return c; } }; },
    createTemplateFromFile: function (n) { const tpl = { evaluate: function () { const o = { content: fs.readFileSync(path.join(BASE, n + ".html"), "utf8"), setTitle: function () { return o; }, addMetaTag: function () { return o; }, setXFrameOptionsMode: function () { return o; }, getContent: function () { return o.content; } }; return o; } }; return tpl; },
    createHtmlOutput: function (h) { const o = { getContent: function () { return h; }, setTitle: function () { return o; } }; return o; }
  };
  const sandbox = Object.assign({ console: console, HtmlService: HtmlService }, mock.globals);
  const ctx = vm.createContext(sandbox);
  // Ordre de chargement défavorable : Code.gs en premier (aucune dépendance au chargement ne doit exister entre fichiers).
  const gs = fs.readdirSync(BASE).filter(function (f) { return /\.gs$/.test(f); }).sort(function (a, b) { return a === "Code.gs" ? -1 : b === "Code.gs" ? 1 : a.localeCompare(b); });
  // IMMO_EDITION=FR : mêmes tests sur l'édition France (euro, Europe/Paris, CNI, fiches de police).
  const edition = String(process.env.IMMO_EDITION || "MA").toUpperCase();
  gs.forEach(function (f) {
    const src = (opts.replace && opts.replace[f]) || f;
    let code = fs.readFileSync(path.join(BASE, src), "utf8");
    if (edition !== "MA") code = code.replace('var IMMO_EDITION_ = "MA";', 'var IMMO_EDITION_ = "' + edition + '";');
    vm.runInContext(code, ctx, { filename: f });
  });
  return { ctx: ctx, mock: mock, files: gs };
}

function routeConsistency(ctx) {
  const server = vm.runInContext("Object.keys(routes_())", ctx), pub = vm.runInContext("Object.keys(publicRoutes_())", ctx);
  const undef = vm.runInContext("(function(){var r=routes_(),p=publicRoutes_(),o=[];[r,p].forEach(function(R){Object.keys(R).forEach(function(k){var v=R[k];if(!(typeof v==='function'||(typeof v==='string'&&typeof globalThis[v]==='function')))o.push(k)})});return o;})()", ctx);
  const client = new Set(), clientPub = new Set();
  ["Scripts.html", "Components.html", "Index.html"].forEach(function (f) {
    const p = path.join(ROOT, f); if (!fs.existsSync(p)) return;
    const src = fs.readFileSync(p, "utf8");
    let m; const re = /\bapi\(\s*"([a-zA-Z.]+)"/g, rp = /\bapiP\(\s*"([a-zA-Z.]+)"/g;
    while ((m = re.exec(src))) client.add(m[1]);
    while ((m = rp.exec(src))) clientPub.add(m[1]);
  });
  const missing = [...client].filter(function (r) { return server.indexOf(r) < 0; }).concat([...clientPub].filter(function (r) { return pub.indexOf(r) < 0; }).map(function (r) { return "public:" + r; }));
  const unused = server.filter(function (r) { return !client.has(r); });
  return { serverRoutes: server.length, publicRoutes: pub.length, clientCalls: client.size + clientPub.size, missingOnServer: missing, notReferencedByUi: unused, undefinedHandlers: undef };
}

/**
 * Scénario complet « compte Google vierge » : aucune propriété du script, aucun fichier.
 * Rejoue exactement la procédure de DEPLOIEMENT.md dans un contexte neuf du simulateur.
 */
function freshInstallScenario() {
  const { ctx, mock } = loadProject();
  const M = mock.M, steps = [];
  const run = function (code) { return vm.runInContext(code, ctx); };
  const step = function (name, fn) { try { const d = fn(); steps.push({ name: name, status: "PASS", detail: d || "" }); } catch (e) { steps.push({ name: name, status: "FAIL", detail: e.message }); } };
  const ok = function (c, m) { if (!c) throw new Error(m); };
  const lastLink = function (action) { for (let i = M.outbox.length - 1; i >= 0; i--) { const m = String(M.outbox[i].body || "").match(new RegExp("\\?action=" + action + "&token=([a-f0-9]{64})")); if (m) return m[1]; } return null; };
  M.props = {};
  M.session = { active: "fondateur@example.test", effective: "fondateur@example.test" };
  let setup = null, tok = null, orgId = null;
  step("Propriétés du script vides au départ", function () { ok(Object.keys(M.props).length === 0, "propriétés non vides"); });
  step("setupProject() crée la base, le dossier privé et le schéma", function () {
    setup = run("setupProject()");
    ok(setup.ok && setup.databaseCreated && setup.adminEmailsDefaulted, JSON.stringify(setup).slice(0, 300));
    ok(M.props.IMMO_DATABASE_SPREADSHEET_ID === setup.spreadsheetId && M.props.IMMO_PRIVATE_ROOT_FOLDER_ID && M.props.IMMO_ADMIN_EMAILS === "fondateur@example.test", "propriétés non renseignées");
    ok(setup.driveRootPrivate.ok, "dossier non privé");
    ok(setup.superAdmins.length === 1 && setup.superAdmins[0].roleCreated, "super administrateur non créé");
    return "base " + setup.spreadsheetId + ", " + setup.migrations.applied.length + " migrations";
  });
  step("Avant déploiement : pas de lien envoyé, message explicite", function () { ok(setup.superAdmins[0].activationLinkSent === false, "lien envoyé sans URL"); });
  step("setupProject() relancé : même base, rien de recréé", function () { const s2 = run("setupProject()"); ok(!s2.databaseCreated && s2.spreadsheetId === setup.spreadsheetId, "base recréée"); });
  step("Déploiement simulé, IMMO_APP_URL renseignée, createFirstSuperAdmin() envoie un lien cliquable", function () {
    M.props.IMMO_APP_URL = "https://script.google.com/macros/s/DEPLOIEMENT_TEST/exec";
    const r = run("createFirstSuperAdmin()");
    ok(r[0].activationLinkSent && lastLink("reset"), "aucun lien d'activation");
    const mail = M.outbox[M.outbox.length - 1];
    ok(mail.htmlBody && mail.htmlBody.indexOf('href="https://script.google.com/macros/s/DEPLOIEMENT_TEST/exec?action=reset&amp;token=' + lastLink("reset") + '"') >= 0, "lien non cliquable dans l'e-mail HTML");
    ok(mail.htmlBody.indexOf("<script") < 0 && mail.body.indexOf(lastLink("reset")) >= 0, "version texte ou HTML incorrecte");
  });
  step("installTriggers() et healthCheck()", function () {
    run("installTriggers()");
    const h = run("healthCheck()");
    ok(h.ok && h.triggersOk && h.appUrlConfigured && h.driveRoot.ok && h.integrity.ok, JSON.stringify(h).slice(0, 300));
  });
  step("Activation du compte par le lien puis connexion", function () {
    const r = run("apiPublic('auth.resetPassword', " + JSON.stringify({ token: lastLink("reset"), password: "MotDePasse2026" }) + ")");
    ok(r.ok, JSON.stringify(r));
    const l = run("apiPublic('auth.login', {email:'fondateur@example.test', password:'MotDePasse2026'})");
    ok(l.ok && l.data.me.isSuper, JSON.stringify(l).slice(0, 200));
    tok = l.data.token;
  });
  step("Le lien d'activation ne peut pas être réutilisé", function () {
    const r = run("apiPublic('auth.resetPassword', " + JSON.stringify({ token: lastLink("reset"), password: "AutreMotDePasse9" }) + ")");
    ok(!r.ok, "lien réutilisé");
  });
  step("Super administrateur : création de la première organisation cliente et invitation du propriétaire", function () {
    const o = run("api(" + JSON.stringify(tok) + ", 'org.create', {name:'Riads de la Médina', type:'OWNER_ORG'})");
    ok(o.ok, JSON.stringify(o)); orgId = o.data.organizationId;
    const i = run("api(" + JSON.stringify(tok) + ", 'invite.create', " + JSON.stringify({ organizationId: orgId, email: "proprietaire@example.test", role: "OWNER" }) + ")");
    ok(i.ok && lastLink("accept"), JSON.stringify(i));
  });
  step("Le propriétaire accepte l'invitation, se connecte et crée son premier bien", function () {
    const a = run("apiPublic('invite.accept', " + JSON.stringify({ token: lastLink("accept"), password: "Proprietaire2026", displayName: "Karim" }) + ")");
    ok(a.ok, JSON.stringify(a));
    const l = run("apiPublic('auth.login', {email:'proprietaire@example.test', password:'Proprietaire2026'})");
    ok(l.ok, JSON.stringify(l));
    const p = run("api(" + JSON.stringify(l.data.token) + ", 'property.create', " + JSON.stringify({ organizationId: orgId, name: "Riad Yasmine", city: "Marrakech", propertyType: "RIAD", nightlyPrice: 1200, rentalMode: "SHORT_TERM" }) + ")");
    ok(p.ok, JSON.stringify(p));
    const mine = run("api(" + JSON.stringify(l.data.token) + ", 'property.list', {})");
    ok(mine.ok && mine.data.items.length === 1 && mine.data.items[0].name === "Riad Yasmine", "le propriétaire ne voit pas son bien");
    const s = run("api(" + JSON.stringify(tok) + ", 'property.list', {})");
    ok(s.ok && Array.isArray(s.data.items) && s.data.items.length === 0, "le super administrateur voit le bien d'un client sans assistance");
  });
  return { ok: steps.every(function (s) { return s.status === "PASS"; }), steps: steps };
}

/** Projet incomplet (fichier HTML absent, fichier script manquant) : doGet doit afficher la liste exacte à corriger. */
function installDiagnosticScenario() {
  const steps = [];
  const step = function (name, fn) { try { fn(); steps.push({ name: name, status: "PASS" }); } catch (e) { steps.push({ name: name, status: "FAIL", detail: e.message }); } };
  const ok = function (c, m) { if (!c) throw new Error(m); };
  step("Projet complet : l'application s'affiche normalement", function () {
    const { ctx } = loadProject();
    const r = vm.runInContext("verifierInstallation()", ctx);
    ok(r.ok && r.expected.gs === 37 && r.expected.html === 9, JSON.stringify(r));
    ok(/<!DOCTYPE html>/i.test(vm.runInContext("doGet({parameter:{}}).getContent()", ctx)) && vm.runInContext("doGet({parameter:{}}).getContent()", ctx).indexOf("installation incomplète") < 0, "page normale attendue");
  });
  step("Fichier HTML « Components » absent et fichier « Pareto » manquant : page explicative", function () {
    const { ctx } = loadProject();
    const orig = ctx.HtmlService.createHtmlOutputFromFile;
    ctx.HtmlService.createHtmlOutputFromFile = function (n) { if (n === "Components") throw new Error("Impossible de trouver le fichier HTML nommé Components."); return orig(n); };
    vm.runInContext("paretoCompute_ = undefined;", ctx);
    const page = vm.runInContext("doGet({parameter:{}}).getContent()", ctx);
    ok(page.indexOf("installation incomplète") >= 0 && page.indexOf("<code>Components.html</code>") >= 0 && page.indexOf("<code>ParetoService.gs</code>") >= 0, page.slice(0, 300));
    ok(page.indexOf("<code>Styles.html</code>") < 0, "fichier présent signalé à tort");
    const r = vm.runInContext("verifierInstallation()", ctx);
    ok(!r.ok && r.missingHtml.join() === "Components" && r.missingGs.join() === "ParetoService", JSON.stringify(r));
  });
  step("Fichier collé incomplètement (ContractorService sans sa fin) : seules ses routes échouent, avec un message clair", function () {
    const { ctx } = loadProject();
    vm.runInContext("ctrList_ = undefined; ctrUpdate_ = undefined;", ctx);
    const r = vm.runInContext("verifierInstallation()", ctx);
    ok(!r.ok && r.missingGs.indexOf("ContractorService") >= 0 && r.missingFunctions.indexOf("ctrList_") >= 0, JSON.stringify(r));
    const page = vm.runInContext("doGet({parameter:{}}).getContent()", ctx);
    ok(page.indexOf("<code>ContractorService.gs</code>") >= 0, "page explicative attendue");
    const e = vm.runInContext("api('x'.repeat(64), 'ctr.list', {})", ctx);
    ok(!e.ok && e.error.code === "CONFIG" && e.error.message.indexOf("ctrList_") >= 0, JSON.stringify(e));
    const m = vm.runInContext("apiPublic('auth.login', {email:'a@b.cd', password:'x'})", ctx);
    ok(!m.ok && m.error.code !== "INTERNAL", "les autres routes doivent fonctionner : " + JSON.stringify(m));
  });
  step("UserService collé deux fois (dont à la place de ContractorService) : le projet se charge et verifierInstallation désigne ContractorService", function () {
    const ROOTDIR = path.resolve(__dirname, "..");
    const { ctx } = loadProject({ replace: { "ContractorService.gs": "UserService.gs" } });
    vm.runInContext(fs.readFileSync(path.join(ROOTDIR, "UserService.gs"), "utf8"), ctx, { filename: "UserService (doublon).gs" });
    const r = vm.runInContext("verifierInstallation()", ctx);
    ok(!r.ok && r.missingGs.join() === "ContractorService", JSON.stringify(r));
  });
  step("IMMO_APP_URL mal saisie (identifiant seul, guillemets, URL /dev) : lien complet et cliquable quand même", function () {
    const { ctx } = loadProject();
    const n = function (v) { return vm.runInContext("normalizeAppUrl_(" + JSON.stringify(v) + ")", ctx); };
    const full = "https://script.google.com/macros/s/AKfycbx1234567890abcdefghijklmnopqrstuvwxyz/exec";
    ok(n("AKfycbx1234567890abcdefghijklmnopqrstuvwxyz") === full, "identifiant seul : " + n("AKfycbx1234567890abcdefghijklmnopqrstuvwxyz"));
    ok(n(" " + full + " ") === full && n('"' + full + '"') === full, "espaces ou guillemets");
    ok(n(full.replace("/exec", "/dev")) === full, "URL /dev");
    ok(n("script.google.com/macros/s/AKfycbx1234567890abcdefghijklmnopqrstuvwxyz/exec") === full, "sans https");
    ok(n("n'importe quoi") === "" && n("") === "", "valeur invalide ignorée");
  });
  return { ok: steps.every(function (s) { return s.status === "PASS"; }), steps: steps };
}

/** Version « 2 fichiers » (dist/) : même suite de tests, rendu de la page et vérification d'installation. */
function bundleScenario() {
  require("child_process").execFileSync(process.execPath, [path.join(__dirname, "build-bundle.js")], { stdio: "ignore" });
  const DIST = path.join(ROOT, String(process.env.IMMO_EDITION || "MA").toUpperCase() === "MA" ? "dist" : "dist-" + String(process.env.IMMO_EDITION).toLowerCase()), steps = [];
  const step = function (name, fn) { try { const d = fn(); steps.push({ name: name, status: "PASS", detail: d || "" }); } catch (e) { steps.push({ name: name, status: "FAIL", detail: e.message }); } };
  const ok = function (c, m) { if (!c) throw new Error(m); };
  step("dist/ contient exactement ImmoPilot.gs, Index.html et appsscript.json", function () {
    const f = fs.readdirSync(DIST).sort(); ok(JSON.stringify(f) === JSON.stringify(["ImmoPilot.gs", "Index.html", "appsscript.json"]), f.join(", "));
  });
  const { ctx, mock, files } = loadProject({ root: DIST });
  step("Un seul fichier serveur chargé", function () { ok(files.length === 1 && files[0] === "ImmoPilot.gs", files.join()); });
  step("verifierInstallation() : installation complète avec 2 fichiers", function () { const r = vm.runInContext("verifierInstallation()", ctx); ok(r.ok, JSON.stringify(r)); });
  step("Suite complète de tests sur la version 2 fichiers", function () {
    mock.M.props.IMMO_DATABASE_SPREADSHEET_ID = "inutilise-en-test";
    const out = vm.runInContext("runAllTests()", ctx);
    ok(out.summary.failed === 0 && out.summary.passed === out.summary.total, JSON.stringify(out.summary));
    return out.summary.passed + "/" + out.summary.total;
  });
  step("La page contient toute l'interface (aucune inclusion restante)", function () {
    const page = vm.runInContext("doGet({parameter:{}}).getContent()", ctx);
    ok(page.indexOf("include(") < 0 && page.indexOf("const PAGES = {}") >= 0 && page.indexOf("NAV_HASH") >= 0 && page.indexOf("PAGES.reports") >= 0 && page.indexOf("installation incomplète") < 0, "interface incomplète");
    ok(page.indexOf('<base target="_top">') < 0, "balise base target présente");
  });
  step("Index court (ancienne version) avec le serveur en un fichier : message « remplacez Index » (et non la liste des 8 fichiers)", function () {
    const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "ip-"));
    fs.copyFileSync(path.join(DIST, "ImmoPilot.gs"), path.join(tmp, "ImmoPilot.gs"));
    fs.copyFileSync(path.join(ROOT, "Index.html"), path.join(tmp, "Index.html"));
    const c2 = loadProject({ root: tmp }).ctx;
    const r = vm.runInContext("verifierInstallation()", c2);
    ok(!r.ok && r.indexOutdated && r.missingHtml.join() === "Index", JSON.stringify(r));
    const page = vm.runInContext("doGet({parameter:{}}).getContent()", c2);
    ok(page.indexOf("2_Index_html_A_COLLER.txt") >= 0 && page.indexOf("Styles.html") < 0, "message attendu");
  });
  step("Ligne de fin présente dans ImmoPilot.gs (repère pour vérifier un collage complet)", function () {
    const src = fs.readFileSync(path.join(DIST, "ImmoPilot.gs"), "utf8");
    ok(/FIN DU FICHIER ImmoPilot\.gs/.test(src.split("\n").slice(-3).join("\n")), "marqueur de fin absent");
  });
  return { ok: steps.every(function (s) { return s.status === "PASS"; }), steps: steps };
}

function main() {
  const t0 = Date.now();
  const { ctx, mock, files } = loadProject();
  mock.M.props.IMMO_DATABASE_SPREADSHEET_ID = "inutilise-en-test";
  const out = vm.runInContext("runAllTests()", ctx);
  const rc = routeConsistency(ctx);
  // Rendu de la page (doGet) et inclusion des fichiers HTML.
  let doGetOk = false; try { const h = vm.runInContext("doGet({parameter:{action:'accept',token:'" + "a".repeat(64) + "'}})", ctx); doGetOk = /<!DOCTYPE html>/i.test(h.getContent()); } catch (e) { doGetOk = "ERREUR " + e.message; }
  const fresh = freshInstallScenario();
  const diag = installDiagnosticScenario();
  const bundle = bundleScenario();
  const report = { ranAt: new Date().toISOString(), durationMs: Date.now() - t0, node: process.version, filesLoaded: files, summary: out.summary, results: out.results, routes: rc, doGetRenders: doGetOk, freshInstall: fresh, installDiagnostic: diag, bundle: bundle };
  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(report, null, 2));
  const groups = {};
  out.results.forEach(function (r) { (groups[r.group] = groups[r.group] || []).push(r); });
  Object.keys(groups).forEach(function (g) { console.log("\n## " + g); groups[g].forEach(function (r) { console.log((r.status === "PASS" ? "  ✔ " : r.status === "SKIP" ? "  ○ " : "  ✘ ") + r.name + (r.detail ? "  — " + r.detail : "")); }); });
  console.log("\nRésumé : " + JSON.stringify(out.summary));
  console.log("Routes : " + JSON.stringify({ serveur: rc.serverRoutes, publiques: rc.publicRoutes, appelsInterface: rc.clientCalls, absentesCoteServeur: rc.missingOnServer, handlersIndefinis: rc.undefinedHandlers, nonUtiliseesParInterface: rc.notReferencedByUi.length }));
  console.log("doGet : " + doGetOk);
  console.log("\n## Installation sur un compte Google vierge (procédure DEPLOIEMENT.md)");
  fresh.steps.forEach(function (s) { console.log((s.status === "PASS" ? "  ✔ " : "  ✘ ") + s.name + (s.status !== "PASS" || s.detail ? "  — " + s.detail : "")); });
  console.log("\n## Diagnostic d'installation incomplète (page affichée au lieu d'une erreur)");
  diag.steps.forEach(function (s) { console.log((s.status === "PASS" ? "  ✔ " : "  ✘ ") + s.name + (s.status !== "PASS" ? "  — " + s.detail : "")); });
  console.log("\n## Version d'installation « 2 fichiers » (dist/)");
  bundle.steps.forEach(function (s) { console.log((s.status === "PASS" ? "  ✔ " : "  ✘ ") + s.name + (s.detail ? "  — " + s.detail : "")); });
  process.exitCode = !bundle.ok || !diag.ok || !fresh.ok || out.summary.failed || rc.missingOnServer.length || rc.undefinedHandlers.length ? 1 : 0;
}
if (require.main === module) main();
module.exports = { loadProject: loadProject, routeConsistency: routeConsistency };
