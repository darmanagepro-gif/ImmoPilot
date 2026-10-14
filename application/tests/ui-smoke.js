/**
 * Test de bout en bout de l'interface (navigateur simulé jsdom) branché sur le vrai code serveur exécuté dans le simulateur.
 * Pour chaque rôle, ouvre toutes les pages accessibles depuis le menu et les fiches de détail, et signale :
 * exceptions JavaScript, messages d'erreur affichés (.alert.bad), pages introuvables, appels serveur en échec.
 * Usage : NODE_PATH=<dossier contenant jsdom> node tests/ui-smoke.js
 * Limites : jsdom n'exécute pas Chart.js/Leaflet (CDN non chargés) ni le rendu visuel ; les fenêtres modales ne sont pas toutes ouvertes.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { JSDOM, VirtualConsole } = require("jsdom");
const { loadProject } = require("./run-tests");
const ROOT = path.resolve(__dirname, "..");

function renderIndex(boot) {
  let html = fs.readFileSync(path.join(ROOT, "Index.html"), "utf8");
  html = html.replace(/<\?!=\s*include\("(\w+)"\);\s*\?>/g, function (m, n) { return fs.readFileSync(path.join(ROOT, n + ".html"), "utf8"); });
  html = html.replace(/<\?!=\s*boot\.replace\([^?]*\?>/, JSON.stringify(boot).replace(/</g, "\\u003c"));
  return html.replace(/<script src="[^"]+"><\/script>/g, "").replace(/<link [^>]*>/g, "");
}

async function main() {
  const { ctx } = loadProject();
  vm.runInContext("var __env = testEnvSetup_(); var __T = testKit_([]); var __fx = testFixtures_(__T);", ctx);
  // Jeu de données : réservation, incident avec devis/intervention/facture, mission de ménage, bail.
  const ids = vm.runInContext(`(function(){ var T=__T, fx=__fx, o={};
    T.call(fx.tok.ownerA,"property.agencySet",{propertyId:fx.propA,agencyOrganizationId:fx.ag1.organizationId,canView:true,canManageReservations:true,canManageOperations:true,canViewFinance:true});
    T.call(fx.tok.ownerA,"property.staffAssign",{propertyId:fx.propA,email:fx.users.cleaner.email,role:"CLEANER"});
    var r=T.call(fx.tok.ownerA,"resv.create",{propertyId:fx.propA,checkIn:todayStr_(),checkOut:addDaysStr_(todayStr_(),2),guestName:"Yasmine Alaoui",guestCount:2,guestPhone:"0611223344",guestEmail:"y@example.test"}); o.resv=r.reservationId;
    T.call(fx.tok.ownerA,"property.staffAssign",{propertyId:fx.propA,email:fx.users.guard.email,role:"GUARD"});
    T.call(fx.tok.ownerA,"pay.record",{refType:"RESERVATION",refId:o.resv,kind:"RESERVATION",amount:500});
    T.call(fx.tok.guard,"ops.checkIn",{reservationId:o.resv,checklist:{"Clés remises":true}});
    var out=T.call(fx.tok.guard,"ops.checkOut",{reservationId:o.resv}); o.mission=out.cleaningMissionId;
    var inc=T.call(fx.tok.ownerA,"inc.create",{propertyId:fx.propA,category:"PLUMBING",severity:"HIGH",description:"Fuite salle de bain"}); o.incident=inc.incidentId;
    var art=T.call(fx.tok.superA,"ctr.create",{name:"Atlas Plomberie",email:fx.users.artisan.email,specialties:["PLUMBING"]}); o.artisan=art.artisanId;
    var q=T.call(fx.tok.ownerA,"quote.request",{incidentId:o.incident,artisanId:o.artisan});
    T.call(fx.tok.artisan,"quote.submit",{quoteId:q.quoteId,lines:[{description:"Joint",quantity:1,unitPrice:400}],vatRate:20});
    T.call(fx.tok.ownerA,"quote.decide",{quoteId:q.quoteId,decision:"APPROVED"});
    var wo=T.call(fx.tok.ownerA,"wo.create",{incidentId:o.incident,artisanId:o.artisan,quoteId:q.quoteId}); o.wo=wo.workOrderId;
    T.call(fx.tok.artisan,"wo.respond",{workOrderId:o.wo,decision:"ACCEPTED"}); T.call(fx.tok.artisan,"wo.start",{workOrderId:o.wo});
    T.call(fx.tok.artisan,"wo.complete",{workOrderId:o.wo,report:"Joint remplacé"}); T.call(fx.tok.ownerA,"wo.verify",{workOrderId:o.wo});
    var iv=T.call(fx.tok.artisan,"inv.submit",{workOrderId:o.wo,invoiceNumber:"F-1",amountHT:400}); o.invoice=iv.invoiceId;
    var t=T.call(fx.tok.ownerA,"tenant.create",{propertyId:fx.propA2,fullName:"Karim Locataire",email:fx.users.tenant.email});
    var l=T.call(fx.tok.ownerA,"lease.create",{propertyId:fx.propA2,tenantId:t.tenantId,startDate:addMonthsStr_(todayStr_().slice(0,8)+"01",-1),monthlyRent:6000,charges:400,deposit:12000});
    T.call(fx.tok.ownerA,"lease.activate",{leaseId:l.leaseId}); o.lease=l.leaseId;
    T.call(fx.tok.superA,"sub.assign",{organizationId:fx.orgB.organizationId,planCode:"PRO",trial:true});
    o.futureResv=T.call(fx.tok.ownerA,"resv.create",{propertyId:fx.propA,checkIn:addDaysStr_(todayStr_(),20),checkOut:addDaysStr_(todayStr_(),23),guestName:"Portail Voyageur",guestCount:2}).reservationId;
    return o; })()`, ctx);
  const fx = vm.runInContext("({ tok: __fx.tok, propA: __fx.propA })", ctx);

  const report = [];
  const roles = [["ownerA", "Propriétaire"], ["ag1", "Agence (admin)"], ["ag1u", "Agence (collaborateur)"], ["guard", "Gardien"], ["cleaner", "Ménage"], ["artisan", "Artisan"], ["tenant", "Locataire"], ["superA", "Super administrateur"]];
  // Matrice d'accès attendue aux fiches de détail (P=bien, R=réservation, I=incident, C=ménage, W=intervention, F=facture, B=bail, A=prestataire).
  const EXPECT = { ownerA: "PRICWFBA", ag1: "PRICWFA", ag1u: "PRICWA", guard: "PR", cleaner: "PC", artisan: "PIWFA", tenant: "B", superA: "" };
  const LETTERS = "PRICWFBA";
  const details = ["property/" + fx.propA, "reservation/" + ids.resv, "incident/" + ids.incident, "cleaning/" + ids.mission, "workorder/" + ids.wo, "invoice/" + ids.invoice, "lease/" + ids.lease, "contractors/" + ids.artisan];

  for (const [key, label] of roles) {
    const errors = [], calls = { ok: 0, fail: [] };
    const vc = new VirtualConsole();
    vc.on("jsdomError", function (e) { errors.push("jsdom: " + (e.message || e)); });
    vc.on("error", function (e) { errors.push("console.error: " + (e && e.message ? e.message : e)); });
    const dom = new JSDOM(renderIndex({ mode: "app", token: "", appName: "ImmoPilot", version: "2.0.0" }), { runScripts: "dangerously", url: "https://example.test/exec", virtualConsole: vc, pretendToBeVisual: true,
      beforeParse: function (w) {
        w.sessionStorage.setItem("ip_token", fx.tok[key]);
        w.localStorage.setItem("ip_lang", key === "tenant" ? "ar" : (key === "ag1u" ? "en" : "fr"));
        w.HTMLCanvasElement.prototype.getContext = function () { return null; };
        w.scrollTo = function () {};
        const mk = function () {
          const r = { _s: null, _f: null };
          r.withSuccessHandler = function (f) { r._s = f; return r; };
          r.withFailureHandler = function (f) { r._f = f; return r; };
          ["api", "apiPublic"].forEach(function (fn) {
            r[fn] = function () {
              const args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
              setTimeout(function () {
                try {
                  ctx.__args = args;
                  const res = JSON.parse(JSON.stringify(vm.runInContext(fn + ".apply(null, __args)", ctx)));
                  if (res && res.ok === false) calls.fail.push(args[fn === "api" ? 1 : 0] + " → " + res.error.code + " " + res.error.message); else calls.ok++;
                  r._s && r._s(res);
                } catch (e) { errors.push("serveur: " + e.message); r._f && r._f(e); }
              }, 0);
            };
          });
          return r;
        };
        w.google = { script: { get run() { return mk(); } } };
        w.addEventListener("error", function (ev) { errors.push("window.onerror: " + ev.message); });
      } });
    const w = dom.window;
    const settle = function () { return new Promise(function (res) { setTimeout(res, 120); }); };
    for (let i = 0; i < 8; i++) await settle();
    const navRoutes = Array.from(w.document.querySelectorAll(".nav a")).map(function (a) { return a.dataset.r; });
    const visited = [];
    const visit = async function (route) {
      w.location.hash = route; for (let i = 0; i < 10; i++) await settle();
      const bad = Array.from(w.document.querySelectorAll("#content .alert.bad")).map(function (e) { return e.textContent; });
      const notFound = /Page introuvable|Page not found/.test(w.document.getElementById("content").textContent);
      const empty = !w.document.getElementById("content").textContent.trim();
      visited.push({ route: route, alerts: bad, notFound: notFound, empty: empty });
    };
    if (!w.document.querySelector(".nav")) { report.push({ role: label, fatal: "Coque non affichée", errors: errors, html: w.document.getElementById("app").textContent.slice(0, 300) }); continue; }
    for (const r of navRoutes) await visit(r);
    for (let di = 0; di < details.length; di++) { await visit(details[di]); const v = visited[visited.length - 1]; v.expected = EXPECT[key].indexOf(LETTERS[di]) >= 0; v.denied = v.alerts.some(function (a) { return /refusé|denied|مرفوض|introuvable/i.test(a); }); v.detail = true; }
    report.push({ role: label, lang: w.document.documentElement.lang, dir: w.document.documentElement.dir, menu: navRoutes, visited: visited, errors: errors, callsOk: calls.ok, callsFailed: calls.fail });
    w.close();
  }
  // Écrans publics : connexion, invitation, réinitialisation, portail voyageur
  const pub = [];
  const tok = vm.runInContext(`(function(){ var g = api(__fx.tok.ownerA, "guest.tokenCreate", { reservationId: "${ids.futureResv}" }); return g.ok ? g.data.url.split("token=")[1] : ""; })()`, ctx);
  for (const [mode, token] of [["app", ""], ["guest", tok], ["accept", "f".repeat(64)], ["reset", "e".repeat(64)]]) {
    const errors = [];
    const vc = new VirtualConsole(); vc.on("jsdomError", function (e) { errors.push(e.message); });
    const dom = new JSDOM(renderIndex({ mode: mode, token: token }), { runScripts: "dangerously", url: "https://example.test/exec", virtualConsole: vc, beforeParse: function (w) {
      w.google = { script: { get run() { const r = {}; r.withSuccessHandler = function (f) { r._s = f; return r; }; r.withFailureHandler = function () { return r; };
        r.apiPublic = function () { const a = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments))); setTimeout(function () { ctx.__args = a; r._s(JSON.parse(JSON.stringify(vm.runInContext("apiPublic.apply(null, __args)", ctx)))); }, 0); };
        r.api = r.apiPublic; return r; } } };
    } });
    for (let i = 0; i < 8; i++) await new Promise(function (res) { setTimeout(res, 100); });
    pub.push({ mode: mode, heading: (dom.window.document.querySelector("h2") || {}).textContent || "", text: dom.window.document.getElementById("app").textContent.slice(0, 160).replace(/\s+/g, " "), errors: errors });
    dom.window.close();
  }
  vm.runInContext("testEnvTeardown_(__env)", ctx);
  fs.writeFileSync(path.join(__dirname, "ui-results.json"), JSON.stringify({ ranAt: new Date().toISOString(), roles: report, public: pub }, null, 2));
  let problems = 0;
  report.forEach(function (r) {
    const bad = (r.visited || []).filter(function (v) { if (v.detail) return v.expected ? (v.alerts.length > 0 || v.notFound || v.empty) : !v.denied; return v.alerts.length || v.notFound || v.empty; });
    const denied = (r.visited || []).filter(function (v) { return v.detail && !v.expected && v.denied; }).length;
    problems += bad.length + (r.errors || []).length + (r.fatal ? 1 : 0);
    console.log("\n## " + r.role + (r.lang ? " [" + r.lang + "/" + r.dir + "]" : "") + (r.fatal ? " — ÉCHEC : " + r.fatal : ""));
    if (r.menu) console.log("  menu : " + r.menu.join(", "));
    if (r.visited) console.log("  pages ouvertes : " + r.visited.length + " · appels serveur réussis : " + r.callsOk + " · fiches hors périmètre correctement refusées : " + denied);
    bad.forEach(function (v) { console.log("  ✘ " + v.route + " : " + (v.detail && !v.expected ? "ACCÈS NON ATTENDU (fuite potentielle) " : "") + (v.notFound ? "introuvable " : "") + (v.empty ? "vide " : "") + v.alerts.join(" | ")); });
    (r.errors || []).forEach(function (e) { console.log("  ✘ " + e); });
    r.denied = denied; r.unexpected = bad.map(function (v) { return v.route; });
  });
  console.log("\n## Écrans publics");
  pub.forEach(function (p) { problems += p.errors.length; console.log("  " + (p.errors.length ? "✘" : "✔") + " " + p.mode + " : « " + p.heading + " » " + (p.errors.length ? p.errors.join(" | ") : "")); });
  console.log("\nProblèmes détectés : " + problems);
  process.exitCode = problems ? 1 : 0;
}
main().catch(function (e) { console.error(e); process.exitCode = 1; });
