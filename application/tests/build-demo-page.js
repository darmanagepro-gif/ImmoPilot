/**
 * Reconstruit la DÉMO PUBLIQUE MAROC (dépôt darmanagepro-gif/immopilot-demo, GitHub Pages) à partir du code actuel :
 * toute l'application tourne dans le navigateur, sur le simulateur Apps Script, avec des données entièrement fictives.
 * Aucune donnée réelle, aucun e-mail, aucun appel à un service d'IA (l'agent utilise ses modèles intégrés).
 *
 * Usage : node tests/build-demo-page.js <chemin/vers/immopilot-demo/index.html>
 * Le fichier existant sert de gabarit (barre du haut, choix du profil) : seule la charge utile est remplacée.
 * Contenu : demo-browser-shims.js (environnement « Node » minimal), gas-mock.js (simulateur), tous les .gs (édition MA),
 *           demo-public-data.js + demo-longterm.js (données fictives), interface Index.html complète.
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, ".."), out = process.argv[2];
if (!out || !fs.existsSync(out)) throw new Error("Indiquez le chemin du fichier index.html de la démo.");
const read = function (f) { return fs.readFileSync(path.join(ROOT, f), "utf8"); };

// Code serveur : Code.gs d'abord (même ordre que tests/run-tests.js), édition Maroc, démo publique Apps Script désactivée.
const gs = fs.readdirSync(ROOT).filter(function (f) { return /\.gs$/.test(f); }).sort(function (a, b) { return a === "Code.gs" ? -1 : b === "Code.gs" ? 1 : a.localeCompare(b); });
const server = gs.map(function (f) { return "/* ==== " + f + " ==== */\n" + read(f); }).join("\n");
if (server.indexOf('var IMMO_EDITION_ = "MA";') < 0 || server.indexOf("var IMMO_PUBLIC_DEMO_ = false;") < 0) throw new Error("Marqueurs d'édition introuvables.");

// Données fictives : jeu de démonstration (noms présentables compris), puis location longue durée : les PDF et e-mails
// générés par les envois automatiques et l'agent portent ainsi les noms de démonstration.
const data = read("tests/demo-public-data.js");
if (data.indexOf("/* Noms et adresses de démonstration présentables") < 0) throw new Error("demo-public-data.js : bloc des noms présentables introuvable.");
const demo = data + "\n" + read("tests/demo-longterm.js");

const payload = {
  shims: read("tests/demo-browser-shims.js"),
  mock: read("tests/gas-mock.js").replace(/^"use strict";$/m, ""),
  gs: server,
  boot: "var __env = testEnvSetup_(); var __T = testKit_([]); var __fx = testFixtures_(__T); TEST_HOOKS_.pbkdfIters = 50;",
  demo: demo
};

// Interface : Index.html avec ses fichiers inclus ; le démarrage (BOOT) est fourni par la page de démo.
let html = read("Index.html").replace(/<\?!=\s*include\("(\w+)"\);\s*\?>/g, function (m, n) { return "<!-- ===== " + n + ".html ===== -->\n" + read(n + ".html"); });
html = html.replace(/<\?!=\s*boot\.replace\([^?]*\?>/, "/*IP_BOOT*/null");
if (html.indexOf("<?") >= 0 || html.indexOf("/*IP_BOOT*/null") < 0) throw new Error("Index.html : scriptlet inattendu.");

const b64 = function (s) { return Buffer.from(s, "utf8").toString("base64"); };
let page = fs.readFileSync(out, "utf8");
const re = /var SERVER = "[A-Za-z0-9+\/=]+", APP = "[A-Za-z0-9+\/=]+";/;
if (!re.test(page)) throw new Error("Gabarit de démo : ligne « var SERVER = …, APP = … » introuvable.");
page = page.replace(re, function () { return 'var SERVER = "' + b64(JSON.stringify(payload)) + '", APP = "' + b64(html) + '";'; });
fs.writeFileSync(out, page);
console.log("Démo reconstruite : " + path.resolve(out) + " (" + Math.round(Buffer.byteLength(page) / 1024) + " Ko, " + gs.length + " fichiers serveur)");
