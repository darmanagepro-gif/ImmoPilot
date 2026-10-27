/**
 * Serveur de prévisualisation locale (hors Google) : sert l'interface et exécute le code serveur dans le simulateur.
 * Données de démonstration générées au démarrage. Réservé au développement : ne jamais exposer publiquement.
 * Usage : NODE_PATH=<node_modules avec chart.js et leaflet> node tests/preview-server.js [port]
 * Ouvrir http://localhost:8787/?as=ownerA  (rôles : ownerA, ag1, ag1u, guard, cleaner, cleaner2, artisan, tenant, superA ; &lang=ar)
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), vm = require("vm");
const { loadProject } = require("./run-tests");
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || 8787);

const { ctx } = loadProject();
vm.runInContext("var __env = testEnvSetup_(); var __T = testKit_([]); var __fx = testFixtures_(__T); TEST_HOOKS_.pbkdfIters = 50;", ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "demo-data.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "demo-longterm.js"), "utf8"), ctx);
// PUBLIC_DEMO=1 : reproduit le paquet « démo publique » (choix d'une vue sans compte sur l'écran de connexion).
if (process.env.PUBLIC_DEMO) vm.runInContext("IMMO_PUBLIC_DEMO_ = true; demoBuild_(__fx.users.superA.email);", ctx);
const tokens = vm.runInContext("__fx.tok", ctx);

function page(as, lang, mode, token, gas) {
  let html = fs.readFileSync(path.join(ROOT, "Index.html"), "utf8");
  html = html.replace(/<\?!=\s*include\("(\w+)"\);\s*\?>/g, function (m, n) { return fs.readFileSync(path.join(ROOT, n + ".html"), "utf8"); });
  html = html.replace(/<\?!=\s*boot\.replace\([^?]*\?>/, JSON.stringify({ mode: mode || "app", token: token || "", appName: "ImmoPilot", version: "2.0.0", embed: (process.env.EMBED_ORIGINS || "").split(",").filter(Boolean), edition: vm.runInContext("editionPublic_()", ctx), doc: "" }));
  html = html.replace("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js", "/lib/chart.js").replace("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js", "/lib/leaflet.js")
    .replace("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css", "/lib/leaflet.css").replace(/<link[^>]+fonts\.googleapis[^>]+>/g, "");
  const shim = "<script>(function(){try{" + (as && tokens[as] ? "sessionStorage.setItem('ip_token'," + JSON.stringify(tokens[as]) + ");" : "") + (lang ? "localStorage.setItem('ip_lang'," + JSON.stringify(lang) + ");" : "") + "}catch(e){}" +
    "function mk(){var r={};r.withSuccessHandler=function(f){r.s=f;return r};r.withFailureHandler=function(f){r.f=f;return r};" +
    "['api','apiPublic'].forEach(function(fn){r[fn]=function(){fetch('/rpc/'+fn,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([].slice.call(arguments))}).then(function(x){return x.json()}).then(function(d){r.s&&r.s(d)}).catch(function(e){r.f&&r.f(e)})}});return r}" +
    "window.google={script:{get run(){return mk()}}};})();</script>";
  // Mode « gas » : reproduit le cadre de Google (liens ouverts au niveau supérieur, historique google.script.history).
  const gasShim = gas ? "<base target=\"_top\"><script>window.__histLog=[];(function(){var h=null;var g=window.google.script;g.history={push:function(st,pr,hash){window.__histLog.push(hash);},setChangeHandler:function(f){h=f;},replace:function(){}};window.__histBack=function(x){h&&h({location:{hash:x}});};})();</script>" : "";
  return html.replace("<head>", "<head>" + shim + gasShim);
}
const LIB = { "/lib/chart.js": "chart.js/dist/chart.umd.js", "/lib/leaflet.js": "leaflet/dist/leaflet.js", "/lib/leaflet.css": "leaflet/dist/leaflet.css" };
http.createServer(function (req, res) {
  const u = new URL(req.url, "http://localhost");
  if (LIB[u.pathname]) { res.writeHead(200, { "Content-Type": u.pathname.endsWith(".css") ? "text/css" : "application/javascript" }); const base = (process.env.NODE_PATH || path.join(ROOT, "node_modules")).split(path.delimiter)[0];
    try { return res.end(fs.readFileSync(path.join(base, LIB[u.pathname]))); } catch (e) { return res.end("/* bibliothèque absente : " + LIB[u.pathname] + " */"); } }
  if (u.pathname.indexOf("/rpc/") === 0 && req.method === "POST") {
    let body = ""; req.on("data", function (c) { body += c; });
    req.on("end", function () { ctx.__args = JSON.parse(body || "[]"); const fn = u.pathname.slice(5) === "apiPublic" ? "apiPublic" : "api";
      let out; try { out = vm.runInContext(fn + ".apply(null, __args)", ctx); } catch (e) { out = { ok: false, error: { code: "INTERNAL", message: e.message } }; }
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(out)); });
    return;
  }
  if (u.pathname === "/frame") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end("<!DOCTYPE html><html><head><title>Cadre Google simulé</title><style>html,body,iframe{margin:0;border:0;width:100%;height:100%}</style></head><body>" +
      "<iframe id='app' sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation' src='/?gas=1&" + u.searchParams.toString() + "'></iframe></body></html>");
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page(u.searchParams.get("as"), u.searchParams.get("lang"), u.searchParams.get("mode"), u.searchParams.get("token"), u.searchParams.get("gas") === "1"));
}).listen(PORT, function () { console.log("Prévisualisation : http://localhost:" + PORT + "/?as=ownerA"); console.log("Jeton portail voyageur : " + vm.runInContext("__demo.guestToken", ctx)); });
