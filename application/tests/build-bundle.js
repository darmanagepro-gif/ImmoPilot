/**
 * Construit la version d'installation « 2 fichiers » dans dist/ :
 *  - ImmoPilot.gs : les 31 fichiers serveur concaténés (aucune déclaration en double possible) ;
 *  - Index.html   : l'interface complète (les 7 fichiers inclus sont intégrés).
 * Usage : node tests/build-bundle.js
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
// Édition : node tests/build-bundle.js            → dist/    (Maroc, dirham)
//           node tests/build-bundle.js --edition=fr → dist-fr/ (France, euro, logo tour Eiffel)
const EDITION = ((process.argv.find(function (a) { return /^--edition=/.test(a); }) || "--edition=ma").split("=")[1] || "ma").toUpperCase();
if (["MA", "FR"].indexOf(EDITION) < 0) throw new Error("Édition inconnue : " + EDITION);
// --demo : paquet de DÉMONSTRATION publique (vues sans compte, lecture seule), dossier dist[-fr]-demo.
const DEMO = process.argv.indexOf("--demo") >= 0;
const OUT = path.join(ROOT, (EDITION === "MA" ? "dist" : "dist-" + EDITION.toLowerCase()) + (DEMO ? "-demo" : ""));
fs.mkdirSync(OUT, { recursive: true });
const gs = fs.readdirSync(ROOT).filter(function (f) { return /\.gs$/.test(f); }).sort();
const version = (fs.readFileSync(path.join(ROOT, "Config.gs"), "utf8").match(/VERSION: "([^"]+)"/) || [])[1] || "";
let server = "/**\n * ImmoPilot " + version + " — CODE SERVEUR COMPLET EN UN SEUL FICHIER (IMMOPILOT_BUNDLE).\n" +
  " * Contient les " + gs.length + " fichiers : " + gs.join(", ") + ".\n" +
  " * À coller seul dans le projet Apps Script (aucun autre fichier .gs ne doit rester dans le projet).\n */\n";
gs.forEach(function (f) { server += "\n/* ======================================================================\n * " + f + "\n * ====================================================================== */\n" + fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\s+$/, "") + "\n"; });
if (EDITION !== "MA") {
  const ed = 'var IMMO_EDITION_ = "MA";';
  if (server.indexOf(ed) < 0) throw new Error("Marqueur d'édition introuvable dans Config.gs");
  server = server.replace(ed, 'var IMMO_EDITION_ = "' + EDITION + '";');
  const logo = path.join(ROOT, "editions", EDITION.toLowerCase(), "pdf-logo-96.png");
  if (fs.existsSync(logo)) server = server.replace(/var PDF_LOGO_PNG_B64_ = "[^"]+";/, 'var PDF_LOGO_PNG_B64_ = "' + fs.readFileSync(logo).toString("base64") + '";');
  server = server.replace("ImmoPilot " + version + " — CODE SERVEUR", "ImmoPilot " + version + " (édition " + EDITION + ") — CODE SERVEUR");
}
if (DEMO) {
  const flag = "var IMMO_PUBLIC_DEMO_ = false;";
  if (server.indexOf(flag) < 0) throw new Error("Marqueur de démonstration introuvable dans Config.gs");
  server = server.replace(flag, "var IMMO_PUBLIC_DEMO_ = true;");
}
const build = require("crypto").createHash("sha1").update(server).update(fs.readFileSync(path.join(ROOT, "Index.html"))).digest("hex").slice(0, 12);
server = server.replace('var IMMO_BUILD_ = "dev";', 'var IMMO_BUILD_ = "' + build + '";');
server += "\n/* FIN DU FICHIER ImmoPilot.gs — si cette ligne manque, le copier-coller est incomplet. */\n";
fs.writeFileSync(path.join(OUT, "ImmoPilot.gs"), server);
let html = fs.readFileSync(path.join(ROOT, "Index.html"), "utf8");
html = html.replace(/<\?!=\s*include\("(\w+)"\);\s*\?>/g, function (m, n) {
  const c = fs.readFileSync(path.join(ROOT, n + ".html"), "utf8");
  if (c.indexOf("<?") >= 0) throw new Error(n + ".html contient « <? » : intégration impossible dans un modèle.");
  return "<!-- ===== " + n + ".html ===== -->\n" + c;
});
html = html.replace("<!DOCTYPE html>", "<!DOCTYPE html>\n<!-- IMMOPILOT_BUNDLE : interface complète en un seul fichier (Index). -->");
html = html.replace(/<\/html>\s*$/, "</html>\n<!-- FIN DU FICHIER Index.html — si cette ligne manque, le copier-coller est incomplet. -->\n");
fs.writeFileSync(path.join(OUT, "Index.html"), html);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "appsscript.json"), "utf8"));
if (EDITION === "FR") manifest.timeZone = "Europe/Paris";
fs.writeFileSync(path.join(OUT, "appsscript.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Édition " + EDITION + " → " + path.relative(ROOT, OUT) + "/");
console.log("dist/ImmoPilot.gs : " + server.split("\n").length + " lignes, " + Buffer.byteLength(server) + " octets");
console.log("dist/Index.html   : " + html.split("\n").length + " lignes, " + Buffer.byteLength(html) + " octets");
